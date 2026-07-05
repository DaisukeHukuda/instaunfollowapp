import { useCallback, useEffect, useState } from 'react';
import AccountCard from './AccountCard';
import { fetchAccounts, updateAccount } from './api';
import type { AccountsResponse } from './types';

const REL_TABS = [
  { value: 'followingOnly', label: '片思い（外す候補）' },
  { value: 'mutual', label: '相互' },
  { value: 'followerOnly', label: 'ファン' },
  { value: '', label: 'すべて' },
] as const;

const SORT_OPTIONS = [
  { value: '', label: '名前順' },
  { value: 'followedAsc', label: 'フォローが古い順' },
  { value: 'followedDesc', label: 'フォローが新しい順' },
] as const;

export default function ListView() {
  const [relationship, setRelationship] = useState('followingOnly');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('');
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState(false);

  const reload = useCallback(() => {
    fetchAccounts({ relationship, q, sort })
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e: Error) => setError(e.message));
  }, [relationship, q, sort]);

  useEffect(() => {
    reload();
  }, [reload]);

  const toggleSelect = (username: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  };

  const markDone = (username: string) => {
    updateAccount(username, { status: 'unfollowed' })
      .then(reload)
      .catch((e: Error) => setError(e.message));
  };

  const restore = (username: string) => {
    updateAccount(username, { status: 'pending' })
      .then(reload)
      .catch((e: Error) => setError(e.message));
  };

  // 選択した（または1件の）プロフィールを新しいタブで開く。実際の解除はInstagram上で本人が行う。
  const openProfiles = (usernames: string[]) => {
    if (usernames.length === 0) return;
    if (
      usernames.length > 15 &&
      !window.confirm(`${usernames.length}件のタブを一度に開きます。よろしいですか？`)
    ) {
      return;
    }
    for (const u of usernames) {
      window.open(`https://www.instagram.com/${u}/`, '_blank', 'noopener,noreferrer');
    }
  };

  const onOpen = (username: string) => openProfiles([username]);

  const markSelectedDone = () => {
    const names = [...selected];
    Promise.all(names.map((u) => updateAccount(u, { status: 'unfollowed' })))
      .then(() => {
        setSelected(new Set());
        reload();
      })
      .catch((e: Error) => setError(e.message));
  };

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>読み込み中…</p>;

  const { counts } = data;
  const doneCount = data.accounts.filter((a) => a.status === 'unfollowed').length;
  const visible = showDone ? data.accounts : data.accounts.filter((a) => a.status !== 'unfollowed');
  return (
    <div>
      <div className="summary">
        全{counts.total}件 ｜ 相互 {counts.mutual} ｜ 片思い {counts.followingOnly} ｜ ファン{' '}
        {counts.followerOnly}
      </div>
      <details className="list-help">
        <summary>💡 使い方・一覧の更新（クリックで開く）</summary>
        <ul>
          <li>
            <b>「片思い」</b>＝あなたはフォロー中だけど相手はフォローバックしていない人。整理の主な対象です。
          </li>
          <li>
            チェックを入れて上の<b>「選択した◯件のフォローを外す」</b>で、その人たちのInstagramをまとめて開けます（1件ならカードの「フォローを外す ↗」）。各タブで「フォロー中」を押して解除してください。
          </li>
          <li>
            外し終わった人はカードの<b>「外した（消す）」</b>を押すと、この一覧から消えます（間違えたら「処理済みも表示」→「一覧に戻す」で戻せます）。
          </li>
          <li>
            後日あらためて新しいエクスポートZIPを「取り込み」タブに入れると、実際のフォロー状況で全体が正確に更新されます。
          </li>
        </ul>
      </details>
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
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="ユーザー名・名前・自己紹介で検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="bulkbar">
        <span>選択中 {selected.size} 件</span>
        <button
          className="btn-unfollow"
          disabled={selected.size === 0}
          onClick={() => openProfiles([...selected])}
        >
          選択した {selected.size} 件のフォローを外す ↗
        </button>
        {selected.size > 0 && (
          <button onClick={markSelectedDone}>選択を「外した」にして消す</button>
        )}
        {selected.size > 0 && <button onClick={() => setSelected(new Set())}>選択解除</button>}
        {doneCount > 0 && (
          <label className="done-toggle">
            <input
              type="checkbox"
              checked={showDone}
              onChange={(e) => setShowDone(e.target.checked)}
            />
            処理済みも表示（{doneCount}）
          </label>
        )}
      </div>
      {visible.length === 0 ? (
        <p className="empty">
          該当するアカウントがありません。まだ取り込んでいない場合は「取り込み」タブからエクスポートZIPを読み込んでください。
        </p>
      ) : (
        <div className="grid">
          {visible.map((a) => (
            <AccountCard
              key={a.username}
              account={a}
              selected={selected.has(a.username)}
              onToggleSelect={toggleSelect}
              onOpen={onOpen}
              onMarkDone={markDone}
              onRestore={restore}
            />
          ))}
        </div>
      )}
    </div>
  );
}
