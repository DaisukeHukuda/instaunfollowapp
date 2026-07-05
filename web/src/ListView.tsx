import { useCallback, useEffect, useState } from 'react';
import AccountCard from './AccountCard';
import { fetchAccounts } from './api';
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
  const [opened, setOpened] = useState<Set<string>>(new Set());

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

  const markOpened = (usernames: string[]) => {
    setOpened((prev) => {
      const next = new Set(prev);
      usernames.forEach((u) => next.add(u));
      return next;
    });
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
    markOpened(usernames);
  };

  const onOpen = (username: string) => openProfiles([username]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>読み込み中…</p>;

  const { counts } = data;
  return (
    <div>
      <div className="summary">
        全{counts.total}件 ｜ 相互 {counts.mutual} ｜ 片思い {counts.followingOnly} ｜ ファン{' '}
        {counts.followerOnly}
      </div>
      <details className="list-help">
        <summary>💡 フォローの外し方（クリックで開く）</summary>
        <ul>
          <li>
            <b>「片思い」</b>＝あなたはフォロー中だけど相手はフォローバックしていない人。整理の主な対象です。
          </li>
          <li>
            外したい人にチェックを入れ、上の<b>「選択した◯件のフォローを外す」</b>を押すと、その人たちのInstagramプロフィールが新しいタブでまとめて開きます（1件だけならカードの「フォローを外す ↗」でもOK）。
          </li>
          <li>
            開いた各タブでInstagramの<b>「フォロー中」ボタンを押して解除</b>してください。
          </li>
          <li>
            ※ アプリが自動でフォローを外すことはしません（規約・アカウント保護のため、実際の解除はあなたが行います）。次回エクスポートを取り込めば、実際に外れた人は自動で反映されます。
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
        {selected.size > 0 && <button onClick={() => setSelected(new Set())}>選択解除</button>}
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
              opened={opened.has(a.username)}
              onToggleSelect={toggleSelect}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
}
