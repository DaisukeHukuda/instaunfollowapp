import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetForTest,
  CookieError,
  fetchProfile,
  getEnrichStatus,
  runEnrich,
} from './enricher.js';
import { loadAccounts, saveAccounts, saveCookie } from './store.js';
import type { Account } from './types.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ifm-enrich-'));
  process.env.DATA_DIR = dir;
  _resetForTest();
});

afterEach(async () => {
  delete process.env.DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

const noSleep = async () => {};

const account = (username: string, fetchedAt: string | null = null): Account => ({
  username,
  profileUrl: `https://www.instagram.com/${username}/`,
  relationship: 'followingOnly',
  followedAt: null,
  followerSince: null,
  status: 'pending',
  statusChangedAt: null,
  queued: false,
  profile: fetchedAt
    ? {
        displayName: '取得済み',
        bio: null,
        followerCount: null,
        followingCount: null,
        postCount: null,
        isPrivate: null,
        isVerified: null,
        picPath: null,
        fetchedAt,
        fetchError: null,
      }
    : null,
});

const igUser = {
  full_name: '山田 太郎',
  biography: 'こんにちは',
  is_private: false,
  is_verified: true,
  profile_pic_url_hd: 'https://cdn.example/pic.jpg',
  edge_followed_by: { count: 1200 },
  edge_follow: { count: 300 },
  edge_owner_to_timeline_media: { count: 42 },
};

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe('fetchProfile', () => {
  it('APIレスポンスをProfileに変換する', async () => {
    const fetchFn = vi.fn(async () => jsonRes({ data: { user: igUser } }));
    const { profile, picUrl } = await fetchProfile('yamada', 'sessionid=x', fetchFn);
    expect(profile.displayName).toBe('山田 太郎');
    expect(profile.bio).toBe('こんにちは');
    expect(profile.followerCount).toBe(1200);
    expect(profile.isVerified).toBe(true);
    expect(picUrl).toBe('https://cdn.example/pic.jpg');
    const url = String((fetchFn.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('web_profile_info');
    expect(url).toContain('username=yamada');
  });

  it('401はCookieErrorになる', async () => {
    const fetchFn = vi.fn(async () => jsonRes({}, 401));
    await expect(fetchProfile('x', 'c', fetchFn)).rejects.toBeInstanceOf(CookieError);
  });

  it('userがnull（退会等）は fetchError 付きプロフィールを返す', async () => {
    const fetchFn = vi.fn(async () => jsonRes({ data: { user: null } }));
    const { profile } = await fetchProfile('gone', 'c', fetchFn);
    expect(profile.fetchError).toContain('存在しません');
  });
});

describe('runEnrich', () => {
  it('未取得のみ取得し、画像を保存し、fetchedAtを付ける', async () => {
    await saveCookie('sessionid=x');
    await saveAccounts({
      updatedAt: '',
      accounts: [account('alice'), account('done_user', '2026-07-01T00:00:00.000Z')],
    });
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('web_profile_info')
        ? jsonRes({ data: { user: igUser } })
        : new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );
    await runEnrich(fetchFn as typeof fetch, noSleep);
    const st = getEnrichStatus();
    expect(st.state).toBe('done');
    expect(st.total).toBe(1);
    expect(st.done).toBe(1);
    const { accounts } = await loadAccounts();
    const alice = accounts.find((a) => a.username === 'alice')!;
    expect(alice.profile?.displayName).toBe('山田 太郎');
    expect(alice.profile?.picPath).toBe('/profiles/alice.jpg');
    expect(alice.profile?.fetchedAt).toBeTruthy();
    const done = accounts.find((a) => a.username === 'done_user')!;
    expect(done.profile?.displayName).toBe('取得済み');
  });

  it('Cookie未設定なら開始せず停止状態になる', async () => {
    await saveAccounts({ updatedAt: '', accounts: [account('alice')] });
    await runEnrich(vi.fn() as unknown as typeof fetch, noSleep);
    const st = getEnrichStatus();
    expect(st.state).toBe('stopped');
    expect(st.reason).toContain('Cookie');
  });

  it('401で即停止し理由を残す', async () => {
    await saveCookie('sessionid=x');
    await saveAccounts({ updatedAt: '', accounts: [account('a'), account('b')] });
    const fetchFn = vi.fn(async () => jsonRes({}, 401));
    await runEnrich(fetchFn as typeof fetch, noSleep);
    const st = getEnrichStatus();
    expect(st.state).toBe('stopped');
    expect(st.reason).toContain('Cookie');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('連続3件失敗で自動停止する', async () => {
    await saveCookie('sessionid=x');
    await saveAccounts({
      updatedAt: '',
      accounts: [account('a'), account('b'), account('c'), account('d')],
    });
    const fetchFn = vi.fn(async () => jsonRes({}, 500));
    await runEnrich(fetchFn as typeof fetch, noSleep);
    const st = getEnrichStatus();
    expect(st.state).toBe('stopped');
    expect(st.failed).toBe(3);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('429で即停止する', async () => {
    await saveCookie('sessionid=x');
    await saveAccounts({ updatedAt: '', accounts: [account('a'), account('b')] });
    const fetchFn = vi.fn(async () => jsonRes({}, 429));
    await runEnrich(fetchFn as typeof fetch, noSleep);
    const st = getEnrichStatus();
    expect(st.state).toBe('stopped');
    expect(st.reason).toContain('429');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('scope.relationship で対象を絞る', async () => {
    await saveCookie('sessionid=x');
    const following = account('follow_a');
    const fan = { ...account('fan_b'), relationship: 'followerOnly' as const };
    await saveAccounts({ updatedAt: '', accounts: [following, fan] });
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('web_profile_info')
        ? jsonRes({ data: { user: igUser } })
        : new Response(new Uint8Array([1]), { status: 200 }),
    );
    await runEnrich(fetchFn as typeof fetch, noSleep, { relationship: 'followingOnly' });
    const st = getEnrichStatus();
    expect(st.total).toBe(1);
    expect(st.done).toBe(1);
    const { accounts } = await loadAccounts();
    expect(accounts.find((a) => a.username === 'follow_a')!.profile?.fetchedAt).toBeTruthy();
    expect(accounts.find((a) => a.username === 'fan_b')!.profile).toBeNull();
  });

  it('scope.limit で先頭N件だけ取得する', async () => {
    await saveCookie('sessionid=x');
    await saveAccounts({
      updatedAt: '',
      accounts: [account('a'), account('b'), account('c')],
    });
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('web_profile_info')
        ? jsonRes({ data: { user: igUser } })
        : new Response(new Uint8Array([1]), { status: 200 }),
    );
    await runEnrich(fetchFn as typeof fetch, noSleep, { limit: 2 });
    const st = getEnrichStatus();
    expect(st.total).toBe(2);
    expect(st.done).toBe(2);
  });

  it('scope.onlyQueued でキューのみ取得する', async () => {
    await saveCookie('sessionid=x');
    const queued = { ...account('q'), queued: true };
    await saveAccounts({ updatedAt: '', accounts: [queued, account('not_q')] });
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('web_profile_info')
        ? jsonRes({ data: { user: igUser } })
        : new Response(new Uint8Array([1]), { status: 200 }),
    );
    await runEnrich(fetchFn as typeof fetch, noSleep, { onlyQueued: true });
    expect(getEnrichStatus().total).toBe(1);
  });
});
