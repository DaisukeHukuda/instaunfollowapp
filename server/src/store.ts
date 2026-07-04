import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AccountsFile } from './types.js';

// server/src/store.ts から見て ../../data = プロジェクト直下の data/
const defaultDataDir = fileURLToPath(new URL('../../data/', import.meta.url));

export function dataDir(): string {
  return process.env.DATA_DIR ?? defaultDataDir;
}

export async function loadAccounts(): Promise<AccountsFile> {
  try {
    const raw = await readFile(join(dataDir(), 'accounts.json'), 'utf8');
    return JSON.parse(raw) as AccountsFile;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { updatedAt: '', accounts: [] };
    }
    throw e;
  }
}

/** 一時ファイルに書いてから rename（書き込み途中のクラッシュで壊れないように） */
export async function saveAccounts(file: AccountsFile): Promise<void> {
  const dir = dataDir();
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, 'accounts.json.tmp');
  await writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
  await rename(tmp, join(dir, 'accounts.json'));
}

/** 取り込みスナップショット（ステップ4の差分計算で使用） */
export async function saveImportSnapshot(name: string, data: unknown): Promise<void> {
  const dir = join(dataDir(), 'imports');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.json`), JSON.stringify(data, null, 2), 'utf8');
}

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

export async function saveLastDiff(diff: unknown): Promise<void> {
  const dir = dataDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'last-diff.json'), JSON.stringify(diff, null, 2), 'utf8');
}

export async function loadLastDiff(): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(join(dataDir(), 'last-diff.json'), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}
