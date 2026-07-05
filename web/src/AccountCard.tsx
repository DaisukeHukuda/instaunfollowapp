import { avatarInitial } from './avatar';
import type { Account } from './types';

const REL_LABEL: Record<Account['relationship'], string> = {
  mutual: '相互',
  followingOnly: '片思い',
  followerOnly: 'ファン',
};

/** relationship から「自分→相手」「相手→自分」のフォロー有無を出す */
function relFlags(rel: Account['relationship']) {
  return {
    youFollow: rel === 'mutual' || rel === 'followingOnly',
    followsYou: rel === 'mutual' || rel === 'followerOnly',
  };
}

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('ja-JP') : '—';

interface Props {
  account: Account;
  selected: boolean;
  onToggleSelect: (username: string) => void;
  onOpen: (username: string) => void;
  onMarkDone: (username: string) => void;
  onRestore: (username: string) => void;
}

export default function AccountCard({
  account,
  selected,
  onToggleSelect,
  onOpen,
  onMarkDone,
  onRestore,
}: Props) {
  const { username, relationship, profile } = account;
  const name = profile?.displayName || username;
  const { youFollow, followsYou } = relFlags(relationship);
  const isDone = account.status === 'unfollowed';
  return (
    <div className={`card${isDone ? ' done' : ''}`}>
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
          <div className="avatar avatar-initial">{avatarInitial(username)}</div>
        )}
        <div className="card-title">
          <a href={account.profileUrl} target="_blank" rel="noreferrer">
            @{username}
          </a>
          {profile?.displayName && <div className="display-name">{name}</div>}
        </div>
        <span className={`badge badge-${relationship}`}>{REL_LABEL[relationship]}</span>
        {isDone && <span className="badge badge-opened">外した</span>}
      </div>

      <div className="rel-row">
        <span className={`relpill ${youFollow ? 'on-you' : 'off'}`}>
          {youFollow ? '✓ あなたがフォロー中' : '✗ あなたは未フォロー'}
        </span>
        <span className={`relpill ${followsYou ? 'on-them' : 'off'}`}>
          {followsYou ? '✓ 相手もあなたをフォロー' : '✗ 相手はフォローしていない'}
        </span>
      </div>

      {profile?.bio ? (
        <p className="bio">{profile.bio}</p>
      ) : (
        profile?.fetchedAt && <p className="bio bio-empty">（自己紹介なし）</p>
      )}
      <div className="card-meta">
        <span>フォロー日: {fmtDate(account.followedAt)}</span>
        {profile?.followerCount != null && (
          <span>フォロワー {profile.followerCount.toLocaleString()}</span>
        )}
      </div>

      <div className="card-actions">
        {isDone ? (
          <button onClick={() => onRestore(username)}>一覧に戻す</button>
        ) : youFollow ? (
          <>
            <button className="btn-unfollow" onClick={() => onOpen(username)}>
              フォローを外す ↗
            </button>
            <button onClick={() => onMarkDone(username)}>外した（消す）</button>
          </>
        ) : (
          <a className="btn" href={account.profileUrl} target="_blank" rel="noreferrer">
            プロフィールを開く ↗
          </a>
        )}
      </div>
    </div>
  );
}
