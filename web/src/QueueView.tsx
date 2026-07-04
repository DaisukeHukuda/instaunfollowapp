import { useCallback, useEffect, useState } from 'react';
import { avatarInitial } from './avatar';
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
            <div className="avatar avatar-initial">{avatarInitial(username)}</div>
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
