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
