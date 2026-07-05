import { avatarInitial } from './avatar';
import type { Account, AccountStatus } from './types';

const REL_LABEL: Record<Account['relationship'], string> = {
  mutual: '相互',
  followingOnly: '片思い',
  followerOnly: 'ファン',
};

const STATUS_LABEL: Record<AccountStatus, string> = {
  pending: '未処理',
  unfollowed: 'フォロー解除済み',
  followedBack: 'フォローバック済み',
  keep: '残す',
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
  onStatusChange: (username: string, status: AccountStatus) => void;
}

export default function AccountCard({ account, selected, onToggleSelect, onStatusChange }: Props) {
  const { username, relationship, status, profile } = account;
  const name = profile?.displayName || username;
  const { youFollow, followsYou } = relFlags(relationship);
  return (
    <div className={`card status-${status}`}>
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
        {account.queued && <span className="badge badge-queued">キュー</span>}
      </div>

      <div className="rel-row">
        <span className={`relpill ${youFollow ? 'on-you' : 'off'}`}>
          {youFollow ? '✓ あなたがフォロー中' : '✗ あなたは未フォロー'}
        </span>
        <span className={`relpill ${followsYou ? 'on-them' : 'off'}`}>
          {followsYou ? '✓ 相手もあなたをフォロー' : '✗ 相手はフォローしていない'}
        </span>
      </div>

      {profile?.bio && <p className="bio">{profile.bio}</p>}
      <div className="card-meta">
        <span>フォロー日: {fmtDate(account.followedAt)}</span>
        {profile?.followerCount != null && (
          <span>フォロワー {profile.followerCount.toLocaleString()}</span>
        )}
        <span className="status-label">{STATUS_LABEL[status]}</span>
      </div>

      <div className="card-actions">
        {youFollow ? (
          <>
            <a className="btn btn-unfollow" href={account.profileUrl} target="_blank" rel="noreferrer">
              フォローを外す ↗
            </a>
            {status !== 'unfollowed' && (
              <button onClick={() => onStatusChange(username, 'unfollowed')}>外した ✓</button>
            )}
          </>
        ) : (
          <>
            <a className="btn" href={account.profileUrl} target="_blank" rel="noreferrer">
              プロフィールを開く ↗
            </a>
            {status !== 'followedBack' && (
              <button onClick={() => onStatusChange(username, 'followedBack')}>フォローした</button>
            )}
          </>
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
