// server/src/types.ts のうちUIが使う部分の写し。
// パッケージ間import設定を持ち込まないための意図的な小さい重複。
// サーバ側の型を変えたらここも更新すること。
export type Relationship = 'mutual' | 'followingOnly' | 'followerOnly';
export type AccountStatus = 'pending' | 'unfollowed' | 'followedBack' | 'keep';

export interface Profile {
  displayName: string | null;
  bio: string | null;
  followerCount: number | null;
  picPath: string | null;
  followingCount: number | null;
  postCount: number | null;
  isPrivate: boolean | null;
  isVerified: boolean | null;
  fetchedAt: string | null;
  fetchError: string | null;
}

export interface Account {
  username: string;
  profileUrl: string;
  relationship: Relationship;
  followedAt: string | null;
  followerSince: string | null;
  status: AccountStatus;
  queued: boolean;
  profile: Profile | null;
}

export interface Counts {
  total: number;
  mutual: number;
  followingOnly: number;
  followerOnly: number;
  pending: number;
  queued: number;
}

export interface AccountsResponse {
  updatedAt: string;
  counts: Counts;
  accounts: Account[];
}

export interface ImportSummary {
  imported: number;
  followers: number;
  following: number;
  mutual: number;
  followingOnly: number;
  followerOnly: number;
}

export interface EnrichStatus {
  state: 'idle' | 'running' | 'stopped' | 'done';
  reason: string | null;
  total: number;
  done: number;
  failed: number;
  current: string | null;
}
