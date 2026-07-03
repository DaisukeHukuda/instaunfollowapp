import { describe, expect, it } from 'vitest';
import { classify } from './classifier.js';
import type { ExportEntry } from './types.js';

const entry = (username: string, timestamp: number | null = null): ExportEntry => ({
  username,
  href: `https://www.instagram.com/${username}`,
  timestamp,
});

describe('classify', () => {
  it('相互・片思い・ファンを分類する', () => {
    const followers = [entry('mutual_a'), entry('fan_b')];
    const following = [entry('mutual_a'), entry('oneway_c')];
    const accounts = classify(followers, following);
    const byName = Object.fromEntries(accounts.map((a) => [a.username, a]));
    expect(byName['mutual_a'].relationship).toBe('mutual');
    expect(byName['oneway_c'].relationship).toBe('followingOnly');
    expect(byName['fan_b'].relationship).toBe('followerOnly');
    expect(accounts).toHaveLength(3);
  });

  it('タイムスタンプ（UNIX秒）をISO文字列に変換する', () => {
    const accounts = classify([entry('a', 1700000000)], [entry('a', 1600000000)]);
    expect(accounts[0].followerSince).toBe('2023-11-14T22:13:20.000Z');
    expect(accounts[0].followedAt).toBe('2020-09-13T12:26:40.000Z');
  });

  it('初期状態は pending / queued=false / profile=null', () => {
    const [a] = classify([], [entry('x')]);
    expect(a.status).toBe('pending');
    expect(a.queued).toBe(false);
    expect(a.profile).toBeNull();
    expect(a.profileUrl).toBe('https://www.instagram.com/x/');
  });

  it('空入力なら空配列', () => {
    expect(classify([], [])).toEqual([]);
  });
});
