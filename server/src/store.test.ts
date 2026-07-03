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
});
