import { strFromU8, unzipSync } from 'fflate';
import type { Account, ExportEntry } from './types.js';

export class ImportError extends Error {}

interface RawStringListItem {
  href?: string;
  value?: string;
  timestamp?: number;
}

interface RawEntry {
  title?: string;
  string_list_data?: RawStringListItem[];
}

/** href（https://www.instagram.com/xxx や .../_u/xxx）の末尾パスをユーザー名として取り出す */
function usernameFromHref(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const segments = new URL(href).pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    return last && last !== '_u' ? last : null;
  } catch {
    return null;
  }
}

/**
 * 素の配列 / { キー: 配列 } のオブジェクト包み、どちらの形式にも対応。
 * ユーザー名の場所もエクスポート時期・ファイルにより揺れる:
 * followers系は string_list_data[].value、following系は項目の title（valueなし）に入る。
 */
function extractEntries(json: unknown): ExportEntry[] {
  const arr: RawEntry[] = Array.isArray(json)
    ? (json as RawEntry[])
    : ((Object.values(json as Record<string, unknown>).find(Array.isArray) as
        | RawEntry[]
        | undefined) ?? []);
  const entries: ExportEntry[] = [];
  for (const item of arr) {
    for (const s of item.string_list_data ?? []) {
      const username = s.value ?? (item.title || null) ?? usernameFromHref(s.href);
      if (!username) continue;
      entries.push({
        username,
        href: s.href ?? `https://www.instagram.com/${username}/`,
        timestamp: s.timestamp ?? null,
      });
    }
  }
  return entries;
}

export function parseExportZip(zip: Uint8Array): {
  followers: ExportEntry[];
  following: ExportEntry[];
} {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip);
  } catch {
    throw new ImportError('ZIPとして読み取れませんでした。エクスポートのZIPファイルか確認してください。');
  }
  const paths = Object.keys(files);
  const followerPaths = paths.filter((p) => /followers(_\d+)?\.json$/.test(p));
  const followingPaths = paths.filter((p) => /(^|\/)following\.json$/.test(p));

  if (followerPaths.length === 0 || followingPaths.length === 0) {
    const hasHtml = paths.some((p) => /followers.*\.html$/.test(p));
    throw new ImportError(
      hasHtml
        ? 'HTML形式のエクスポートです。Instagramの「フォーマット」で JSON を選んで再申請してください。'
        : 'ZIP内にフォロワー/フォロー中のJSONが見つかりません。「フォロワーとフォロー中」を含むJSON形式のエクスポートか確認してください。',
    );
  }

  const parse = (path: string): ExportEntry[] => {
    try {
      return extractEntries(JSON.parse(strFromU8(files[path])));
    } catch {
      throw new ImportError(`${path} の解析に失敗しました。`);
    }
  };
  return {
    followers: followerPaths.flatMap(parse),
    following: followingPaths.flatMap(parse),
  };
}

/** 再取り込み時、ユーザーの操作記録（status等）とプロフィールを引き継ぐ */
export function mergeAccounts(existing: Account[], fresh: Account[]): Account[] {
  const prev = new Map(existing.map((a) => [a.username, a]));
  const now = new Date().toISOString();
  return fresh.map((a) => {
    const old = prev.get(a.username);
    if (!old) return a;
    // 「アンフォロー済み」にしたのにまだフォロー中 → 実際は未完了なので未処理に戻す
    if (old.status === 'unfollowed' && a.relationship !== 'followerOnly') {
      return { ...a, status: 'pending' as const, statusChangedAt: now, queued: old.queued, profile: old.profile };
    }
    return {
      ...a,
      status: old.status,
      statusChangedAt: old.statusChangedAt,
      queued: old.queued,
      profile: old.profile,
    };
  });
}

export interface ImportDiff {
  newFollowers: string[];
  lostFollowers: string[];
  newFollowing: string[];
  /** アンフォロー済みにしていて、実際にフォロー中リストから消えた */
  unfollowConfirmed: string[];
  /** アンフォロー済みにしたのに、まだフォロー中リストにいる */
  unfollowIncomplete: string[];
  /** フォローしたが実際にフォロー中リストに反映された */
  followBackConfirmed: string[];
}

export function diffAccounts(prev: Account[], fresh: Account[]): ImportDiff {
  const followers = (list: Account[]) =>
    new Set(list.filter((a) => a.relationship !== 'followingOnly').map((a) => a.username));
  const following = (list: Account[]) =>
    new Set(list.filter((a) => a.relationship !== 'followerOnly').map((a) => a.username));
  const prevFollowers = followers(prev);
  const freshFollowers = followers(fresh);
  const prevFollowing = following(prev);
  const freshFollowing = following(fresh);
  return {
    newFollowers: [...freshFollowers].filter((u) => !prevFollowers.has(u)),
    lostFollowers: [...prevFollowers].filter((u) => !freshFollowers.has(u)),
    newFollowing: [...freshFollowing].filter((u) => !prevFollowing.has(u)),
    unfollowConfirmed: prev
      .filter((a) => a.status === 'unfollowed' && !freshFollowing.has(a.username))
      .map((a) => a.username),
    unfollowIncomplete: prev
      .filter((a) => a.status === 'unfollowed' && freshFollowing.has(a.username))
      .map((a) => a.username),
    followBackConfirmed: prev
      .filter((a) => a.status === 'followedBack' && freshFollowing.has(a.username))
      .map((a) => a.username),
  };
}
