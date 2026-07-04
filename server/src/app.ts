import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';
import { classify } from './classifier.js';
import { getEnrichStatus, ingestProfile, runEnrich, stopEnrich } from './enricher.js';
import { diffAccounts, ImportError, mergeAccounts, parseExportZip } from './importer.js';
import {
  dataDir,
  loadAccounts,
  loadCookie,
  loadLastDiff,
  saveAccounts,
  saveCookie,
  saveImportSnapshot,
  saveLastDiff,
  withStore,
} from './store.js';
import type { Account, AccountStatus } from './types.js';

const VALID_STATUS: readonly AccountStatus[] = ['pending', 'unfollowed', 'followedBack', 'keep'];

const countBy = (accounts: Account[]) => ({
  total: accounts.length,
  mutual: accounts.filter((a) => a.relationship === 'mutual').length,
  followingOnly: accounts.filter((a) => a.relationship === 'followingOnly').length,
  followerOnly: accounts.filter((a) => a.relationship === 'followerOnly').length,
  pending: accounts.filter((a) => a.status === 'pending').length,
  queued: accounts.filter((a) => a.queued).length,
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
  const { accounts, diff } = await withStore(async () => {
    const current = await loadAccounts();
    const d = diffAccounts(current.accounts, fresh);
    const merged = mergeAccounts(current.accounts, fresh);
    await saveAccounts({ updatedAt: now, accounts: merged });
    return { accounts: merged, diff: d };
  });
  await saveImportSnapshot(now.replace(/[:.]/g, '-'), {
    followers: parsed.followers,
    following: parsed.following,
  });
  await saveLastDiff({ importedAt: now, ...diff });
  const counts = countBy(accounts);
  return c.json({
    imported: counts.total,
    followers: parsed.followers.length,
    following: parsed.following.length,
    mutual: counts.mutual,
    followingOnly: counts.followingOnly,
    followerOnly: counts.followerOnly,
    diff,
  });
});

app.get('/api/accounts', async (c) => {
  const { relationship, status, q, sort, queued } = c.req.query();
  const { accounts, updatedAt } = await loadAccounts();
  let list = accounts;
  if (relationship) list = list.filter((a) => a.relationship === relationship);
  if (status) list = list.filter((a) => a.status === status);
  if (queued === 'true') list = list.filter((a) => a.queued);
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
  const body = await c.req
    .json<{ status?: string; queued?: boolean }>()
    .catch(() => ({}) as { status?: string; queued?: boolean });
  const hasStatus = body.status !== undefined;
  const hasQueued = typeof body.queued === 'boolean';
  if (!hasStatus && !hasQueued) {
    return c.json({ error: 'status または queued を指定してください' }, 400);
  }
  if (hasStatus && !VALID_STATUS.includes(body.status as AccountStatus)) {
    return c.json({ error: 'status が不正です' }, 400);
  }
  const result = await withStore(async () => {
    const file = await loadAccounts();
    const account = file.accounts.find((a) => a.username === username);
    if (!account) return null;
    if (hasStatus) {
      account.status = body.status as AccountStatus;
      account.statusChangedAt = new Date().toISOString();
    }
    if (hasQueued) account.queued = body.queued as boolean;
    await saveAccounts({ updatedAt: new Date().toISOString(), accounts: file.accounts });
    return account;
  });
  if (!result) return c.json({ error: 'アカウントが見つかりません' }, 404);
  return c.json({ account: result });
});

app.post('/api/queue/bulk', async (c) => {
  const body = await c.req
    .json<{ usernames?: unknown; queued?: unknown }>()
    .catch(() => ({}) as { usernames?: unknown; queued?: unknown });
  if (!Array.isArray(body.usernames) || typeof body.queued !== 'boolean') {
    return c.json({ error: 'usernames（配列）と queued（真偽値）を指定してください' }, 400);
  }
  const targets = new Set(body.usernames as string[]);
  const queued = body.queued;
  const updated = await withStore(async () => {
    const file = await loadAccounts();
    let count = 0;
    for (const a of file.accounts) {
      if (targets.has(a.username) && a.queued !== queued) {
        a.queued = queued;
        count++;
      }
    }
    await saveAccounts({ updatedAt: new Date().toISOString(), accounts: file.accounts });
    return count;
  });
  return c.json({ updated });
});

app.get('/api/settings/cookie', async (c) => c.json({ configured: (await loadCookie()) !== null }));

app.post('/api/settings/cookie', async (c) => {
  const body = await c.req.json<{ cookie?: string }>().catch(() => ({}) as { cookie?: string });
  const cookie = (body.cookie ?? '').trim();
  if (!cookie.includes('sessionid=')) {
    return c.json({ error: 'sessionid を含むCookie文字列を貼り付けてください' }, 400);
  }
  await saveCookie(cookie);
  return c.json({ ok: true });
});

app.post('/api/enrich/start', async (c) => {
  const body = await c.req
    .json<{ relationship?: string; onlyQueued?: boolean; limit?: number }>()
    .catch(() => ({}) as { relationship?: string; onlyQueued?: boolean; limit?: number });
  const scope = {
    relationship: body.relationship,
    onlyQueued: body.onlyQueued === true,
    limit: typeof body.limit === 'number' ? body.limit : undefined,
  };
  void runEnrich(undefined, undefined, scope); // 裏で直列実行。進捗は /api/enrich/status で取得
  return c.json(getEnrichStatus());
});

app.post('/api/enrich/stop', (c) => {
  stopEnrich();
  return c.json(getEnrichStatus());
});

app.get('/api/enrich/status', (c) => c.json(getEnrichStatus()));

// ブラウザ側（ログイン済みInstagram）で取得した raw user を受け取る取り込み口。
// text/plain で受けるためクロスオリジンでもプリフライト不要（サーバはCookieに触れない）。
app.post('/api/enrich/ingest', async (c) => {
  let body: { username?: string; user?: unknown; picDataUrl?: string };
  try {
    body = JSON.parse(await c.req.text());
  } catch {
    return c.json({ error: 'JSONを解析できません' }, 400);
  }
  if (!body.username || typeof body.username !== 'string') {
    return c.json({ error: 'username が必要です' }, 400);
  }
  await ingestProfile(body.username, (body.user ?? null) as never, body.picDataUrl ?? null);
  return c.json({ ok: true }, 200, { 'access-control-allow-origin': '*' });
});

app.get('/api/stats', async (c) => {
  const { accounts, updatedAt } = await loadAccounts();
  return c.json({ updatedAt, counts: countBy(accounts), lastDiff: await loadLastDiff() });
});

app.get('/profiles/:file', async (c) => {
  const file = c.req.param('file');
  if (!/^[a-zA-Z0-9._-]+$/.test(file)) return c.notFound();
  try {
    const buf = await readFile(join(dataDir(), 'profiles', file));
    return c.body(new Uint8Array(buf), 200, {
      'content-type': 'image/jpeg',
      'cache-control': 'public, max-age=86400',
    });
  } catch {
    return c.notFound();
  }
});
