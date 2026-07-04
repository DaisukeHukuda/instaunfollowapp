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
  return mapIgUser(json.data?.user ?? null);
}

/** Instagramの user オブジェクトを Profile に変換する純粋関数（ブラウザ取り込みでも再利用） */
export function mapIgUser(u: IgUser | null | undefined): {
  profile: Profile;
  picUrl: string | null;
} {
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

/** data URL（data:image/jpeg;base64,...）をローカルに保存し、公開パスを返す */
export async function savePicFromDataUrl(
  username: string,
  dataUrl: string,
): Promise<string | null> {
  const m = /^data:image\/\w+;base64,(.+)$/s.exec(dataUrl);
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  const dir = join(dataDir(), 'profiles');
  await mkdir(dir, { recursive: true });
  const safe = username.replace(/[^a-zA-Z0-9._-]/g, '_');
  await writeFile(join(dir, `${safe}.jpg`), buf);
  return `/profiles/${safe}.jpg`;
}

/**
 * ブラウザ側（ログイン済み）で取得した raw user を受け取り保存する。
 * picDataUrl があればそれを画像として保存（ブラウザ取り込み）、無ければ picUrl からDL（サーバ取得）。
 */
export async function ingestProfile(
  username: string,
  rawUser: IgUser | null,
  picDataUrl: string | null = null,
  fetchFn: FetchLike = fetch,
): Promise<void> {
  const { profile, picUrl } = mapIgUser(rawUser);
  if (picDataUrl) profile.picPath = await savePicFromDataUrl(username, picDataUrl);
  else if (picUrl) profile.picPath = await downloadPic(username, picUrl, fetchFn);
  profile.fetchedAt = new Date().toISOString();
  await saveProfile(username, profile);
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

export interface EnrichScope {
  /** 'mutual' | 'followingOnly' | 'followerOnly' で関係性を絞る */
  relationship?: string;
  /** キューに入っているものだけ */
  onlyQueued?: boolean;
  /** 先頭 N 件だけ（動作確認用） */
  limit?: number;
}

export async function runEnrich(
  fetchFn: FetchLike = fetch,
  sleepFn: SleepLike = sleep,
  scope: EnrichScope = {},
): Promise<void> {
  if (status.state === 'running') return;
  Object.assign(status, { state: 'running', reason: null, total: 0, done: 0, failed: 0, current: null });
  abort = false;

  const cookie = await loadCookie();
  if (!cookie) {
    Object.assign(status, { state: 'stopped', reason: 'Cookieが未設定です。下の手順で設定してください。' });
    return;
  }
  const file = await loadAccounts();
  let targets = file.accounts.filter((a) => !a.profile?.fetchedAt);
  if (scope.relationship) targets = targets.filter((a) => a.relationship === scope.relationship);
  if (scope.onlyQueued) targets = targets.filter((a) => a.queued);
  if (typeof scope.limit === 'number' && scope.limit >= 0) targets = targets.slice(0, scope.limit);
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
