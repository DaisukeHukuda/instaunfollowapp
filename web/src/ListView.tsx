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
