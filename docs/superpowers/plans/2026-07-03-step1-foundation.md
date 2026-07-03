# ステップ1: 土台＋ZIP解析＋一覧画面 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instagramの公式エクスポートZIPを取り込み、関係性（相互/片思い/ファン）を分類した一覧画面で手動整理（アンフォロー済み/フォローした/残す）ができるローカルWebアプリを完成させる。

**Architecture:** Node + Hono のローカルサーバが ZIP解析・分類・永続化（`data/accounts.json`）とAPIを担当し、Vite + React のSPAが一覧UIを提供する。npm workspaces のモノレポ（`server/` + `web/`）。設計書: `docs/superpowers/specs/2026-07-03-insta-follow-manager-design.md`

**Tech Stack:** TypeScript / Node 20+ / Hono / @hono/node-server / fflate（ZIP解析）/ Vitest / Vite / React 18

**このステップのスコープ外:** レビューキュー（ステップ2）、プロフィール自動取得（ステップ3）、差分・統計（ステップ4）。ただし将来の差分計算用に取り込みスナップショット保存だけは行う。

---

## ファイル構成（このステップで作るもの）

```
insta-follow-manager/
├── package.json                  # workspaces ルート。dev/start/test スクリプト
├── README.md                     # 起動方法・使い方
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── scripts/make-sample-zip.mjs   # 動作確認用サンプルZIP生成
│   └── src/
│       ├── types.ts              # Account 等の型定義
│       ├── store.ts              # data/ の読み書き（アトミック書き込み）
│       ├── classifier.ts         # 関係性分類
│       ├── importer.ts           # ZIP解析・既存データとのマージ
│       ├── app.ts                # Hono ルーティング（テスト対象）
│       ├── index.ts              # サーバ起動 + 静的配信
│       └── *.test.ts             # 各モジュールのテスト（同階層に併置）
└── web/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx               # タブ切替（一覧 / 取り込み）
        ├── types.ts              # サーバ型のうちUIが使う部分（意図的な小さな重複）
        ├── api.ts                # fetch ヘルパー
        ├── ListView.tsx          # 一覧画面（フィルタ・検索・ソート）
        ├── AccountCard.tsx       # アカウントカード
        ├── ImportView.tsx        # ZIP取り込み画面
        └── styles.css
```

**責務の境界:** `importer.ts` はZIPバイト列→エクスポート項目の変換とマージのみ。`classifier.ts` は項目→Account配列の純粋変換のみ。`store.ts` はファイルI/Oのみ。`app.ts` はHTTPの入出力とそれらの組み合わせのみ。UIはAPIの向こう側を知らない。

---

### Task 1: プロジェクト土台（workspaces + サーバ起動 + テスト基盤）

**Files:**
- Create: `package.json`（ルート）
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/src/app.ts`
- Create: `server/src/index.ts`
- Test: `server/src/app.test.ts`

- [ ] **Step 1: ルート package.json を作成**

```json
{
  "name": "insta-follow-manager",
  "private": true,
  "workspaces": ["server", "web"],
  "scripts": {
    "dev": "concurrently -n server,web -c blue,green \"npm run dev -w server\" \"npm run dev -w web\"",
    "start": "npm run build -w web && npm run start -w server",
    "test": "npm run test -w server"
  },
  "devDependencies": {
    "concurrently": "^9.1.0"
  }
}
```

- [ ] **Step 2: server/package.json と server/tsconfig.json を作成**

`server/package.json`:

```json
{
  "name": "server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.7",
    "fflate": "^0.8.2",
    "hono": "^4.6.14"
  },
  "devDependencies": {
    "@types/node": "^20.17.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

`server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 依存をインストール**

Run: プロジェクトルートで `npm install`
Expected: エラーなく完了し、`node_modules/` が作られる（webワークスペースはまだ無いが、workspacesに存在しないパスがあっても npm は警告のみで続行する。気になる場合はルートpackage.jsonのworkspacesを一時的に `["server"]` にし、Task 6 で戻してもよい）

- [ ] **Step 4: 失敗するテストを書く（ヘルスチェック）**

`server/src/app.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { app } from './app.js';

describe('app', () => {
  it('GET /api/health が ok を返す', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 5: テストが失敗することを確認**

Run: `npm test -w server`
Expected: FAIL（`./app.js` が存在しない旨のエラー）

- [ ] **Step 6: 最小実装**

`server/src/app.ts`:

```ts
import { Hono } from 'hono';

export const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: true }));
```

`server/src/index.ts`:

```ts
import { serve } from '@hono/node-server';
import { app } from './app.js';

serve({ fetch: app.fetch, port: 3900 }, (info) => {
  console.log(`insta-follow-manager: http://localhost:${info.port}`);
});
```

- [ ] **Step 7: テストが通ることを確認**

Run: `npm test -w server`
Expected: PASS（1 passed）

- [ ] **Step 8: サーバが起動することを確認**

Run: `npm run dev -w server` をバックグラウンド起動し、`curl -s http://localhost:3900/api/health`
Expected: `{"ok":true}` が返る。確認後サーバは停止してよい

- [ ] **Step 9: コミット**

```bash
git add package.json package-lock.json server/
git commit -m "土台: workspaces構成とHonoサーバ・テスト基盤"
```

---

### Task 2: 型定義とストア（data/ の読み書き）

**Files:**
- Create: `server/src/types.ts`
- Create: `server/src/store.ts`
- Test: `server/src/store.test.ts`

- [ ] **Step 1: 型定義を作成**

`server/src/types.ts`:

```ts
export type Relationship = 'mutual' | 'followingOnly' | 'followerOnly';

export type AccountStatus = 'pending' | 'unfollowed' | 'followedBack' | 'keep';

/** プロフィール補完データ（取得処理はステップ3。型だけ先に定義しておく） */
export interface Profile {
  displayName: string | null;
  bio: string | null;
  followerCount: number | null;
  followingCount: number | null;
  postCount: number | null;
  isPrivate: boolean | null;
  isVerified: boolean | null;
  picPath: string | null;
  fetchedAt: string | null;
  fetchError: string | null;
}

export interface Account {
  username: string;
  profileUrl: string;
  relationship: Relationship;
  /** 自分が相手をフォローした日時（ISO）。エクスポート由来 */
  followedAt: string | null;
  /** 相手にフォローされた日時（ISO）。エクスポート由来 */
  followerSince: string | null;
  status: AccountStatus;
  statusChangedAt: string | null;
  queued: boolean;
  profile: Profile | null;
}

export interface AccountsFile {
  updatedAt: string;
  accounts: Account[];
}

/** エクスポートZIPから取り出した1件分 */
export interface ExportEntry {
  username: string;
  href: string;
  timestamp: number | null; // UNIX秒
}
```

- [ ] **Step 2: 失敗するテストを書く**

`server/src/store.test.ts`:

```ts
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
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npm test -w server -- src/store.test.ts`
Expected: FAIL（`./store.js` が存在しない）

- [ ] **Step 4: store.ts を実装**

`server/src/store.ts`:

```ts
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
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm test -w server -- src/store.test.ts`
Expected: PASS（2 passed）

- [ ] **Step 6: コミット**

```bash
git add server/src/types.ts server/src/store.ts server/src/store.test.ts
git commit -m "型定義とストア: accounts.jsonのアトミック読み書き"
```

---

### Task 3: 関係性分類（classifier）

**Files:**
- Create: `server/src/classifier.ts`
- Test: `server/src/classifier.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`server/src/classifier.test.ts`:

```ts
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -w server -- src/classifier.test.ts`
Expected: FAIL（`./classifier.js` が存在しない）

- [ ] **Step 3: classifier.ts を実装**

`server/src/classifier.ts`:

```ts
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -w server -- src/classifier.test.ts`
Expected: PASS（4 passed）

- [ ] **Step 5: コミット**

```bash
git add server/src/classifier.ts server/src/classifier.test.ts
git commit -m "関係性分類: 相互/片思い/ファンの純粋関数"
```

---

### Task 4: ZIP解析とマージ（importer）

**Files:**
- Create: `server/src/importer.ts`
- Test: `server/src/importer.test.ts`

**前提知識（Instagramエクスポートの中身・JSON形式）:**
- フォロワー: `connections/followers_and_following/followers_1.json`（多いと `_2`, `_3`… に分割）。中身は配列で、各要素が `{ "string_list_data": [{ "href": "...", "value": "ユーザー名", "timestamp": 1699999999 }] }`
- フォロー中: 同フォルダの `following.json`。中身は `{ "relationships_following": [同じ形の要素...] }` というオブジェクト包み
- エクスポート時期によりフォルダ階層やトップレベルが素の配列/オブジェクト包みで揺れるため、**パス直書きせず正規表現で走査**し、**配列/オブジェクト包み両対応**でパースする

- [ ] **Step 1: 失敗するテストを書く**

`server/src/importer.test.ts`:

```ts
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
});

describe('mergeAccounts', () => {
  it('既存アカウントの status / queued / profile を引き継ぐ', () => {
    const old = classify([igEntry('a')], [igEntry('a')]);
    old[0].status = 'keep';
    old[0].queued = true;
    const fresh = classify([igEntry('a'), igEntry('b')], [igEntry('a')]);
    const merged = mergeAccounts(old, fresh);
    const a = merged.find((x) => x.username === 'a')!;
    const b = merged.find((x) => x.username === 'b')!;
    expect(a.status).toBe('keep');
    expect(a.queued).toBe(true);
    expect(b.status).toBe('pending');
  });

  it('新リストに存在しないアカウントは消える', () => {
    const old = classify([igEntry('gone')], []);
    const fresh = classify([igEntry('stay')], []);
    const merged = mergeAccounts(old, fresh);
    expect(merged.map((a) => a.username)).toEqual(['stay']);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -w server -- src/importer.test.ts`
Expected: FAIL（`./importer.js` が存在しない）

- [ ] **Step 3: importer.ts を実装**

`server/src/importer.ts`:

```ts
import { strFromU8, unzipSync } from 'fflate';
import type { Account, ExportEntry } from './types.js';

export class ImportError extends Error {}

interface RawStringListItem {
  href?: string;
  value?: string;
  timestamp?: number;
}

interface RawEntry {
  string_list_data?: RawStringListItem[];
}

/** 素の配列 / { キー: 配列 } のオブジェクト包み、どちらの形式にも対応 */
function extractEntries(json: unknown): ExportEntry[] {
  const arr: RawEntry[] = Array.isArray(json)
    ? (json as RawEntry[])
    : ((Object.values(json as Record<string, unknown>).find(Array.isArray) as
        | RawEntry[]
        | undefined) ?? []);
  const entries: ExportEntry[] = [];
  for (const item of arr) {
    for (const s of item.string_list_data ?? []) {
      if (!s.value) continue;
      entries.push({
        username: s.value,
        href: s.href ?? `https://www.instagram.com/${s.value}/`,
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
  return fresh.map((a) => {
    const old = prev.get(a.username);
    if (!old) return a;
    return {
      ...a,
      status: old.status,
      statusChangedAt: old.statusChangedAt,
      queued: old.queued,
      profile: old.profile,
    };
  });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -w server -- src/importer.test.ts`
Expected: PASS（5 passed）

- [ ] **Step 5: コミット**

```bash
git add server/src/importer.ts server/src/importer.test.ts
git commit -m "ZIP解析とマージ: エクスポート形式の揺れ対応とHTML形式の検出"
```

---

### Task 5: API ルーティング（app.ts）

**Files:**
- Modify: `server/src/app.ts`（Task 1 で作成済み）
- Modify: `server/src/app.test.ts`（Task 1 で作成済み）
- Modify: `server/src/index.ts`（静的配信を追加）

- [ ] **Step 1: 失敗するテストを書く（app.test.ts を全面置き換え）**

`server/src/app.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from './app.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ifm-app-'));
  process.env.DATA_DIR = dir;
});

afterEach(async () => {
  delete process.env.DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

const igEntry = (username: string, timestamp = 1700000000) => ({
  title: '',
  media_list_data: [],
  string_list_data: [
    { href: `https://www.instagram.com/${username}`, value: username, timestamp },
  ],
});

function sampleZip(): Uint8Array {
  return zipSync({
    'connections/followers_and_following/followers_1.json': strToU8(
      JSON.stringify([igEntry('mutual_a'), igEntry('fan_b')]),
    ),
    'connections/followers_and_following/following.json': strToU8(
      JSON.stringify({ relationships_following: [igEntry('mutual_a'), igEntry('oneway_c')] }),
    ),
  });
}

async function importSample() {
  const form = new FormData();
  form.append('file', new File([sampleZip()], 'export.zip', { type: 'application/zip' }));
  return app.request('/api/import', { method: 'POST', body: form });
}

describe('POST /api/import', () => {
  it('ZIPを取り込んで件数サマリーを返す', async () => {
    const res = await importSample();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      imported: 3,
      followers: 2,
      following: 2,
      mutual: 1,
      followingOnly: 1,
      followerOnly: 1,
    });
  });

  it('ファイル無しは400', async () => {
    const form = new FormData();
    const res = await app.request('/api/import', { method: 'POST', body: form });
    expect(res.status).toBe(400);
  });

  it('不正なZIPは422で日本語メッセージ', async () => {
    const form = new FormData();
    form.append('file', new File([strToU8('not a zip')], 'x.zip'));
    const res = await app.request('/api/import', { method: 'POST', body: form });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain('ZIP');
  });
});

describe('GET /api/accounts', () => {
  it('全件と件数を返す', async () => {
    await importSample();
    const res = await app.request('/api/accounts');
    const body = await res.json();
    expect(body.accounts).toHaveLength(3);
    expect(body.counts).toMatchObject({ total: 3, mutual: 1, followingOnly: 1, followerOnly: 1, pending: 3 });
  });

  it('relationship / q で絞り込める', async () => {
    await importSample();
    const rel = await (await app.request('/api/accounts?relationship=followingOnly')).json();
    expect(rel.accounts.map((a: { username: string }) => a.username)).toEqual(['oneway_c']);
    const q = await (await app.request('/api/accounts?q=FAN')).json();
    expect(q.accounts.map((a: { username: string }) => a.username)).toEqual(['fan_b']);
  });
});

describe('PATCH /api/accounts/:username', () => {
  it('statusを更新して永続化する', async () => {
    await importSample();
    const res = await app.request('/api/accounts/oneway_c', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'unfollowed' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).account.status).toBe('unfollowed');
    const after = await (await app.request('/api/accounts?status=unfollowed')).json();
    expect(after.accounts).toHaveLength(1);
  });

  it('不正なstatusは400 / 未知のユーザーは404', async () => {
    await importSample();
    const bad = await app.request('/api/accounts/oneway_c', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'nope' }),
    });
    expect(bad.status).toBe(400);
    const missing = await app.request('/api/accounts/ghost', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'keep' }),
    });
    expect(missing.status).toBe(404);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -w server -- src/app.test.ts`
Expected: FAIL（/api/import 等が404）

- [ ] **Step 3: app.ts を実装（全面置き換え）**

`server/src/app.ts`:

```ts
import { Hono } from 'hono';
import { classify } from './classifier.js';
import { ImportError, mergeAccounts, parseExportZip } from './importer.js';
import { loadAccounts, saveAccounts, saveImportSnapshot } from './store.js';
import type { Account, AccountStatus } from './types.js';

const VALID_STATUS: readonly AccountStatus[] = ['pending', 'unfollowed', 'followedBack', 'keep'];

const countBy = (accounts: Account[]) => ({
  total: accounts.length,
  mutual: accounts.filter((a) => a.relationship === 'mutual').length,
  followingOnly: accounts.filter((a) => a.relationship === 'followingOnly').length,
  followerOnly: accounts.filter((a) => a.relationship === 'followerOnly').length,
  pending: accounts.filter((a) => a.status === 'pending').length,
});

export const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: true }));

app.post('/api/import', async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) {
    return c.json({ error: 'ZIPファイルを添付してください' }, 400);
  }
  let parsed;
  try {
    parsed = parseExportZip(new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    const message = e instanceof ImportError ? e.message : 'ZIPの解析に失敗しました';
    return c.json({ error: message }, 422);
  }
  const now = new Date().toISOString();
  const fresh = classify(parsed.followers, parsed.following);
  const current = await loadAccounts();
  const accounts = mergeAccounts(current.accounts, fresh);
  await saveAccounts({ updatedAt: now, accounts });
  await saveImportSnapshot(now.replace(/[:.]/g, '-'), {
    followers: parsed.followers,
    following: parsed.following,
  });
  return c.json({
    imported: accounts.length,
    followers: parsed.followers.length,
    following: parsed.following.length,
    ...(({ total, ...rest }) => rest)(countBy(accounts)),
  });
});

app.get('/api/accounts', async (c) => {
  const { relationship, status, q, sort } = c.req.query();
  const { accounts, updatedAt } = await loadAccounts();
  let list = accounts;
  if (relationship) list = list.filter((a) => a.relationship === relationship);
  if (status) list = list.filter((a) => a.status === status);
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter(
      (a) =>
        a.username.toLowerCase().includes(needle) ||
        (a.profile?.displayName ?? '').toLowerCase().includes(needle) ||
        (a.profile?.bio ?? '').toLowerCase().includes(needle),
    );
  }
  if (sort === 'followedAsc') {
    list = [...list].sort((a, b) => (a.followedAt ?? '9999').localeCompare(b.followedAt ?? '9999'));
  } else if (sort === 'followedDesc') {
    list = [...list].sort((a, b) => (b.followedAt ?? '').localeCompare(a.followedAt ?? ''));
  }
  return c.json({ updatedAt, counts: countBy(accounts), accounts: list });
});

app.patch('/api/accounts/:username', async (c) => {
  const username = c.req.param('username');
  const body = await c.req.json<{ status?: string }>().catch(() => ({ status: undefined }));
  if (!body.status || !VALID_STATUS.includes(body.status as AccountStatus)) {
    return c.json({ error: 'status が不正です' }, 400);
  }
  const file = await loadAccounts();
  const account = file.accounts.find((a) => a.username === username);
  if (!account) return c.json({ error: 'アカウントが見つかりません' }, 404);
  account.status = body.status as AccountStatus;
  account.statusChangedAt = new Date().toISOString();
  await saveAccounts({ updatedAt: new Date().toISOString(), accounts: file.accounts });
  return c.json({ account });
});
```

注: `pending` の件数が counts に必要な一方、importのレスポンスでは `total` を `imported` と呼びたいので上のように分割代入で `total` を除いている。読みにくければ `const counts = countBy(accounts);` して個別に列挙してもよい（挙動はテストが規定する）。

- [ ] **Step 4: index.ts に静的配信を追加（全面置き換え）**

`server/src/index.ts`:

```ts
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { app } from './app.js';

// 本番モード（npm start）では web/dist をビルド済み前提で配信する。
// serveStatic の root はプロセスの cwd（server/）からの相対パス。
app.use('/*', serveStatic({ root: '../web/dist' }));
app.get('/', serveStatic({ path: '../web/dist/index.html' }));

serve({ fetch: app.fetch, port: 3900 }, (info) => {
  console.log(`insta-follow-manager: http://localhost:${info.port}`);
});
```

- [ ] **Step 5: 全テストが通ることを確認**

Run: `npm test -w server`
Expected: PASS（store/classifier/importer/app すべて。計 18 前後 passed）

- [ ] **Step 6: コミット**

```bash
git add server/src/app.ts server/src/app.test.ts server/src/index.ts
git commit -m "API: import/accounts/status更新の各エンドポイント"
```

---

### Task 6: Web土台（Vite + React + プロキシ）

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/types.ts`
- Create: `web/src/api.ts`
- Create: `web/src/styles.css`（最小限。本格的な見た目は Task 7）

- [ ] **Step 1: web パッケージの設定ファイル群を作成**

`web/package.json`:

```json
{
  "name": "web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.7.2",
    "vite": "^5.4.11"
  }
}
```

`web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src"]
}
```

`web/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3900',
    },
  },
});
```

`web/index.html`:

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Instagram フォロー整理</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: 依存をインストール**

Run: プロジェクトルートで `npm install`
Expected: web の依存が入る（Task 1 Step 3 で workspaces を `["server"]` に絞った場合はここで `["server", "web"]` に戻す）

- [ ] **Step 3: 型・APIヘルパー・App骨格を作成**

`web/src/types.ts`:

```ts
// server/src/types.ts のうちUIが使う部分の写し。
// パッケージ間import設定を持ち込まないための意図的な小さい重複。
// サーバ側の型を変えたらここも更新すること。
export type Relationship = 'mutual' | 'followingOnly' | 'followerOnly';
export type AccountStatus = 'pending' | 'unfollowed' | 'followedBack' | 'keep';

export interface Profile {
  displayName: string | null;
  bio: string | null;
  followerCount: number | null;
  picPath: string | null;
}

export interface Account {
  username: string;
  profileUrl: string;
  relationship: Relationship;
  followedAt: string | null;
  followerSince: string | null;
  status: AccountStatus;
  queued: boolean;
  profile: Profile | null;
}

export interface Counts {
  total: number;
  mutual: number;
  followingOnly: number;
  followerOnly: number;
  pending: number;
}

export interface AccountsResponse {
  updatedAt: string;
  counts: Counts;
  accounts: Account[];
}

export interface ImportSummary {
  imported: number;
  followers: number;
  following: number;
  mutual: number;
  followingOnly: number;
  followerOnly: number;
}
```

`web/src/api.ts`:

```ts
import type { Account, AccountsResponse, AccountStatus, ImportSummary } from './types';

async function handle<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export function fetchAccounts(params: {
  relationship?: string;
  status?: string;
  q?: string;
  sort?: string;
}): Promise<AccountsResponse> {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v) as [string, string][],
  );
  return fetch(`/api/accounts?${qs}`).then((r) => handle<AccountsResponse>(r));
}

export function updateStatus(username: string, status: AccountStatus): Promise<Account> {
  return fetch(`/api/accounts/${encodeURIComponent(username)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
  })
    .then((r) => handle<{ account: Account }>(r))
    .then((b) => b.account);
}

export function importZip(file: File): Promise<ImportSummary> {
  const form = new FormData();
  form.append('file', file);
  return fetch('/api/import', { method: 'POST', body: form }).then((r) =>
    handle<ImportSummary>(r),
  );
}
```

`web/src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`web/src/App.tsx`（骨格。ListView / ImportView は Task 7・8 で実装するため、まずプレースホルダの文字列を出す）:

```tsx
import { useState } from 'react';

type View = 'list' | 'import';

export default function App() {
  const [view, setView] = useState<View>('list');
  return (
    <div className="app">
      <header className="app-header">
        <h1>Instagram フォロー整理</h1>
        <nav>
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            一覧
          </button>
          <button className={view === 'import' ? 'active' : ''} onClick={() => setView('import')}>
            取り込み
          </button>
        </nav>
      </header>
      <main>{view === 'list' ? <p>一覧（Task 7 で実装）</p> : <p>取り込み（Task 8 で実装）</p>}</main>
    </div>
  );
}
```

`web/src/styles.css`（最小限）:

```css
:root {
  color-scheme: dark;
  --bg: #16181d;
  --panel: #1f232b;
  --border: #343a46;
  --text: #e8eaed;
  --muted: #9aa3b2;
  --accent: #4c8dff;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: -apple-system, "Hiragino Sans", sans-serif; }
.app { max-width: 1100px; margin: 0 auto; padding: 16px; }
.app-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.app-header h1 { font-size: 20px; }
.app-header nav { display: flex; gap: 8px; }
button { background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 8px 14px; cursor: pointer; }
button.active { border-color: var(--accent); color: var(--accent); }
button:hover { border-color: var(--accent); }
```

- [ ] **Step 4: 動作確認（dev）**

Run: プロジェクトルートで `npm run dev` をバックグラウンド起動 → `curl -s http://localhost:5173 | head -5`（HTMLが返ること）と `curl -s http://localhost:5173/api/health`（プロキシ経由で `{"ok":true}` が返ること）を確認 → 停止
Expected: 両方成功。ブラウザで見るとタブ2つとプレースホルダ文字列が表示される

- [ ] **Step 5: 本番ビルドも通ることを確認**

Run: `npm run build -w web`
Expected: `web/dist/` が生成される

- [ ] **Step 6: コミット**

```bash
git add package.json package-lock.json web/
git commit -m "Web土台: Vite+React、タブ骨格、APIプロキシ"
```

---

### Task 7: 一覧画面（ListView + AccountCard）

**Files:**
- Create: `web/src/ListView.tsx`
- Create: `web/src/AccountCard.tsx`
- Modify: `web/src/App.tsx`（プレースホルダを ListView に差し替え）
- Modify: `web/src/styles.css`（カード等のスタイル追加）

- [ ] **Step 1: AccountCard を実装**

`web/src/AccountCard.tsx`:

```tsx
import type { Account, AccountStatus } from './types';

const REL_LABEL: Record<Account['relationship'], string> = {
  mutual: '相互',
  followingOnly: '片思い',
  followerOnly: 'ファン',
};

const STATUS_LABEL: Record<AccountStatus, string> = {
  pending: '未処理',
  unfollowed: 'アンフォロー済み',
  followedBack: 'フォローした',
  keep: '残す',
};

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('ja-JP') : '—';

interface Props {
  account: Account;
  onStatusChange: (username: string, status: AccountStatus) => void;
}

export default function AccountCard({ account, onStatusChange }: Props) {
  const { username, relationship, status, profile } = account;
  const name = profile?.displayName || username;
  return (
    <div className={`card status-${status}`}>
      <div className="card-head">
        {profile?.picPath ? (
          <img className="avatar" src={profile.picPath} alt="" />
        ) : (
          <div className="avatar avatar-initial">{username[0]?.toUpperCase()}</div>
        )}
        <div className="card-title">
          <a href={account.profileUrl} target="_blank" rel="noreferrer">
            @{username}
          </a>
          {profile?.displayName && <div className="display-name">{name}</div>}
        </div>
        <span className={`badge badge-${relationship}`}>{REL_LABEL[relationship]}</span>
      </div>
      {profile?.bio && <p className="bio">{profile.bio}</p>}
      <div className="card-meta">
        <span>フォロー日: {fmtDate(account.followedAt)}</span>
        <span className="status-label">{STATUS_LABEL[status]}</span>
      </div>
      <div className="card-actions">
        <a className="btn" href={account.profileUrl} target="_blank" rel="noreferrer">
          開く
        </a>
        {relationship !== 'followerOnly' && status !== 'unfollowed' && (
          <button onClick={() => onStatusChange(username, 'unfollowed')}>アンフォロー済み</button>
        )}
        {relationship === 'followerOnly' && status !== 'followedBack' && (
          <button onClick={() => onStatusChange(username, 'followedBack')}>フォローした</button>
        )}
        {status !== 'keep' && (
          <button onClick={() => onStatusChange(username, 'keep')}>残す</button>
        )}
        {status !== 'pending' && (
          <button onClick={() => onStatusChange(username, 'pending')}>未処理に戻す</button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: ListView を実装**

`web/src/ListView.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import AccountCard from './AccountCard';
import { fetchAccounts, updateStatus } from './api';
import type { AccountsResponse, AccountStatus } from './types';

const REL_TABS = [
  { value: '', label: 'すべて' },
  { value: 'followingOnly', label: '片思い' },
  { value: 'followerOnly', label: 'ファン' },
  { value: 'mutual', label: '相互' },
] as const;

const STATUS_OPTIONS = [
  { value: '', label: '全ステータス' },
  { value: 'pending', label: '未処理' },
  { value: 'unfollowed', label: 'アンフォロー済み' },
  { value: 'followedBack', label: 'フォローした' },
  { value: 'keep', label: '残す' },
] as const;

const SORT_OPTIONS = [
  { value: '', label: '名前順' },
  { value: 'followedAsc', label: 'フォローが古い順' },
  { value: 'followedDesc', label: 'フォローが新しい順' },
] as const;

export default function ListView() {
  const [relationship, setRelationship] = useState('');
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('');
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    fetchAccounts({ relationship, status, q, sort })
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e: Error) => setError(e.message));
  }, [relationship, status, q, sort]);

  useEffect(() => {
    reload();
  }, [reload]);

  const onStatusChange = (username: string, newStatus: AccountStatus) => {
    updateStatus(username, newStatus).then(reload).catch((e: Error) => setError(e.message));
  };

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>読み込み中…</p>;

  const { counts } = data;
  return (
    <div>
      <div className="summary">
        全{counts.total}件 ｜ 相互 {counts.mutual} ｜ 片思い {counts.followingOnly} ｜ ファン{' '}
        {counts.followerOnly} ｜ 未処理 {counts.pending}
      </div>
      <div className="filters">
        <div className="rel-tabs">
          {REL_TABS.map((t) => (
            <button
              key={t.value}
              className={relationship === t.value ? 'active' : ''}
              onClick={() => setRelationship(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="ユーザー名で検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {data.accounts.length === 0 ? (
        <p className="empty">
          該当するアカウントがありません。まだ取り込んでいない場合は「取り込み」タブからエクスポートZIPを読み込んでください。
        </p>
      ) : (
        <div className="grid">
          {data.accounts.map((a) => (
            <AccountCard key={a.username} account={a} onStatusChange={onStatusChange} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: App.tsx の一覧プレースホルダを差し替え**

`web/src/App.tsx` の `main` 部分を次に変更（ImportView は Task 8 まではプレースホルダのまま）:

```tsx
import { useState } from 'react';
import ListView from './ListView';

type View = 'list' | 'import';

export default function App() {
  const [view, setView] = useState<View>('list');
  return (
    <div className="app">
      <header className="app-header">
        <h1>Instagram フォロー整理</h1>
        <nav>
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            一覧
          </button>
          <button className={view === 'import' ? 'active' : ''} onClick={() => setView('import')}>
            取り込み
          </button>
        </nav>
      </header>
      <main>{view === 'list' ? <ListView /> : <p>取り込み（Task 8 で実装）</p>}</main>
    </div>
  );
}
```

- [ ] **Step 4: styles.css にカード等のスタイルを追記（既存の末尾に追加）**

```css
.summary { color: var(--muted); margin: 12px 0; font-size: 14px; }
.filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; align-items: center; }
.rel-tabs { display: flex; gap: 4px; }
select, input[type='search'] { background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
input[type='search'] { flex: 1; min-width: 160px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
.card.status-unfollowed, .card.status-keep, .card.status-followedBack { opacity: 0.55; }
.card-head { display: flex; align-items: center; gap: 10px; }
.avatar { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.avatar-initial { display: flex; align-items: center; justify-content: center; background: #2c3340; color: var(--accent); font-weight: 700; font-size: 18px; }
.card-title { flex: 1; min-width: 0; }
.card-title a { color: var(--text); font-weight: 600; text-decoration: none; }
.card-title a:hover { color: var(--accent); }
.display-name { color: var(--muted); font-size: 13px; }
.badge { font-size: 12px; padding: 3px 10px; border-radius: 999px; flex-shrink: 0; }
.badge-mutual { background: #1d3b2a; color: #6fd394; }
.badge-followingOnly { background: #40301a; color: #f0b35e; }
.badge-followerOnly { background: #1c3050; color: #7db2ff; }
.bio { margin: 0; color: var(--muted); font-size: 13px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.card-meta { display: flex; justify-content: space-between; color: var(--muted); font-size: 12px; }
.card-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.card-actions button, .btn { font-size: 13px; padding: 6px 10px; border-radius: 6px; background: var(--panel); border: 1px solid var(--border); color: var(--text); text-decoration: none; cursor: pointer; }
.error { color: #ff7a7a; }
.empty { color: var(--muted); }
```

- [ ] **Step 5: 動作確認（サンプルデータ投入はまだ不要）**

Run: `npm run dev` を起動し、`curl -s http://localhost:5173` でHTMLが返ることを確認。ブラウザ確認する場合: 一覧タブで「該当するアカウントがありません…」の空状態が出ること（データ未投入のため）
Expected: エラーなく空状態が表示される

- [ ] **Step 6: コミット**

```bash
git add web/src/
git commit -m "一覧画面: フィルタ・検索・ソートとアカウントカード"
```

---

### Task 8: 取り込み画面（ImportView）

**Files:**
- Create: `web/src/ImportView.tsx`
- Modify: `web/src/App.tsx`（プレースホルダを差し替え）
- Modify: `web/src/styles.css`（ドロップゾーンのスタイル追加）

- [ ] **Step 1: ImportView を実装**

`web/src/ImportView.tsx`:

```tsx
import { useRef, useState } from 'react';
import { importZip } from './api';
import type { ImportSummary } from './types';

export default function ImportView() {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = (file: File) => {
    setBusy(true);
    setError('');
    setSummary(null);
    importZip(file)
      .then(setSummary)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="import-view">
      <h2>エクスポートZIPの取り込み</h2>
      <ol className="guide">
        <li>Instagramアプリ: 設定 → アカウントセンター → あなたの情報とアクセス許可 → 情報をエクスポート</li>
        <li>「フォロワーとフォロー中」だけ選択・期間は「すべての期間」・<strong>フォーマットは必ず JSON</strong></li>
        <li>完了メールが届いたらZIPをダウンロードして、ここに読み込ませる</li>
      </ol>
      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) upload(file);
        }}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? '取り込み中…' : 'ここにZIPをドラッグ&ドロップ（クリックでファイル選択）'}
        <input
          ref={inputRef}
          type="file"
          accept=".zip"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
            e.target.value = '';
          }}
        />
      </div>
      {error && <p className="error">{error}</p>}
      {summary && (
        <div className="import-summary">
          <h3>取り込み完了 ✅</h3>
          <ul>
            <li>合計: {summary.imported} アカウント</li>
            <li>フォロワー: {summary.followers} / フォロー中: {summary.following}</li>
            <li>
              相互 {summary.mutual} ｜ 片思い {summary.followingOnly} ｜ ファン {summary.followerOnly}
            </li>
          </ul>
          <p>「一覧」タブで整理を始められます。</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: App.tsx のプレースホルダを差し替え**

`web/src/App.tsx` に `import ImportView from './ImportView';` を追加し、`main` を:

```tsx
<main>{view === 'list' ? <ListView /> : <ImportView />}</main>
```

- [ ] **Step 3: styles.css に追記（末尾に追加）**

```css
.import-view { max-width: 640px; }
.guide { color: var(--muted); font-size: 14px; line-height: 1.9; padding-left: 20px; }
.dropzone { border: 2px dashed var(--border); border-radius: 12px; padding: 48px 16px; text-align: center; color: var(--muted); cursor: pointer; margin: 16px 0; }
.dropzone.dragging, .dropzone:hover { border-color: var(--accent); color: var(--text); }
.import-summary { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
.import-summary h3 { margin-top: 0; }
```

- [ ] **Step 4: コミット**

```bash
git add web/src/
git commit -m "取り込み画面: ZIPドラッグ&ドロップと結果サマリー"
```

---

### Task 9: 起動統合・サンプルデータ・手動E2E・README

**Files:**
- Create: `server/scripts/make-sample-zip.mjs`
- Create: `README.md`

- [ ] **Step 1: サンプルZIP生成スクリプトを作成**

実データ（エクスポート）が届く前の動作確認用。`server/scripts/make-sample-zip.mjs`:

```js
// 動作確認用のサンプルエクスポートZIPを data/sample-export.zip に生成する
// 実行: node server/scripts/make-sample-zip.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const igEntry = (username, daysAgo) => ({
  title: '',
  media_list_data: [],
  string_list_data: [
    {
      href: `https://www.instagram.com/${username}`,
      value: username,
      timestamp: Math.floor(Date.now() / 1000) - daysAgo * 86400,
    },
  ],
});

const followers = [
  igEntry('yamada_taro', 900),
  igEntry('cafe_nikko', 400),
  igEntry('sup_lover_22', 120),
  igEntry('fan_account_x', 30),
];
const following = [
  igEntry('yamada_taro', 850),
  igEntry('cafe_nikko', 380),
  igEntry('old_shop_2019', 2400),
  igEntry('influencer_aaa', 1100),
  igEntry('travel_gram_jp', 60),
];

const zip = zipSync({
  'connections/followers_and_following/followers_1.json': strToU8(JSON.stringify(followers)),
  'connections/followers_and_following/following.json': strToU8(
    JSON.stringify({ relationships_following: following }),
  ),
});

const out = join(root, 'data', 'sample-export.zip');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, zip);
console.log(`sample zip written: ${out}`);
```

- [ ] **Step 2: サンプルZIPを生成**

Run: `node server/scripts/make-sample-zip.mjs`
Expected: `data/sample-export.zip` が生成される（data/ はgitignore済み）

- [ ] **Step 3: 手動E2E（本番モード）**

Run: プロジェクトルートで `npm start` をバックグラウンド起動（webビルド→サーバ起動）
確認手順:
1. `curl -s http://localhost:3900/api/health` → `{"ok":true}`
2. `curl -s -X POST http://localhost:3900/api/import -F "file=@data/sample-export.zip"` → `{"imported":7,...}` のJSONが返る（相互2・片思い3・ファン2）
3. `curl -s "http://localhost:3900/api/accounts?relationship=followingOnly" | head -c 400` → `old_shop_2019` などが含まれる
4. `curl -s -X PATCH http://localhost:3900/api/accounts/old_shop_2019 -H "content-type: application/json" -d '{"status":"unfollowed"}'` → 200
5. ブラウザで `http://localhost:3900` を開き、一覧・フィルタ・カードのボタン・取り込み画面が機能することを目視確認

Expected: すべて成功。確認後サーバ停止

- [ ] **Step 4: README.md を作成**

```markdown
# Instagram フォロー整理アプリ

自分のInstagramのフォロー/フォロワーを公式エクスポートから読み込み、
関係性（相互・片思い・ファン）で整理してアンフォロー作業を助けるPCローカル専用アプリ。

## 使い方

1. `npm install`（初回のみ）
2. `npm start`
3. ブラウザで http://localhost:3900 を開く
4. 「取り込み」タブでInstagramのエクスポートZIP（**JSON形式**）を読み込む
5. 「一覧」タブで整理。「開く」でプロフィールを開き、Instagram上でアンフォロー →
   アプリに戻って「アンフォロー済み」を押して記録

- アンフォロー/フォローの実行自体は自動化しません（規約違反・凍結リスク回避のため）。
- データはすべて `data/` フォルダ内（PCの外に出ません）。

## 開発

- `npm run dev` … サーバ(3900) + Vite(5173) を同時起動（http://localhost:5173 を開く）
- `npm test` … サーバのユニットテスト
- `node server/scripts/make-sample-zip.mjs` … 動作確認用サンプルZIPを生成

設計書: `docs/superpowers/specs/2026-07-03-insta-follow-manager-design.md`
```

- [ ] **Step 5: 全テスト最終確認とコミット**

Run: `npm test`
Expected: すべてPASS

```bash
git add server/scripts/ README.md
git commit -m "起動統合: サンプルZIP生成とREADME"
```

---

## 完了条件（ステップ1のDone定義）

- `npm test` が全件PASS
- `npm start` → ブラウザで、サンプルZIP取り込み → 一覧表示 → フィルタ/検索/ソート → status変更（アンフォロー済み/フォローした/残す/未処理に戻す）が一通り動く
- 再取り込みしても status が保持される（importer のマージテストで担保）
- ユーザーの実エクスポートZIPが届き次第、実データで取り込み確認（追加の形式揺れがあれば importer を修正）
