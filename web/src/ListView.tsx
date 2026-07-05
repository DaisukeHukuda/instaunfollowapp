import { useCallback, useEffect, useState } from 'react';
import AccountCard from './AccountCard';
import { bulkQueue, fetchAccounts, updateAccount } from './api';
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
  { value: 'unfollowed', label: 'フォロー解除済み' },
  { value: 'followedBack', label: 'フォローバック済み' },
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
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
    updateAccount(username, { status: newStatus })
      .then(reload)
      .catch((e: Error) => setError(e.message));
  };

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

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>読み込み中…</p>;

  const { counts } = data;
  return (
    <div>
      <div className="summary">
        全{counts.total}件 ｜ 相互 {counts.mutual} ｜ 片思い {counts.followingOnly} ｜ ファン{' '}
        {counts.followerOnly} ｜ 未処理 {counts.pending}
      </div>
      <details className="list-help">
        <summary>💡 フォローの外し方（クリックで開く）</summary>
        <ul>
          <li>
            <b>「片思い」</b>＝あなたはフォロー中だけど相手はフォローバックしていない人。フォロー整理の主な対象です。
          </li>
          <li>
            カードの<b>「フォローを外す ↗」</b>を押すと、その人のInstagramプロフィールが新しいタブで開きます。
          </li>
          <li>
            Instagram側で<b>「フォロー中」ボタンを押して解除</b>し、このアプリに戻って<b>「外した ✓」</b>を押すと記録されます。
          </li>
          <li>
            ※ アプリが勝手にフォローを外すことはしません（規約・アカウント保護のため、実際の解除はあなたが行います）。
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
      {data.accounts.length === 0 ? (
        <p className="empty">
          該当するアカウントがありません。まだ取り込んでいない場合は「取り込み」タブからエクスポートZIPを読み込んでください。
        </p>
      ) : (
        <div className="grid">
          {data.accounts.map((a) => (
            <AccountCard
              key={a.username}
              account={a}
              selected={selected.has(a.username)}
              onToggleSelect={toggleSelect}
              onStatusChange={onStatusChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
