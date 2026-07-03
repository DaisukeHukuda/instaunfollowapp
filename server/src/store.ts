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
