import type { Account, ExportEntry, Relationship } from './types.js';

const toIso = (ts: number | null): string | null =>
  ts ? new Date(ts * 1000).toISOString() : null;

/** フォロワー/フォロー中の2リストから Account 配列を作る（純粋関数） */
export function classify(followers: ExportEntry[], following: ExportEntry[]): Account[] {
  const followerMap = new Map(followers.map((e) => [e.username, e]));
  const followingMap = new Map(following.map((e) => [e.username, e]));
  const usernames = new Set([...followerMap.keys(), ...followingMap.keys()]);

  const accounts: Account[] = [];
  for (const username of usernames) {
    const follower = followerMap.get(username);
    const followee = followingMap.get(username);
    const relationship: Relationship =
      follower && followee ? 'mutual' : followee ? 'followingOnly' : 'followerOnly';
    accounts.push({
      username,
      profileUrl: `https://www.instagram.com/${username}/`,
      relationship,
      followedAt: toIso(followee?.timestamp ?? null),
      followerSince: toIso(follower?.timestamp ?? null),
      status: 'pending',
      statusChangedAt: null,
      queued: false,
      profile: null,
    });
  }
  return accounts.sort((a, b) => a.username.localeCompare(b.username));
}
