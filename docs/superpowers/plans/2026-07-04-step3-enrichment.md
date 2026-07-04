# ステップ3: プロフィール自動取得 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本人のログインCookieを使い、1件ずつ低速（3〜5秒間隔）でプロフィール（表示名・自己紹介・フォロワー数・画像）を取得してカードに表示する。エラー時は自動停止し、取得失敗はユーザー名表示にフォールバック。

**Architecture:** サーバ内に直列ワーカー（enricher）。fetch/sleepは注入可能にしてテストはモックで実施（実ネットワークは使わない）。Cookieは `data/secrets/cookie.json`（0600）に保存し、APIは設定有無のみ返す。画像は `data/profiles/` にダウンロードし `/profiles/:file` で配信。enricher と UI操作の同時書き込み競合を防ぐため、store に直列化ロック（withStore）を追加。

**安全設計（変更禁止）:** 直列1件ずつ・間隔3秒+ジッター最大2秒 / 401・403→即停止 / 429→即停止 / 連続3失敗→自動停止 / 再開は手動のみ / 取得済み（fetchedAtあり）はスキップ。

---

## ファイル構成

```
server/src/store.ts       # 変更: withStore（直列化）/ saveCookie / loadCookie 追加
server/src/enricher.ts    # 新規: fetchProfile / runEnrich / 状態管理
server/src/enricher.test.ts # 新規
server/src/app.ts         # 変更: cookie設定API / enrich API / /profiles/:file 配信 / 既存書き込みをwithStoreで直列化
server/src/app.test.ts    # 変更: 新APIのテスト追加
web/src/types.ts          # 変更: EnrichStatus 追加
web/src/api.ts            # 変更: cookie/enrich API ヘルパー追加
web/src/EnrichPanel.tsx   # 新規: Cookie設定と取得実行UI
web/src/ImportView.tsx    # 変更: EnrichPanel を組み込み
web/src/AccountCard.tsx   # 変更: フォロワー数表示
web/src/styles.css        # 変更: プログレスバー等
```

---

### Task 1: store拡張（withStore / Cookie保存）

**Files:**
- Modify: `server/src/store.ts`
- Test: `server/src/store.test.ts`（追記）

- [ ] **Step 1: 失敗するテストを追記（store.test.ts の describe('store') 内の末尾に追加）**

```ts
  it('Cookieを保存・読込できる（未設定はnull）', async () => {
    const { loadCookie, saveCookie } = await import('./store.js');
    expect(await loadCookie()).toBeNull();
    await saveCookie('sessionid=abc; ds_user_id=1');
    expect(await loadCookie()).toBe('sessionid=abc; ds_user_id=1');
  });

  it('withStore は書き込みを直列化する', async () => {
    const { withStore } = await import('./store.js');
    const order: number[] = [];
    await Promise.all([
      withStore(async () => {
        await new Promise((r) => setTimeout(r, 30));
        order.push(1);
      }),
      withStore(async () => {
        order.push(2);
      }),
    ]);
    expect(order).toEqual([1, 2]);
  });
```

- [ ] **Step 2: `npm test -w server -- src/store.test.ts` → 新2件がFAIL**

- [ ] **Step 3: store.ts に追記（ファイル末尾に追加。importの mkdir/readFile/writeFile/join は既存を利用）**

```ts
/** サーバ内の読み書き競合（enricherとUI操作の同時更新）を直列化する */
let chain: Promise<unknown> = Promise.resolve();
export function withStore<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function saveCookie(cookie: string): Promise<void> {
  const dir = join(dataDir(), 'secrets');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'cookie.json'), JSON.stringify({ cookie }), { mode: 0o600 });
}

export async function loadCookie(): Promise<string | null> {
  try {
    const raw = await readFile(join(dataDir(), 'secrets', 'cookie.json'), 'utf8');
    return (JSON.parse(raw) as { cookie?: string }).cookie ?? null;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}
```

- [ ] **Step 4: `npm test -w server -- src/store.test.ts` → 全PASS（4件）**

- [ ] **Step 5: コミット**

```bash
git add server/src/store.ts server/src/store.test.ts
git commit -m "store拡張: 書き込み直列化とCookie保存"
```

---

### Task 2: enricher本体（取得ワーカー）

**Files:**
- Create: `server/src/enricher.ts`
- Test: `server/src/enricher.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`server/src/enricher.test.ts`:

```ts
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
    const url = String(fetchFn.mock.calls[0][0]);
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
});
```

- [ ] **Step 2: `npm test -w server -- src/enricher.test.ts` → FAIL（モジュールなし）**

- [ ] **Step 3: enricher.ts を実装**

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir, loadAccounts, loadCookie, saveAccounts, withStore } from './store.js';
import type { Profile } from './types.js';

export class CookieError extends Error {}
export class RateLimitError extends Error {}

export interface EnrichStatus {
  state: 'idle' | 'running' | 'stopped' | 'done';
  reason: string | null;
  total: number;
  done: number;
  failed: number;
  current: string | null;
}

export type FetchLike = typeof fetch;
export type SleepLike = (ms: number) => Promise<void>;

const IG_APP_ID = '936619743392459';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// 安全設計の要: 直列・3秒+最大2秒ジッター。短縮は環境変数でテスト時のみ。
const nextInterval = () =>
  Number(process.env.ENRICH_INTERVAL_MS ?? 3000) + Math.random() * 2000;

const sleep: SleepLike = (ms) => new Promise((r) => setTimeout(r, ms));

const status: EnrichStatus = {
  state: 'idle',
  reason: null,
  total: 0,
  done: 0,
  failed: 0,
  current: null,
};
let abort = false;

export const getEnrichStatus = (): EnrichStatus => ({ ...status });

export function stopEnrich(): void {
  if (status.state === 'running') abort = true;
}

export function _resetForTest(): void {
  Object.assign(status, { state: 'idle', reason: null, total: 0, done: 0, failed: 0, current: null });
  abort = false;
}

const emptyProfile = (): Profile => ({
  displayName: null,
  bio: null,
  followerCount: null,
  followingCount: null,
  postCount: null,
  isPrivate: null,
  isVerified: null,
  picPath: null,
  fetchedAt: null,
  fetchError: null,
});

interface IgUser {
  full_name?: string;
  biography?: string;
  is_private?: boolean;
  is_verified?: boolean;
  profile_pic_url_hd?: string;
  profile_pic_url?: string;
  edge_followed_by?: { count?: number };
  edge_follow?: { count?: number };
  edge_owner_to_timeline_media?: { count?: number };
}

export async function fetchProfile(
  username: string,
  cookie: string,
  fetchFn: FetchLike = fetch,
): Promise<{ profile: Profile; picUrl: string | null }> {
  const res = await fetchFn(
    `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    { headers: { cookie, 'x-ig-app-id': IG_APP_ID, 'user-agent': UA, accept: '*/*' } },
  );
  if (res.status === 401 || res.status === 403) throw new CookieError(`認証エラー(${res.status})`);
  if (res.status === 429) throw new RateLimitError('レート制限(429)');
  if (res.status === 404) {
    return {
      profile: { ...emptyProfile(), fetchError: 'アカウントが存在しません（退会済みの可能性）' },
      picUrl: null,
    };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { data?: { user?: IgUser | null } };
  const u = json.data?.user;
  if (!u) {
    return {
      profile: { ...emptyProfile(), fetchError: 'アカウントが存在しません（退会済みの可能性）' },
      picUrl: null,
    };
  }
  return {
    profile: {
      ...emptyProfile(),
      displayName: u.full_name || null,
      bio: u.biography || null,
      followerCount: u.edge_followed_by?.count ?? null,
      followingCount: u.edge_follow?.count ?? null,
      postCount: u.edge_owner_to_timeline_media?.count ?? null,
      isPrivate: u.is_private ?? null,
      isVerified: u.is_verified ?? null,
    },
    picUrl: u.profile_pic_url_hd ?? u.profile_pic_url ?? null,
  };
}

async function downloadPic(
  username: string,
  url: string,
  fetchFn: FetchLike,
): Promise<string | null> {
  try {
    const res = await fetchFn(url, { headers: { 'user-agent': UA } });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const dir = join(dataDir(), 'profiles');
    await mkdir(dir, { recursive: true });
    const safe = username.replace(/[^a-zA-Z0-9._-]/g, '_');
    await writeFile(join(dir, `${safe}.jpg`), buf);
    return `/profiles/${safe}.jpg`;
  } catch {
    return null;
  }
}

async function saveProfile(username: string, profile: Profile): Promise<void> {
  await withStore(async () => {
    const file = await loadAccounts();
    const account = file.accounts.find((a) => a.username === username);
    if (!account) return;
    account.profile = profile;
    await saveAccounts({ updatedAt: new Date().toISOString(), accounts: file.accounts });
  });
}

export async function runEnrich(fetchFn: FetchLike = fetch, sleepFn: SleepLike = sleep): Promise<void> {
  if (status.state === 'running') return;
  Object.assign(status, { state: 'running', reason: null, total: 0, done: 0, failed: 0, current: null });
  abort = false;

  const cookie = await loadCookie();
  if (!cookie) {
    Object.assign(status, { state: 'stopped', reason: 'Cookieが未設定です。下の手順で設定してください。' });
    return;
  }
  const file = await loadAccounts();
  const targets = file.accounts.filter((a) => !a.profile?.fetchedAt);
  status.total = targets.length;
  if (targets.length === 0) {
    status.state = 'done';
    return;
  }

  let consecutiveFails = 0;
  for (const account of targets) {
    if (abort) {
      Object.assign(status, { state: 'stopped', reason: '手動停止しました。', current: null });
      return;
    }
    status.current = account.username;
    try {
      const { profile, picUrl } = await fetchProfile(account.username, cookie, fetchFn);
      if (picUrl) profile.picPath = await downloadPic(account.username, picUrl, fetchFn);
      profile.fetchedAt = new Date().toISOString();
      await saveProfile(account.username, profile);
      status.done++;
      consecutiveFails = 0;
    } catch (e) {
      if (e instanceof CookieError) {
        Object.assign(status, {
          state: 'stopped',
          reason: 'Cookieが無効になっています。再設定してから再開してください。',
          current: null,
        });
        return;
      }
      if (e instanceof RateLimitError) {
        Object.assign(status, {
          state: 'stopped',
          reason: 'レート制限(429)を検知したため自動停止しました。数時間おいてから再開してください。',
          current: null,
        });
        return;
      }
      status.failed++;
      consecutiveFails++;
      await saveProfile(account.username, {
        ...emptyProfile(),
        fetchedAt: new Date().toISOString(),
        fetchError: (e as Error).message,
      });
      if (consecutiveFails >= 3) {
        Object.assign(status, {
          state: 'stopped',
          reason: '連続3件失敗したため自動停止しました。時間をおいて再開してください。',
          current: null,
        });
        return;
      }
    }
    await sleepFn(nextInterval());
  }
  Object.assign(status, { state: 'done', current: null });
}
```

- [ ] **Step 4: `npm test -w server -- src/enricher.test.ts` → 全PASS（8件）**

注: テストの `fetchFn.mock.calls[0][0]` の型で tsc が文句を言う場合は `String(fetchFn.mock.calls[0]![0])` 等に最小修正してよい（報告すること）。

- [ ] **Step 5: `npx -w server tsc --noEmit` クリーン → コミット**

```bash
git add server/src/enricher.ts server/src/enricher.test.ts
git commit -m "enricher: 低速直列のプロフィール取得ワーカー（自動停止付き）"
```

---

### Task 3: API接続（cookie設定・enrich操作・画像配信・書き込み直列化）

**Files:**
- Modify: `server/src/app.ts`
- Test: `server/src/app.test.ts`（追記）

- [ ] **Step 1: 失敗するテストを追記（app.test.ts 末尾に追加）**

```ts
describe('settings/enrich API', () => {
  it('Cookie設定: sessionidを含まないと400、設定後は configured=true', async () => {
    const before = await (await app.request('/api/settings/cookie')).json();
    expect(before.configured).toBe(false);
    const bad = await app.request('/api/settings/cookie', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cookie: 'foo=bar' }),
    });
    expect(bad.status).toBe(400);
    const ok = await app.request('/api/settings/cookie', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cookie: 'sessionid=abc; ds_user_id=1' }),
    });
    expect(ok.status).toBe(200);
    const after = await (await app.request('/api/settings/cookie')).json();
    expect(after.configured).toBe(true);
  });

  it('GET /api/enrich/status が状態を返す', async () => {
    const res = await app.request('/api/enrich/status');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(['idle', 'running', 'stopped', 'done']).toContain(body.state);
  });

  it('POST /api/enrich/stop は200', async () => {
    const res = await app.request('/api/enrich/stop', { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('/profiles/:file はパストラバーサルを拒否する', async () => {
    const res = await app.request('/profiles/..%2Faccounts.json');
    expect([400, 404]).toContain(res.status);
  });
});
```

注: `POST /api/enrich/start` は実ネットワークに出るためAPIテストでは叩かない（enricher本体はTask 2でモック済みテスト済み）。

- [ ] **Step 2: `npm test -w server -- src/app.test.ts` → 新4件FAIL**

- [ ] **Step 3: app.ts を変更**

3a. import に追加:

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getEnrichStatus, runEnrich, stopEnrich } from './enricher.js';
import {
  dataDir,
  loadAccounts,
  loadCookie,
  saveAccounts,
  saveCookie,
  saveImportSnapshot,
  withStore,
} from './store.js';
```

3b. 既存の書き込み系3ハンドラ（import / PATCH / queue/bulk）の「loadAccounts〜saveAccounts」部分を `withStore(async () => { ... })` で包む。例（PATCH）:

```ts
  const result = await withStore(async () => {
    const file = await loadAccounts();
    const account = file.accounts.find((a) => a.username === username);
    if (!account) return null;
    if (hasStatus) {
      account.status = body.status as AccountStatus;
      account.statusChangedAt = new Date().toISOString();
    }
    if (hasQueued) account.queued = body.queued as boolean;
    await saveAccounts({ updatedAt: new Date().toISOString(), accounts: file.accounts });
    return account;
  });
  if (!result) return c.json({ error: 'アカウントが見つかりません' }, 404);
  return c.json({ account: result });
```

import は `mergeAccounts〜saveAccounts` を、queue/bulk は `loadAccounts〜saveAccounts` を同様に包む（返り値で updated 件数などを受け取る）。ロジックは変えないこと。

3c. 末尾に新ルートを追加:

```ts
app.get('/api/settings/cookie', async (c) => c.json({ configured: (await loadCookie()) !== null }));

app.post('/api/settings/cookie', async (c) => {
  const body = await c.req.json<{ cookie?: string }>().catch(() => ({}) as { cookie?: string });
  const cookie = (body.cookie ?? '').trim();
  if (!cookie.includes('sessionid=')) {
    return c.json({ error: 'sessionid を含むCookie文字列を貼り付けてください' }, 400);
  }
  await saveCookie(cookie);
  return c.json({ ok: true });
});

app.post('/api/enrich/start', (c) => {
  void runEnrich(); // 裏で直列実行。進捗は /api/enrich/status で取得
  return c.json(getEnrichStatus());
});

app.post('/api/enrich/stop', (c) => {
  stopEnrich();
  return c.json(getEnrichStatus());
});

app.get('/api/enrich/status', (c) => c.json(getEnrichStatus()));

app.get('/profiles/:file', async (c) => {
  const file = c.req.param('file');
  if (!/^[a-zA-Z0-9._-]+$/.test(file)) return c.notFound();
  try {
    const buf = await readFile(join(dataDir(), 'profiles', file));
    return c.body(new Uint8Array(buf), 200, {
      'content-type': 'image/jpeg',
      'cache-control': 'public, max-age=86400',
    });
  } catch {
    return c.notFound();
  }
});
```

- [ ] **Step 4: `npm test -w server` → 全PASS（36件前後: 既存24 + enricher 8 + 新4）**

- [ ] **Step 5: `npx -w server tsc --noEmit` クリーン → コミット**

```bash
git add server/src/app.ts server/src/app.test.ts
git commit -m "API: Cookie設定・プロフィール取得の開始/停止/進捗・画像配信"
```

---

### Task 4: Web UI（EnrichPanel・カードのフォロワー数）

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/api.ts`
- Create: `web/src/EnrichPanel.tsx`
- Modify: `web/src/ImportView.tsx`
- Modify: `web/src/AccountCard.tsx`
- Modify: `web/src/styles.css`（末尾に追加）

- [ ] **Step 1: types.ts 末尾に追加**

```ts
export interface EnrichStatus {
  state: 'idle' | 'running' | 'stopped' | 'done';
  reason: string | null;
  total: number;
  done: number;
  failed: number;
  current: string | null;
}
```

- [ ] **Step 2: api.ts に追記（import に EnrichStatus を追加し、末尾に以下）**

```ts
export function getCookieConfigured(): Promise<boolean> {
  return fetch('/api/settings/cookie')
    .then((r) => handle<{ configured: boolean }>(r))
    .then((b) => b.configured);
}

export function saveCookieValue(cookie: string): Promise<void> {
  return fetch('/api/settings/cookie', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cookie }),
  })
    .then((r) => handle<{ ok: boolean }>(r))
    .then(() => undefined);
}

export function enrichStart(): Promise<EnrichStatus> {
  return fetch('/api/enrich/start', { method: 'POST' }).then((r) => handle<EnrichStatus>(r));
}

export function enrichStop(): Promise<EnrichStatus> {
  return fetch('/api/enrich/stop', { method: 'POST' }).then((r) => handle<EnrichStatus>(r));
}

export function enrichStatus(): Promise<EnrichStatus> {
  return fetch('/api/enrich/status').then((r) => handle<EnrichStatus>(r));
}
```

- [ ] **Step 3: EnrichPanel.tsx を作成**

```tsx
import { useEffect, useState } from 'react';
import {
  enrichStart,
  enrichStatus,
  enrichStop,
  getCookieConfigured,
  saveCookieValue,
} from './api';
import type { EnrichStatus } from './types';

const STATE_LABEL: Record<EnrichStatus['state'], string> = {
  idle: '未実行',
  running: '取得中…',
  stopped: '停止',
  done: '完了',
};

export default function EnrichPanel() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [cookie, setCookie] = useState('');
  const [st, setSt] = useState<EnrichStatus | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getCookieConfigured().then(setConfigured).catch(() => setConfigured(false));
    enrichStatus().then(setSt).catch(() => {});
  }, []);

  useEffect(() => {
    if (st?.state !== 'running') return;
    const id = window.setInterval(() => {
      enrichStatus().then(setSt).catch(() => {});
    }, 2000);
    return () => window.clearInterval(id);
  }, [st?.state]);

  const onSaveCookie = () => {
    setError('');
    saveCookieValue(cookie)
      .then(() => {
        setConfigured(true);
        setCookie('');
      })
      .catch((e: Error) => setError(e.message));
  };

  const onStart = () => {
    setError('');
    enrichStart().then(setSt).catch((e: Error) => setError(e.message));
  };

  const onStop = () => {
    enrichStop().then(setSt).catch((e: Error) => setError(e.message));
  };

  const attempted = st ? st.done + st.failed : 0;
  const pct = st && st.total > 0 ? Math.round((attempted / st.total) * 100) : 0;

  return (
    <div className="enrich-panel">
      <h2>プロフィール自動取得</h2>
      <p className="muted">
        あなたのログインCookieを使って、写真・自己紹介・フォロワー数を1件ずつゆっくり（3〜5秒間隔）取得します。
        エラーを検知すると自動停止する安全設計です。取得済みのアカウントはスキップされます。
      </p>

      <h3>1. Cookieの設定 {configured && <span className="ok-badge">設定済み ✅</span>}</h3>
      <details className="guide-details">
        <summary>Cookieの取り方（クリックで開く）</summary>
        <ol className="guide">
          <li>Chromeで instagram.com を開いてログインする</li>
          <li>⌘⌥I でデベロッパーツールを開き、「ネットワーク」タブを選ぶ</li>
          <li>⌘R でページを再読み込みし、一覧の一番上の項目（www.instagram.com）をクリック</li>
          <li>「ヘッダー」→「リクエストヘッダー」の <code>cookie:</code> の値を全部コピーして下に貼り付ける</li>
        </ol>
      </details>
      <div className="cookie-form">
        <textarea
          rows={3}
          placeholder="cookie: の値をここに貼り付け（sessionid=... を含む長い文字列）"
          value={cookie}
          onChange={(e) => setCookie(e.target.value)}
        />
        <button disabled={cookie.trim() === ''} onClick={onSaveCookie}>
          保存
        </button>
      </div>

      <h3>2. 取得の実行</h3>
      <div className="enrich-controls">
        <button disabled={!configured || st?.state === 'running'} onClick={onStart}>
          {st?.state === 'stopped' ? '再開する' : '取得を開始'}
        </button>
        {st?.state === 'running' && <button onClick={onStop}>停止</button>}
        {st && <span className="muted">状態: {STATE_LABEL[st.state]}</span>}
      </div>
      {st && st.total > 0 && (
        <div className="enrich-progress">
          <div className="progress-outer">
            <div className="progress-inner" style={{ width: `${pct}%` }} />
          </div>
          <div className="muted">
            {attempted} / {st.total} 件{st.failed > 0 && `（失敗 ${st.failed}）`}
            {st.current && ` ｜ 取得中: @${st.current}`}
          </div>
        </div>
      )}
      {st?.reason && <p className="warn">{st.reason}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: ImportView.tsx — import文に `import EnrichPanel from './EnrichPanel';` を追加し、最上位divの閉じタグ直前（import-summary ブロックの後）に `<hr className="divider" />` と `<EnrichPanel />` を追加**

- [ ] **Step 5: AccountCard.tsx — card-meta にフォロワー数を追加**

card-meta の div を以下に変更:

```tsx
      <div className="card-meta">
        <span>フォロー日: {fmtDate(account.followedAt)}</span>
        {profile?.followerCount != null && (
          <span>フォロワー {profile.followerCount.toLocaleString()}</span>
        )}
        <span className="status-label">{STATUS_LABEL[status]}</span>
      </div>
```

さらに `web/src/types.ts` の `Profile` に `followingCount: number | null; postCount: number | null; isPrivate: boolean | null; isVerified: boolean | null; fetchedAt: string | null; fetchError: string | null;` を追加してサーバ型と揃える（bio/displayName/followerCount/picPath は既存）。

- [ ] **Step 6: styles.css 末尾に追加**

```css
.muted { color: var(--muted); font-size: 13px; }
.warn { color: #f0b35e; }
.ok-badge { font-size: 13px; color: #6fd394; margin-left: 8px; }
.divider { border: none; border-top: 1px solid var(--border); margin: 28px 0; }
.enrich-panel h3 { margin: 18px 0 8px; font-size: 15px; }
.guide-details { color: var(--muted); font-size: 14px; margin-bottom: 8px; }
.guide-details summary { cursor: pointer; }
.cookie-form { display: flex; gap: 8px; align-items: flex-start; }
.cookie-form textarea { flex: 1; background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-family: monospace; font-size: 12px; }
.enrich-controls { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.enrich-progress { margin: 8px 0; display: flex; flex-direction: column; gap: 6px; }
.progress-outer { height: 8px; background: var(--panel); border: 1px solid var(--border); border-radius: 999px; overflow: hidden; }
.progress-inner { height: 100%; background: var(--accent); transition: width 0.5s; }
```

- [ ] **Step 7: 検証とコミット**

Run: `npx -w web tsc --noEmit` クリーン、`npm run build -w web` 成功

```bash
git add web/src/
git commit -m "取得UI: Cookie設定・進捗バー・フォロワー数表示"
```

---

### Task 5: 通しE2E（メインセッションが実施）

- [ ] `npm test` 全PASS
- [ ] サーバ再起動 → Cookie未設定で「取得を開始」→「Cookieが未設定です」の停止表示
- [ ] Cookie設定フォームのバリデーション（sessionidなし→エラー表示）
- [ ] ユーザーに実Cookieを設定してもらい、数件取得できること・カードに写真が出ることを確認
- [ ] mainへマージ

## 完了条件

- Cookie設定→開始→進捗バー→完了/自動停止 の一連が動く
- 取得結果（写真・名前・bio・フォロワー数）がカードに表示される
- 失敗アカウントはユーザー名表示のまま、アプリは正常動作
- 全テストPASS・規約上危険な並列化や間隔短縮がないこと（レビューで確認）
