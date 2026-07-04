import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ImportError, mergeAccounts, parseExportZip } from './importer.js';
import { classify } from './classifier.js';

const igEntry = (username: string, timestamp = 1700000000) => ({
  title: '',
  media_list_data: [],
  string_list_data: [
    { href: `https://www.instagram.com/${username}`, value: username, timestamp },
  ],
});

const makeZip = (files: Record<string, unknown>): Uint8Array =>
  zipSync(
    Object.fromEntries(
      Object.entries(files).map(([path, json]) => [path, strToU8(JSON.stringify(json))]),
    ),
  );

describe('parseExportZip', () => {
  it('followers_N.json（分割）と following.json を読み取る', () => {
    const zip = makeZip({
      'connections/followers_and_following/followers_1.json': [igEntry('a'), igEntry('b')],
      'connections/followers_and_following/followers_2.json': [igEntry('c')],
      'connections/followers_and_following/following.json': {
        relationships_following: [igEntry('b'), igEntry('d')],
      },
    });
    const { followers, following } = parseExportZip(zip);
    expect(followers.map((e) => e.username).sort()).toEqual(['a', 'b', 'c']);
    expect(following.map((e) => e.username).sort()).toEqual(['b', 'd']);
    expect(followers[0].timestamp).toBe(1700000000);
  });

  it('HTML形式のエクスポートならJSON再申請を促すエラー', () => {
    const zip = zipSync({
      'connections/followers_and_following/followers_1.html': strToU8('<html></html>'),
    });
    expect(() => parseExportZip(zip)).toThrow(ImportError);
    expect(() => parseExportZip(zip)).toThrow(/JSON/);
  });

  it('対象ファイルが無いZIPはエラー', () => {
    const zip = makeZip({ 'unrelated.json': [] });
    expect(() => parseExportZip(zip)).toThrow(ImportError);
  });

  it('value欠落時は title や href からユーザー名を補完する（実エクスポートのfollowing形式）', () => {
    const zip = makeZip({
      'connections/followers_and_following/followers_1.json': [igEntry('a')],
      'connections/followers_and_following/following.json': {
        relationships_following: [
          {
            title: 'from_title',
            string_list_data: [
              { href: 'https://www.instagram.com/_u/from_title', timestamp: 1780000000 },
            ],
          },
          {
            title: '',
            string_list_data: [
              { href: 'https://www.instagram.com/from_href', timestamp: 1780000001 },
            ],
          },
        ],
      },
    });
    const { following } = parseExportZip(zip);
    expect(following.map((e) => e.username)).toEqual(['from_title', 'from_href']);
    expect(following[0].timestamp).toBe(1780000000);
  });
});

describe('mergeAccounts', () => {
  it('既存アカウントの status / queued / profile を引き継ぐ', () => {
    const old = classify([igEntry('a')].flatMap((e) => e.string_list_data.map((s) => ({ username: s.value, href: s.href, timestamp: s.timestamp }))), [igEntry('a')].flatMap((e) => e.string_list_data.map((s) => ({ username: s.value, href: s.href, timestamp: s.timestamp }))));
    old[0].status = 'keep';
    old[0].queued = true;
    const freshFollowers = [igEntry('a'), igEntry('b')].flatMap((e) => e.string_list_data.map((s) => ({ username: s.value, href: s.href, timestamp: s.timestamp })));
    const freshFollowing = [igEntry('a')].flatMap((e) => e.string_list_data.map((s) => ({ username: s.value, href: s.href, timestamp: s.timestamp })));
    const fresh = classify(freshFollowers, freshFollowing);
    const merged = mergeAccounts(old, fresh);
    const a = merged.find((x) => x.username === 'a')!;
    const b = merged.find((x) => x.username === 'b')!;
    expect(a.status).toBe('keep');
    expect(a.queued).toBe(true);
    expect(b.status).toBe('pending');
  });

  it('新リストに存在しないアカウントは消える', () => {
    const gone = [{ username: 'gone', href: 'https://www.instagram.com/gone', timestamp: 1700000000 }];
    const stay = [{ username: 'stay', href: 'https://www.instagram.com/stay', timestamp: 1700000000 }];
    const old = classify(gone, []);
    const fresh = classify(stay, []);
    const merged = mergeAccounts(old, fresh);
    expect(merged.map((a) => a.username)).toEqual(['stay']);
  });
});

describe('diffAccounts', () => {
  const acc = (
    username: string,
    relationship: 'mutual' | 'followingOnly' | 'followerOnly',
    status: 'pending' | 'unfollowed' | 'followedBack' | 'keep' = 'pending',
  ) => ({
    username,
    profileUrl: `https://www.instagram.com/${username}/`,
    relationship,
    followedAt: null,
    followerSince: null,
    status,
    statusChangedAt: null,
    queued: false,
    profile: null,
  });

  it('新規/離脱フォロワー・アンフォロー確定/未完了・フォローバック反映を検出する', async () => {
    const { diffAccounts } = await import('./importer.js');
    const prev = [
      acc('stay_mutual', 'mutual'),
      acc('lost_fan', 'followerOnly'),
      acc('unfollowed_ok', 'followingOnly', 'unfollowed'),
      acc('unfollowed_ng', 'followingOnly', 'unfollowed'),
      acc('fb_done', 'followerOnly', 'followedBack'),
    ];
    const fresh = [
      acc('stay_mutual', 'mutual'),
      acc('new_fan', 'followerOnly'),
      acc('unfollowed_ng', 'followingOnly'),
      acc('fb_done', 'mutual'),
    ];
    const diff = diffAccounts(prev, fresh);
    expect(diff.newFollowers).toEqual(['new_fan']);
    expect(diff.lostFollowers).toEqual(['lost_fan']);
    expect(diff.unfollowConfirmed).toEqual(['unfollowed_ok']);
    expect(diff.unfollowIncomplete).toEqual(['unfollowed_ng']);
    expect(diff.followBackConfirmed).toEqual(['fb_done']);
    expect(diff.newFollowing).toEqual(['fb_done']);
  });

  it('mergeAccounts: アンフォロー済みなのにまだフォロー中なら pending に戻す', async () => {
    const { mergeAccounts } = await import('./importer.js');
    const prev = [acc('still_following', 'followingOnly', 'unfollowed')];
    const fresh = [acc('still_following', 'followingOnly')];
    const merged = mergeAccounts(prev, fresh);
    expect(merged[0].status).toBe('pending');
  });

  it('mergeAccounts: フォローバック済みは status を維持する', async () => {
    const { mergeAccounts } = await import('./importer.js');
    const prev = [acc('fb', 'followerOnly', 'followedBack')];
    const fresh = [acc('fb', 'mutual')];
    const merged = mergeAccounts(prev, fresh);
    expect(merged[0].status).toBe('followedBack');
  });
});
