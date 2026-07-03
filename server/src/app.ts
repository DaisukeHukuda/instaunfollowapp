import { Hono } from 'hono';
import { classify } from './classifier.js';
import { ImportError, mergeAccounts, parseExportZip } from './importer.js';
import { loadAccounts, saveAccounts, saveImportSnapshot } from './store.js';
import type { Account, AccountStatus } from './types.js';

const VALID_STATUS: readonly AccountStatus[] = ['pending', 'unfollowed', 'followedBack', 'keep'];

const countBy = (accounts: Account[]) => ({
  total: accounts.length,
  mutual: accounts.filter((a) => a.relationship === 'mutual').length,
  followingOnly: accounts.filter((a) => a.relationship === 'followingOnly').length,
  followerOnly: accounts.filter((a) => a.relationship === 'followerOnly').length,
  pending: accounts.filter((a) => a.status === 'pending').length,
});

export const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: true }));

app.post('/api/import', async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) {
    return c.json({ error: 'ZIPファイルを添付してください' }, 400);
  }
  let parsed;
  try {
    parsed = parseExportZip(new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    const message = e instanceof ImportError ? e.message : 'ZIPの解析に失敗しました';
    return c.json({ error: message }, 422);
  }
  const now = new Date().toISOString();
  const fresh = classify(parsed.followers, parsed.following);
  const current = await loadAccounts();
  const accounts = mergeAccounts(current.accounts, fresh);
  await saveAccounts({ updatedAt: now, accounts });
  await saveImportSnapshot(now.replace(/[:.]/g, '-'), {
    followers: parsed.followers,
    following: parsed.following,
  });
  const counts = countBy(accounts);
  return c.json({
    imported: counts.total,
    followers: parsed.followers.length,
    following: parsed.following.length,
    mutual: counts.mutual,
    followingOnly: counts.followingOnly,
    followerOnly: counts.followerOnly,
  });
});

app.get('/api/accounts', async (c) => {
  const { relationship, status, q, sort } = c.req.query();
  const { accounts, updatedAt } = await loadAccounts();
  let list = accounts;
  if (relationship) list = list.filter((a) => a.relationship === relationship);
  if (status) list = list.filter((a) => a.status === status);
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter(
      (a) =>
        a.username.toLowerCase().includes(needle) ||
        (a.profile?.displayName ?? '').toLowerCase().includes(needle) ||
        (a.profile?.bio ?? '').toLowerCase().includes(needle),
    );
  }
  if (sort === 'followedAsc') {
    list = [...list].sort((a, b) => (a.followedAt ?? '9999').localeCompare(b.followedAt ?? '9999'));
  } else if (sort === 'followedDesc') {
    list = [...list].sort((a, b) => (b.followedAt ?? '').localeCompare(a.followedAt ?? ''));
  }
  return c.json({ updatedAt, counts: countBy(accounts), accounts: list });
});

app.patch('/api/accounts/:username', async (c) => {
  const username = c.req.param('username');
  const body = await c.req.json<{ status?: string }>().catch(() => ({ status: undefined }));
  if (!body.status || !VALID_STATUS.includes(body.status as AccountStatus)) {
    return c.json({ error: 'status が不正です' }, 400);
  }
  const file = await loadAccounts();
  const account = file.accounts.find((a) => a.username === username);
  if (!account) return c.json({ error: 'アカウントが見つかりません' }, 404);
  account.status = body.status as AccountStatus;
  account.statusChangedAt = new Date().toISOString();
  await saveAccounts({ updatedAt: new Date().toISOString(), accounts: file.accounts });
  return c.json({ account });
});
