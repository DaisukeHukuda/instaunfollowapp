import type { Account, AccountsResponse, AccountStatus, ImportSummary } from './types';

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
}): Promise<AccountsResponse> {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v) as [string, string][],
  );
  return fetch(`/api/accounts?${qs}`).then((r) => handle<AccountsResponse>(r));
}

export function updateStatus(username: string, status: AccountStatus): Promise<Account> {
  return fetch(`/api/accounts/${encodeURIComponent(username)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
  })
    .then((r) => handle<{ account: Account }>(r))
    .then((b) => b.account);
}

export function importZip(file: File): Promise<ImportSummary> {
  const form = new FormData();
  form.append('file', file);
  return fetch('/api/import', { method: 'POST', body: form }).then((r) =>
    handle<ImportSummary>(r),
  );
}
