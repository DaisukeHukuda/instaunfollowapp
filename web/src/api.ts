import type { Account, AccountsResponse, AccountStatus, EnrichStatus, ImportSummary } from './types';

async function handle<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export function fetchAccounts(params: {
  relationship?: string;
  status?: string;
  q?: string;
  sort?: string;
  queued?: string;
}): Promise<AccountsResponse> {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v) as [string, string][],
  );
  return fetch(`/api/accounts?${qs}`).then((r) => handle<AccountsResponse>(r));
}

export function updateAccount(
  username: string,
  patch: { status?: AccountStatus; queued?: boolean },
): Promise<Account> {
  return fetch(`/api/accounts/${encodeURIComponent(username)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
    .then((r) => handle<{ account: Account }>(r))
    .then((b) => b.account);
}

export function bulkQueue(usernames: string[], queued: boolean): Promise<number> {
  return fetch('/api/queue/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usernames, queued }),
  })
    .then((r) => handle<{ updated: number }>(r))
    .then((b) => b.updated);
}

export function importZip(file: File): Promise<ImportSummary> {
  const form = new FormData();
  form.append('file', file);
  return fetch('/api/import', { method: 'POST', body: form }).then((r) =>
    handle<ImportSummary>(r),
  );
}

export function getCookieConfigured(): Promise<boolean> {
  return fetch('/api/settings/cookie')
    .then((r) => handle<{ configured: boolean }>(r))
    .then((b) => b.configured);
}

export function saveCookieValue(cookie: string): Promise<void> {
  return fetch('/api/settings/cookie', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cookie }),
  })
    .then((r) => handle<{ ok: boolean }>(r))
    .then(() => undefined);
}

export function enrichStart(): Promise<EnrichStatus> {
  return fetch('/api/enrich/start', { method: 'POST' }).then((r) => handle<EnrichStatus>(r));
}

export function enrichStop(): Promise<EnrichStatus> {
  return fetch('/api/enrich/stop', { method: 'POST' }).then((r) => handle<EnrichStatus>(r));
}

export function enrichStatus(): Promise<EnrichStatus> {
  return fetch('/api/enrich/status').then((r) => handle<EnrichStatus>(r));
}
