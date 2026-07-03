# ステップ2: レビューキュー 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一覧でチェックした（または表示中全件の）アカウントを処理キューに入れ、キュー画面で1件ずつ大きく表示してキーボード（O/U/F/K/→）でテンポよく整理できるようにする。

**Architecture:** 既存の `queued` フラグ（Account に定義済み・永続化済み）を実際に使う。サーバは PATCH の queued 対応・一括キューAPI・queued絞り込みを追加。Web は一覧に複数選択UI、新規タブ「キュー」に QueueView を追加。中断・再開はサーバ側の queued 永続化で自然に実現。

**Tech Stack:** 既存構成のまま（Hono / Vitest / React）。新規依存なし。

**前提:** ステップ1完了・mainマージ済み。作業ブランチ `step2-review-queue`（mainから分岐）。

---

## ファイル構成（このステップで触るもの）

```
server/src/app.ts        # 変更: PATCH queued対応 / POST /api/queue/bulk / GET ?queued=true / counts.queued
server/src/app.test.ts   # 変更: 上記のテスト追加
web/src/types.ts         # 変更: Counts.queued 追加
web/src/api.ts           # 変更: updateStatus → updateAccount（queued対応）/ bulkQueue 追加 / fetchAccounts queued対応
web/src/AccountCard.tsx  # 変更: 選択チェックボックスとキュー済みバッジ
web/src/ListView.tsx     # 変更: 選択状態・一括キュー投入ツールバー
web/src/QueueView.tsx    # 新規: キュー画面（キーボードショートカット）
web/src/App.tsx          # 変更: 「キュー」タブ追加
web/src/styles.css       # 変更: 選択UI・キューカードのスタイル追加
```

---

### Task 1: サーバのキュー対応（PATCH拡張・一括API・絞り込み）

**Files:**
- Modify: `server/src/app.ts`
- Test: `server/src/app.test.ts`

- [ ] **Step 1: 失敗するテストを追加（app.test.ts の末尾、既存の describe 群の後に追加）**

```ts
describe('queue', () => {
  it('POST /api/queue/bulk で複数アカウントをキューに入れ、?queued=true で取れる', async () => {
    await importSample();
    const res = await app.request('/api/queue/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usernames: ['oneway_c', 'fan_b'], queued: true }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(2);
    const q = await (await app.request('/api/accounts?queued=true')).json();
    expect(q.accounts.map((a: { username: string }) => a.username).sort()).toEqual(['fan_b', 'oneway_c']);
    expect(q.counts.queued).toBe(2);
  });

  it('PATCH で status と queued を同時更新できる（キュー消化の1操作）', async () => {
    await importSample();
    await app.request('/api/queue/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usernames: ['oneway_c'], queued: true }),
    });
    const res = await app.request('/api/accounts/oneway_c', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'unfollowed', queued: false }),
    });
    expect(res.status).toBe(200);
    const { account } = await res.json();
    expect(account.status).toBe('unfollowed');
    expect(account.queued).toBe(false);
  });

  it('queued だけの PATCH も可能', async () => {
    await importSample();
    const res = await app.request('/api/accounts/fan_b', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queued: true }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).account.queued).toBe(true);
  });

  it('queue/bulk の入力不正は400', async () => {
    const res = await app.request('/api/queue/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usernames: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  it('PATCH で本文が空なら400', async () => {
    await importSample();
    const res = await app.request('/api/accounts/oneway_c', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -w server -- src/app.test.ts`
Expected: FAIL（queue系 5件が404/400で失敗。既存テストはPASSのまま）

- [ ] **Step 3: app.ts を変更**

3a. `countBy` に queued を追加:

```ts
const countBy = (accounts: Account[]) => ({
  total: accounts.length,
  mutual: accounts.filter((a) => a.relationship === 'mutual').length,
  followingOnly: accounts.filter((a) => a.relationship === 'followingOnly').length,
  followerOnly: accounts.filter((a) => a.relationship === 'followerOnly').length,
  pending: accounts.filter((a) => a.status === 'pending').length,
  queued: accounts.filter((a) => a.queued).length,
});
```

3b. GET /api/accounts のクエリ分割行を `const { relationship, status, q, sort, queued } = c.req.query();` に変え、status絞り込みの直後に追加:

```ts
  if (queued === 'true') list = list.filter((a) => a.queued);
```

3c. PATCH /api/accounts/:username を以下に全面置き換え:

```ts
app.patch('/api/accounts/:username', async (c) => {
  const username = c.req.param('username');
  const body = await c.req
    .json<{ status?: string; queued?: boolean }>()
    .catch(() => ({}) as { status?: string; queued?: boolean });
  const hasStatus = body.status !== undefined;
  const hasQueued = typeof body.queued === 'boolean';
  if (!hasStatus && !hasQueued) {
    return c.json({ error: 'status または queued を指定してください' }, 400);
  }
  if (hasStatus && !VALID_STATUS.includes(body.status as AccountStatus)) {
    return c.json({ error: 'status が不正です' }, 400);
  }
  const file = await loadAccounts();
  const account = file.accounts.find((a) => a.username === username);
  if (!account) return c.json({ error: 'アカウントが見つかりません' }, 404);
  if (hasStatus) {
    account.status = body.status as AccountStatus;
    account.statusChangedAt = new Date().toISOString();
  }
  if (hasQueued) account.queued = body.queued as boolean;
  await saveAccounts({ updatedAt: new Date().toISOString(), accounts: file.accounts });
  return c.json({ account });
});
```

3d. PATCH の後に一括キューAPIを追加:

```ts
app.post('/api/queue/bulk', async (c) => {
  const body = await c.req
    .json<{ usernames?: unknown; queued?: unknown }>()
    .catch(() => ({}) as { usernames?: unknown; queued?: unknown });
  if (!Array.isArray(body.usernames) || typeof body.queued !== 'boolean') {
    return c.json({ error: 'usernames（配列）と queued（真偽値）を指定してください' }, 400);
  }
  const targets = new Set(body.usernames as string[]);
  const file = await loadAccounts();
  let updated = 0;
  for (const a of file.accounts) {
    if (targets.has(a.username) && a.queued !== body.queued) {
      a.queued = body.queued;
      updated++;
    }
  }
  await saveAccounts({ updatedAt: new Date().toISOString(), accounts: file.accounts });
  return c.json({ updated });
});
```

- [ ] **Step 4: 全テストPASSを確認**

Run: `npm test -w server`
Expected: PASS（24 passed = 既存19 + 新規5）

- [ ] **Step 5: 型チェックとコミット**

Run: `npx -w server tsc --noEmit` → クリーン

```bash
git add server/src/app.ts server/src/app.test.ts
git commit -m "キューAPI: PATCH拡張・一括投入・queued絞り込み"
```

---

### Task 2: 一覧画面の複数選択とキュー投入

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/api.ts`
- Modify: `web/src/AccountCard.tsx`
- Modify: `web/src/ListView.tsx`
- Modify: `web/src/styles.css`（末尾に追加）

- [ ] **Step 1: types.ts の Counts に queued を追加**

```ts
export interface Counts {
  total: number;
  mutual: number;
  followingOnly: number;
  followerOnly: number;
  pending: number;
  queued: number;
}
```

- [ ] **Step 2: api.ts を変更 — updateStatus を updateAccount に置き換え、bulkQueue を追加、fetchAccounts に queued パラメータ**

`fetchAccounts` の params 型を `{ relationship?: string; status?: string; q?: string; sort?: string; queued?: string; }` に変更（実装は既存のまま — URLSearchParams が queued も拾う）。

`updateStatus` を削除し、以下に置き換え:

```ts
export function updateAccount(
  username: string,
  patch: { status?: AccountStatus; queued?: boolean },
): Promise<Account> {
  return fetch(`/api/accounts/${encodeURIComponent(username)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
    .then((r) => handle<{ account: Account }>(r))
    .then((b) => b.account);
}

export function bulkQueue(usernames: string[], queued: boolean): Promise<number> {
  return fetch('/api/queue/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usernames, queued }),
  })
    .then((r) => handle<{ updated: number }>(r))
    .then((b) => b.updated);
}
```

- [ ] **Step 3: AccountCard.tsx — チェックボックスとキュー済みバッジを追加**

Props を拡張し、card-head の先頭にチェックボックス、関係性バッジの後にキュー済みバッジ:

```tsx
interface Props {
  account: Account;
  selected: boolean;
  onToggleSelect: (username: string) => void;
  onStatusChange: (username: string, status: AccountStatus) => void;
}

export default function AccountCard({ account, selected, onToggleSelect, onStatusChange }: Props) {
```

card-head を以下に変更:

```tsx
      <div className="card-head">
        <input
          type="checkbox"
          className="select-box"
          checked={selected}
          onChange={() => onToggleSelect(username)}
        />
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
        {account.queued && <span className="badge badge-queued">キュー</span>}
      </div>
```

- [ ] **Step 4: ListView.tsx — 選択状態とツールバー**

import を `import { bulkQueue, fetchAccounts, updateAccount } from './api';` に変更。

`onStatusChange` 内の `updateStatus(username, newStatus)` を `updateAccount(username, { status: newStatus })` に変更。

state に追加:

```tsx
  const [selected, setSelected] = useState<Set<string>>(new Set());
```

ハンドラを追加（onStatusChange の下）:

```tsx
  const toggleSelect = (username: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(username)) {
        next.delete(username);
      } else {
        next.add(username);
      }
      return next;
    });
  };

  const enqueue = (usernames: string[]) => {
    bulkQueue(usernames, true)
      .then(() => {
        setSelected(new Set());
        reload();
      })
      .catch((e: Error) => setError(e.message));
  };
```

filters の div と grid の間にツールバーを追加:

```tsx
      <div className="bulkbar">
        <span>選択中 {selected.size} 件</span>
        <button disabled={selected.size === 0} onClick={() => enqueue([...selected])}>
          選択をキューに入れる
        </button>
        <button
          disabled={data.accounts.length === 0}
          onClick={() => enqueue(data.accounts.map((a) => a.username))}
        >
          表示中の全{data.accounts.length}件をキューに入れる
        </button>
        {selected.size > 0 && <button onClick={() => setSelected(new Set())}>選択解除</button>}
        <span className="queued-count">キュー: {counts.queued} 件</span>
      </div>
```

AccountCard の呼び出しを変更:

```tsx
          {data.accounts.map((a) => (
            <AccountCard
              key={a.username}
              account={a}
              selected={selected.has(a.username)}
              onToggleSelect={toggleSelect}
              onStatusChange={onStatusChange}
            />
          ))}
```

- [ ] **Step 5: styles.css 末尾に追加**

```css
.bulkbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; color: var(--muted); font-size: 13px; flex-wrap: wrap; }
.badge-queued { background: #3a2a4a; color: #c99cff; }
.select-box { width: 16px; height: 16px; accent-color: var(--accent); flex-shrink: 0; }
.queued-count { margin-left: auto; }
```

- [ ] **Step 6: 検証とコミット**

Run: `npx -w web tsc --noEmit` → クリーン、`npm run build -w web` → 成功

```bash
git add web/src/
git commit -m "一覧画面: 複数選択と一括キュー投入"
```

---

### Task 3: キュー画面（QueueView + タブ追加）

**Files:**
- Create: `web/src/QueueView.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`（末尾に追加）

- [ ] **Step 1: QueueView.tsx を作成**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { fetchAccounts, updateAccount } from './api';
import type { Account, AccountStatus } from './types';

const REL_LABEL: Record<Account['relationship'], string> = {
  mutual: '相互',
  followingOnly: '片思い',
  followerOnly: 'ファン',
};

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('ja-JP') : '—';

export default function QueueView() {
  const [queue, setQueue] = useState<Account[] | null>(null);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAccounts({ queued: 'true' })
      .then((d) => setQueue(d.accounts))
      .catch((e: Error) => setError(e.message));
  }, []);

  const idx = queue && queue.length > 0 ? Math.min(index, queue.length - 1) : 0;
  const current = queue && queue.length > 0 ? queue[idx] : null;

  const resolve = useCallback(
    (status: AccountStatus) => {
      if (!current) return;
      const username = current.username;
      updateAccount(username, { status, queued: false })
        .then(() => {
          setDone((n) => n + 1);
          setQueue((q) => (q ? q.filter((a) => a.username !== username) : q));
        })
        .catch((e: Error) => setError(e.message));
    },
    [current],
  );

  const skip = useCallback(() => {
    if (queue && queue.length > 0) setIndex((idx + 1) % queue.length);
  }, [queue, idx]);

  const open = useCallback(() => {
    if (current) window.open(current.profileUrl, '_blank', 'noopener,noreferrer');
  }, [current]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!current) return;
      const k = e.key.toLowerCase();
      if (k === 'o') open();
      else if (k === 'u' && current.relationship !== 'followerOnly') resolve('unfollowed');
      else if (k === 'f' && current.relationship === 'followerOnly') resolve('followedBack');
      else if (k === 'k') resolve('keep');
      else if (e.key === 'ArrowRight') skip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, open, resolve, skip]);

  if (error) return <p className="error">{error}</p>;
  if (!queue) return <p>読み込み中…</p>;

  if (!current) {
    return (
      <div className="queue-view">
        <p className="empty">
          キューは空です。{done > 0 && `このセッションで ${done} 件処理しました。`}
          一覧タブでアカウントを選んで「キューに入れる」を押すと、ここで1件ずつテンポよく整理できます。
        </p>
      </div>
    );
  }

  const { username, relationship, profile } = current;
  return (
    <div className="queue-view">
      <div className="queue-progress">
        残り {queue.length} 件{done > 0 && ` ｜ 処理済み ${done} 件`}
      </div>
      <div className="queue-card">
        <div className="card-head">
          {profile?.picPath ? (
            <img className="avatar" src={profile.picPath} alt="" />
          ) : (
            <div className="avatar avatar-initial">{username[0]?.toUpperCase()}</div>
          )}
          <div className="card-title">
            <a className="queue-name" href={current.profileUrl} target="_blank" rel="noreferrer">
              @{username}
            </a>
            {profile?.displayName && <div className="display-name">{profile.displayName}</div>}
          </div>
          <span className={`badge badge-${relationship}`}>{REL_LABEL[relationship]}</span>
        </div>
        {profile?.bio && <p className="bio">{profile.bio}</p>}
        <div className="card-meta">
          <span>フォロー日: {fmtDate(current.followedAt)}</span>
        </div>
        <div className="queue-actions">
          <button onClick={open}>
            開く<span className="kbd">O</span>
          </button>
          {relationship !== 'followerOnly' ? (
            <button onClick={() => resolve('unfollowed')}>
              アンフォロー済み<span className="kbd">U</span>
            </button>
          ) : (
            <button onClick={() => resolve('followedBack')}>
              フォローした<span className="kbd">F</span>
            </button>
          )}
          <button onClick={() => resolve('keep')}>
            残す<span className="kbd">K</span>
          </button>
          <button onClick={skip}>
            スキップ<span className="kbd">→</span>
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: App.tsx を全面置き換え（キュータブ追加）**

```tsx
import { useState } from 'react';
import ImportView from './ImportView';
import ListView from './ListView';
import QueueView from './QueueView';

type View = 'list' | 'queue' | 'import';

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
          <button className={view === 'queue' ? 'active' : ''} onClick={() => setView('queue')}>
            キュー
          </button>
          <button className={view === 'import' ? 'active' : ''} onClick={() => setView('import')}>
            取り込み
          </button>
        </nav>
      </header>
      <main>
        {view === 'list' && <ListView />}
        {view === 'queue' && <QueueView />}
        {view === 'import' && <ImportView />}
      </main>
    </div>
  );
}
```

- [ ] **Step 3: styles.css 末尾に追加**

```css
.queue-view { max-width: 640px; margin: 0 auto; }
.queue-progress { color: var(--muted); margin-bottom: 12px; }
.queue-card { background: var(--panel); border: 1px solid var(--border); border-radius: 16px; padding: 28px; display: flex; flex-direction: column; gap: 14px; }
.queue-card .avatar, .queue-card .avatar-initial { width: 72px; height: 72px; font-size: 28px; }
.queue-name { font-size: 22px; font-weight: 700; color: var(--text); text-decoration: none; }
.queue-name:hover { color: var(--accent); }
.queue-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.queue-actions button { padding: 12px 16px; font-size: 15px; border-radius: 10px; }
.kbd { display: inline-block; margin-left: 6px; padding: 1px 6px; border: 1px solid var(--border); border-radius: 4px; font-size: 11px; color: var(--muted); }
```

- [ ] **Step 4: 検証とコミット**

Run: `npx -w web tsc --noEmit` → クリーン、`npm run build -w web` → 成功

```bash
git add web/src/
git commit -m "キュー画面: 1件ずつ処理とキーボードショートカット"
```

---

### Task 4: 通しE2E（メインセッションが実施）

- [ ] `npm test` 全PASS（24件）
- [ ] サーバ再起動 → ブラウザで: 一覧で数件チェック → キューに入れる → キュータブで U/K/→ 操作 → 残数が減る → タブ離脱・再訪でキューが維持される（中断再開）
- [ ] 「表示中の全n件をキューに入れる」が絞り込み（例: 片思い×未処理）と組み合わせて機能する
- [ ] main へマージ

## 完了条件

- キーボードだけで「開く→アンフォロー済み→次」が回る
- キュー投入・消化がサーバに永続化され、リロードや再訪で消えない
- 既存機能（取り込み・一覧・status変更）が壊れていない（全テストPASS）
