import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from './app.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ifm-app-'));
  process.env.DATA_DIR = dir;
});

afterEach(async () => {
  delete process.env.DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

const igEntry = (username: string, timestamp = 1700000000) => ({
  title: '',
  media_list_data: [],
  string_list_data: [
    { href: `https://www.instagram.com/${username}`, value: username, timestamp },
  ],
});

function sampleZip(): Uint8Array {
  return zipSync({
    'connections/followers_and_following/followers_1.json': strToU8(
      JSON.stringify([igEntry('mutual_a'), igEntry('fan_b')]),
    ),
    'connections/followers_and_following/following.json': strToU8(
      JSON.stringify({ relationships_following: [igEntry('mutual_a'), igEntry('oneway_c')] }),
    ),
  });
}

async function importSample() {
  const form = new FormData();
  form.append('file', new File([sampleZip() as BlobPart], 'export.zip', { type: 'application/zip' }));
  return app.request('/api/import', { method: 'POST', body: form });
}

describe('POST /api/import', () => {
  it('ZIPを取り込んで件数サマリーを返す', async () => {
    const res = await importSample();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      imported: 3,
      followers: 2,
      following: 2,
      mutual: 1,
      followingOnly: 1,
      followerOnly: 1,
    });
  });

  it('ファイル無しは400', async () => {
    const form = new FormData();
    const res = await app.request('/api/import', { method: 'POST', body: form });
    expect(res.status).toBe(400);
  });

  it('不正なZIPは422で日本語メッセージ', async () => {
    const form = new FormData();
    form.append('file', new File([strToU8('not a zip')], 'x.zip'));
    const res = await app.request('/api/import', { method: 'POST', body: form });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain('ZIP');
  });
});

describe('GET /api/accounts', () => {
  it('全件と件数を返す', async () => {
    await importSample();
    const res = await app.request('/api/accounts');
    const body = await res.json();
    expect(body.accounts).toHaveLength(3);
    expect(body.counts).toMatchObject({ total: 3, mutual: 1, followingOnly: 1, followerOnly: 1, pending: 3 });
  });

  it('relationship / q で絞り込める', async () => {
    await importSample();
    const rel = await (await app.request('/api/accounts?relationship=followingOnly')).json();
    expect(rel.accounts.map((a: { username: string }) => a.username)).toEqual(['oneway_c']);
    const q = await (await app.request('/api/accounts?q=FAN')).json();
    expect(q.accounts.map((a: { username: string }) => a.username)).toEqual(['fan_b']);
  });
});

describe('PATCH /api/accounts/:username', () => {
  it('statusを更新して永続化する', async () => {
    await importSample();
    const res = await app.request('/api/accounts/oneway_c', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'unfollowed' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).account.status).toBe('unfollowed');
    const after = await (await app.request('/api/accounts?status=unfollowed')).json();
    expect(after.accounts).toHaveLength(1);
  });

  it('不正なstatusは400 / 未知のユーザーは404', async () => {
    await importSample();
    const bad = await app.request('/api/accounts/oneway_c', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'nope' }),
    });
    expect(bad.status).toBe(400);
    const missing = await app.request('/api/accounts/ghost', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'keep' }),
    });
    expect(missing.status).toBe(404);
  });
});

describe('queue', () => {
  it('POST /api/queue/bulk で複数アカウントをキューに入れ、?queued=true で取れる', async () => {
    await importSample();
    const res = await app.request('/api/queue/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usernames: ['oneway_c', 'fan_b'], queued: true }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(2);
    const q = await (await app.request('/api/accounts?queued=true')).json();
    expect(q.accounts.map((a: { username: string }) => a.username).sort()).toEqual(['fan_b', 'oneway_c']);
    expect(q.counts.queued).toBe(2);
  });

  it('PATCH で status と queued を同時更新できる（キュー消化の1操作）', async () => {
    await importSample();
    await app.request('/api/queue/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usernames: ['oneway_c'], queued: true }),
    });
    const res = await app.request('/api/accounts/oneway_c', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'unfollowed', queued: false }),
    });
    expect(res.status).toBe(200);
    const { account } = await res.json();
    expect(account.status).toBe('unfollowed');
    expect(account.queued).toBe(false);
  });

  it('queued だけの PATCH も可能', async () => {
    await importSample();
    const res = await app.request('/api/accounts/fan_b', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queued: true }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).account.queued).toBe(true);
  });

  it('queue/bulk の入力不正は400', async () => {
    const res = await app.request('/api/queue/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usernames: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  it('PATCH で本文が空なら400', async () => {
    await importSample();
    const res = await app.request('/api/accounts/oneway_c', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('settings/enrich API', () => {
  it('Cookie設定: sessionidを含まないと400、設定後は configured=true', async () => {
    const before = await (await app.request('/api/settings/cookie')).json();
    expect(before.configured).toBe(false);
    const bad = await app.request('/api/settings/cookie', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cookie: 'foo=bar' }),
    });
    expect(bad.status).toBe(400);
    const ok = await app.request('/api/settings/cookie', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cookie: 'sessionid=abc; ds_user_id=1' }),
    });
    expect(ok.status).toBe(200);
    const after = await (await app.request('/api/settings/cookie')).json();
    expect(after.configured).toBe(true);
  });

  it('GET /api/enrich/status が状態を返す', async () => {
    const res = await app.request('/api/enrich/status');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(['idle', 'running', 'stopped', 'done']).toContain(body.state);
  });

  it('POST /api/enrich/stop は200', async () => {
    const res = await app.request('/api/enrich/stop', { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('/profiles/:file はパストラバーサルを拒否する', async () => {
    const res = await app.request('/profiles/..%2Faccounts.json');
    expect([400, 404]).toContain(res.status);
  });
});

describe('diff & stats', () => {
  it('再取り込みで差分がレスポンスに含まれ、statsで取れる', async () => {
    await importSample();
    // oneway_c をアンフォロー済みにするが、同じZIPを再取り込み → まだフォロー中なので未完了
    await app.request('/api/accounts/oneway_c', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'unfollowed' }),
    });
    const res = await importSample();
    const body = await res.json();
    expect(body.diff.unfollowIncomplete).toEqual(['oneway_c']);
    expect(body.diff.newFollowers).toEqual([]);
    // 未完了は pending に戻る
    const acc = await (await app.request('/api/accounts?q=oneway_c')).json();
    expect(acc.accounts[0].status).toBe('pending');
    // stats に最新差分が入る
    const stats = await (await app.request('/api/stats')).json();
    expect(stats.lastDiff.unfollowIncomplete).toEqual(['oneway_c']);
    expect(stats.lastDiff.importedAt).toBeTruthy();
    expect(stats.counts.total).toBe(3);
  });

  it('初回取り込みでは差分は全て空', async () => {
    const res = await importSample();
    const body = await res.json();
    expect(body.diff.newFollowers.sort()).toEqual(['fan_b', 'mutual_a']);
    expect(body.diff.unfollowConfirmed).toEqual([]);
  });
});
