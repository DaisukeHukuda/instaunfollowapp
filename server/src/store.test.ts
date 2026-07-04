import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAccounts, saveAccounts } from './store.js';
import type { AccountsFile } from './types.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ifm-store-'));
  process.env.DATA_DIR = dir;
});

afterEach(async () => {
  delete process.env.DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

const sample: AccountsFile = {
  updatedAt: '2026-07-03T00:00:00.000Z',
  accounts: [
    {
      username: 'alice',
      profileUrl: 'https://www.instagram.com/alice/',
      relationship: 'mutual',
      followedAt: null,
      followerSince: null,
      status: 'pending',
      statusChangedAt: null,
      queued: false,
      profile: null,
    },
  ],
};

describe('store', () => {
  it('ファイルが無ければ空のAccountsFileを返す', async () => {
    const file = await loadAccounts();
    expect(file.accounts).toEqual([]);
  });

  it('保存して読み戻せる', async () => {
    await saveAccounts(sample);
    const file = await loadAccounts();
    expect(file).toEqual(sample);
  });

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

  it('last-diff を保存・読込できる（未保存はnull）', async () => {
    const { loadLastDiff, saveLastDiff } = await import('./store.js');
    expect(await loadLastDiff()).toBeNull();
    const diff = { importedAt: '2026-07-04T00:00:00.000Z', newFollowers: ['a'] };
    await saveLastDiff(diff);
    expect(await loadLastDiff()).toEqual(diff);
  });
});
