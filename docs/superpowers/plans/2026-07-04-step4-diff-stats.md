# ステップ4: 再取り込み差分・統計 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2回目以降のZIP取り込みで「実際にアンフォローできた数 / 未完了 / フォローバック反映 / 新規・離脱フォロワー」を突き合わせて表示し、継続運用を快適にする。

**Architecture:** `diffAccounts(prev, fresh)` 純粋関数を importer に追加し、import 時に差分を計算して `data/last-diff.json` に保存。マージ時、「アンフォロー済みにしたのにまだフォロー中」のアカウントは `pending` に戻す（設計書§4）。`GET /api/stats` が counts と最新差分を返し、取り込み画面に差分と統計を表示。

**Tech Stack:** 既存構成のまま。新規依存なし。

**前提:** ステップ1〜3完了・mainマージ済み。作業ブランチ `step4-diff-stats`。

---

## ファイル構成

```
server/src/importer.ts      # 変更: diffAccounts 追加・mergeAccounts の未完了リセット
server/src/importer.test.ts # 変更: テスト追加
server/src/store.ts         # 変更: saveLastDiff / loadLastDiff
server/src/store.test.ts    # 変更: テスト追加
server/src/app.ts           # 変更: import時の差分計算・GET /api/stats
server/src/app.test.ts      # 変更: テスト追加
web/src/types.ts            # 変更: ImportDiff / StatsResponse
web/src/api.ts              # 変更: fetchStats / ImportSummary拡張
web/src/ImportView.tsx      # 変更: 差分サマリーと統計表示
web/src/styles.css          # 変更: 統計表示のスタイル
```

---

### Task 1: diffAccounts と mergeAccounts の未完了リセット

**Files:**
- Modify: `server/src/importer.ts`
- Test: `server/src/importer.test.ts`（追記）

- [ ] **Step 1: 失敗するテストを追記（importer.test.ts 末尾に追加）**

```ts
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
```

- [ ] **Step 2: `npm test -w server -- src/importer.test.ts` → 新3件FAIL**

- [ ] **Step 3: importer.ts に diffAccounts を追加し、mergeAccounts を変更**

ファイル末尾に追加:

```ts
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
```

mergeAccounts を以下に置き換え:

```ts
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
```

注: 既存テスト『既存アカウントの status / queued / profile を引き継ぐ』は status 'keep' を使っているため影響なし。全importerテストがPASSすること。

- [ ] **Step 4: `npm test -w server -- src/importer.test.ts` → 全PASS（9件）**

- [ ] **Step 5: コミット**

```bash
git add server/src/importer.ts server/src/importer.test.ts
git commit -m "差分計算: diffAccountsと未完了アンフォローのリセット"
```

---

### Task 2: last-diff の保存と stats API

**Files:**
- Modify: `server/src/store.ts`（末尾に追加）
- Modify: `server/src/store.test.ts`（追記）
- Modify: `server/src/app.ts`
- Modify: `server/src/app.test.ts`（追記）

- [ ] **Step 1: store のテストを追記（describe('store') 内の末尾）**

```ts
  it('last-diff を保存・読込できる（未保存はnull）', async () => {
    const { loadLastDiff, saveLastDiff } = await import('./store.js');
    expect(await loadLastDiff()).toBeNull();
    const diff = { importedAt: '2026-07-04T00:00:00.000Z', newFollowers: ['a'] };
    await saveLastDiff(diff);
    expect(await loadLastDiff()).toEqual(diff);
  });
```

- [ ] **Step 2: store.ts 末尾に追加**

```ts
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
```

Run: `npm test -w server -- src/store.test.ts` → 全PASS（5件）

- [ ] **Step 3: app のテストを追記（app.test.ts 末尾）**

```ts
describe('diff & stats', () => {
  it('再取り込みで差分がレスポンスに含まれ、statsで取れる', async () => {
    await importSample();
    // oneway_c をアンフォロー済みにするが、同じZIPを再取り込み → まだフォロー中なので未完了
    await app.request('/api/accounts/oneway_c', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'unfollowed' }),
    });
    const res = await importSample();
    const body = await res.json();
    expect(body.diff.unfollowIncomplete).toEqual(['oneway_c']);
    expect(body.diff.newFollowers).toEqual([]);
    // 未完了は pending に戻る
    const acc = await (await app.request('/api/accounts?q=oneway_c')).json();
    expect(acc.accounts[0].status).toBe('pending');
    // stats に最新差分が入る
    const stats = await (await app.request('/api/stats')).json();
    expect(stats.lastDiff.unfollowIncomplete).toEqual(['oneway_c']);
    expect(stats.lastDiff.importedAt).toBeTruthy();
    expect(stats.counts.total).toBe(3);
  });

  it('初回取り込みでは差分は全て空', async () => {
    const res = await importSample();
    const body = await res.json();
    expect(body.diff.newFollowers.sort()).toEqual(['fan_b', 'mutual_a']);
    expect(body.diff.unfollowConfirmed).toEqual([]);
  });
});
```

注: 初回は prev が空なので newFollowers には全フォロワーが入る（fan_b, mutual_a）。これは仕様（初回サマリーとして自然）。

- [ ] **Step 4: `npm test -w server -- src/app.test.ts` → 新2件FAIL → app.ts を変更**

4a. import に追加: `diffAccounts` を importer から、`loadLastDiff, saveLastDiff` を store から。

4b. POST /api/import の withStore ブロックを差分計算込みに変更:

```ts
  const now = new Date().toISOString();
  const fresh = classify(parsed.followers, parsed.following);
  const { accounts, diff } = await withStore(async () => {
    const current = await loadAccounts();
    const d = diffAccounts(current.accounts, fresh);
    const merged = mergeAccounts(current.accounts, fresh);
    await saveAccounts({ updatedAt: now, accounts: merged });
    return { accounts: merged, diff: d };
  });
  await saveImportSnapshot(now.replace(/[:.]/g, '-'), {
    followers: parsed.followers,
    following: parsed.following,
  });
  await saveLastDiff({ importedAt: now, ...diff });
  const counts = countBy(accounts);
  return c.json({
    imported: counts.total,
    followers: parsed.followers.length,
    following: parsed.following.length,
    mutual: counts.mutual,
    followingOnly: counts.followingOnly,
    followerOnly: counts.followerOnly,
    diff,
  });
```

4c. 末尾に stats エンドポイント追加:

```ts
app.get('/api/stats', async (c) => {
  const { accounts, updatedAt } = await loadAccounts();
  return c.json({ updatedAt, counts: countBy(accounts), lastDiff: await loadLastDiff() });
});
```

- [ ] **Step 5: `npm test -w server` → 全PASS（43件前後）、`npx -w server tsc --noEmit` クリーン**

- [ ] **Step 6: コミット**

```bash
git add server/src/store.ts server/src/store.test.ts server/src/app.ts server/src/app.test.ts
git commit -m "統計API: 取り込み差分の保存とstatsエンドポイント"
```

---

### Task 3: Web（取り込み画面の差分・統計表示）

**Files:**
- Modify: `web/src/types.ts`（末尾に追加）
- Modify: `web/src/api.ts`
- Modify: `web/src/ImportView.tsx`
- Modify: `web/src/styles.css`（末尾に追加）

- [ ] **Step 1: types.ts 末尾に追加し、ImportSummary に diff を追加**

```ts
export interface ImportDiff {
  newFollowers: string[];
  lostFollowers: string[];
  newFollowing: string[];
  unfollowConfirmed: string[];
  unfollowIncomplete: string[];
  followBackConfirmed: string[];
}

export interface StatsResponse {
  updatedAt: string;
  counts: Counts;
  lastDiff: (ImportDiff & { importedAt: string }) | null;
}
```

`ImportSummary` に `diff: ImportDiff;` フィールドを追加。

- [ ] **Step 2: api.ts 末尾に追加（import に StatsResponse を追加）**

```ts
export function fetchStats(): Promise<StatsResponse> {
  return fetch('/api/stats').then((r) => handle<StatsResponse>(r));
}
```

- [ ] **Step 3: ImportView.tsx に差分・統計表示を追加**

3a. import 文を変更:

```tsx
import { useEffect, useRef, useState } from 'react';
import EnrichPanel from './EnrichPanel';
import { fetchStats, importZip } from './api';
import type { ImportDiff, ImportSummary, StatsResponse } from './types';
```

3b. コンポーネント先頭の state に追加:

```tsx
  const [stats, setStats] = useState<StatsResponse | null>(null);

  useEffect(() => {
    fetchStats().then(setStats).catch(() => {});
  }, [summary]);
```

3c. 差分表示用の小コンポーネントをファイル内（ImportView の外・下）に追加:

```tsx
function DiffSummary({ diff }: { diff: ImportDiff & { importedAt?: string } }) {
  const rows: { label: string; users: string[]; highlight?: boolean }[] = [
    { label: 'アンフォロー確定', users: diff.unfollowConfirmed, highlight: true },
    { label: 'アンフォロー未完了（未処理に戻しました）', users: diff.unfollowIncomplete },
    { label: 'フォローバック反映', users: diff.followBackConfirmed },
    { label: '新規フォロワー', users: diff.newFollowers, highlight: true },
    { label: '離脱フォロワー', users: diff.lostFollowers },
    { label: '新しくフォロー', users: diff.newFollowing },
  ];
  return (
    <ul className="diff-list">
      {rows.map((r) => (
        <li key={r.label}>
          <span className={r.highlight && r.users.length > 0 ? 'diff-highlight' : ''}>
            {r.label}: {r.users.length} 件
          </span>
          {r.users.length > 0 && r.users.length <= 50 && (
            <details>
              <summary>一覧を見る</summary>
              <div className="diff-users">
                {r.users.map((u) => (
                  <a key={u} href={`https://www.instagram.com/${u}/`} target="_blank" rel="noreferrer">
                    @{u}
                  </a>
                ))}
              </div>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
```

3d. 取り込み完了ブロック（import-summary）の `<p>「一覧」タブで整理を始められます。</p>` の前に差分表示を追加:

```tsx
          <h4>前回からの変化</h4>
          <DiffSummary diff={summary.diff} />
```

3e. `<hr className="divider" />` の直前（EnrichPanel の前）に統計セクションを追加:

```tsx
      {stats && (
        <div className="stats-section">
          <h2>統計</h2>
          <p className="muted">
            最終取り込み: {stats.updatedAt ? new Date(stats.updatedAt).toLocaleString('ja-JP') : '未取り込み'} ｜ 全
            {stats.counts.total}件（相互 {stats.counts.mutual} ｜ 片思い {stats.counts.followingOnly} ｜ ファン{' '}
            {stats.counts.followerOnly} ｜ 未処理 {stats.counts.pending} ｜ キュー {stats.counts.queued}）
          </p>
          {stats.lastDiff && (
            <>
              <p className="muted">
                前回取り込み（{new Date(stats.lastDiff.importedAt).toLocaleString('ja-JP')}）の差分:
              </p>
              <DiffSummary diff={stats.lastDiff} />
            </>
          )}
        </div>
      )}
```

- [ ] **Step 4: styles.css 末尾に追加**

```css
.diff-list { list-style: none; padding: 0; margin: 8px 0; display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
.diff-highlight { color: #6fd394; font-weight: 600; }
.diff-list details { display: inline-block; margin-left: 8px; color: var(--muted); font-size: 13px; }
.diff-list summary { cursor: pointer; display: inline; }
.diff-users { display: flex; flex-wrap: wrap; gap: 6px 12px; margin: 6px 0; }
.diff-users a { color: var(--accent); text-decoration: none; font-size: 13px; }
.stats-section { margin-top: 8px; }
```

- [ ] **Step 5: 検証とコミット**

Run: `npx -w web tsc --noEmit` クリーン、`npm run build -w web` 成功

```bash
git add web/src/
git commit -m "取り込み画面: 差分サマリーと統計表示"
```

---

### Task 4: README更新・通しE2E（メインセッションが実施）

- [ ] README.md の使い方に「2回目以降の取り込み（差分確認）」「プロフィール自動取得」を追記
- [ ] `npm test` 全PASS → サーバ再起動 → 実ZIP再取り込みで差分表示を確認
- [ ] mainへマージ

## 完了条件

- 再取り込みで「アンフォロー確定 n件」等の差分が表示される
- 未完了アンフォローが未処理に戻り、整理し直せる
- 統計セクションで現状が一目で分かる
- 全テストPASS
