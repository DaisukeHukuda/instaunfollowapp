import { useEffect, useState } from 'react';
import {
  enrichStart,
  enrichStatus,
  enrichStop,
  getCookieConfigured,
  saveCookieValue,
} from './api';
import type { EnrichScope } from './api';
import type { EnrichStatus } from './types';

const STATE_LABEL: Record<EnrichStatus['state'], string> = {
  idle: '未実行',
  running: '取得中…',
  stopped: '停止',
  done: '完了',
};

const SCOPE_OPTIONS = [
  { value: 'followingOnly', label: '片思いのみ（アンフォロー候補）' },
  { value: '', label: 'すべて（未取得の全件）' },
  { value: 'followerOnly', label: 'ファンのみ' },
  { value: 'mutual', label: '相互のみ' },
  { value: 'queued', label: 'キューに入れた分のみ' },
] as const;

/** 画面の選択値を API の scope に変換 */
function toScope(value: string, limit?: number): EnrichScope {
  const scope: EnrichScope = {};
  if (value === 'queued') scope.onlyQueued = true;
  else if (value) scope.relationship = value;
  if (limit != null) scope.limit = limit;
  return scope;
}

export default function EnrichPanel() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [cookie, setCookie] = useState('');
  const [st, setSt] = useState<EnrichStatus | null>(null);
  const [scope, setScope] = useState('followingOnly');
  const [error, setError] = useState('');

  useEffect(() => {
    getCookieConfigured().then(setConfigured).catch(() => setConfigured(false));
    enrichStatus().then(setSt).catch(() => {});
  }, []);

  useEffect(() => {
    if (st?.state !== 'running') return;
    const id = window.setInterval(() => {
      enrichStatus().then(setSt).catch(() => {});
    }, 2000);
    return () => window.clearInterval(id);
  }, [st?.state]);

  const onSaveCookie = () => {
    setError('');
    saveCookieValue(cookie)
      .then(() => {
        setConfigured(true);
        setCookie('');
      })
      .catch((e: Error) => setError(e.message));
  };

  const onStart = (limit?: number) => {
    setError('');
    enrichStart(toScope(scope, limit)).then(setSt).catch((e: Error) => setError(e.message));
  };

  const onStop = () => {
    enrichStop().then(setSt).catch((e: Error) => setError(e.message));
  };

  const attempted = st ? st.done + st.failed : 0;
  const pct = st && st.total > 0 ? Math.round((attempted / st.total) * 100) : 0;

  return (
    <div className="enrich-panel">
      <h2>プロフィール自動取得</h2>
      <p className="muted">
        あなたのログインCookieを使って、写真・自己紹介・フォロワー数を1件ずつゆっくり（3〜5秒間隔）取得します。
        エラーを検知すると自動停止する安全設計です。取得済みのアカウントはスキップされます。
      </p>

      <h3>1. Cookieの設定 {configured && <span className="ok-badge">設定済み ✅</span>}</h3>
      <details className="guide-details">
        <summary>Cookieの取り方（クリックで開く）</summary>
        <ol className="guide">
          <li>Chromeで instagram.com を開いてログインする</li>
          <li>⌘⌥I でデベロッパーツールを開き、「ネットワーク」タブを選ぶ</li>
          <li>⌘R でページを再読み込みし、一覧の一番上の項目（www.instagram.com）をクリック</li>
          <li>「ヘッダー」→「リクエストヘッダー」の <code>cookie:</code> の値を全部コピーして下に貼り付ける</li>
        </ol>
      </details>
      <div className="cookie-form">
        <textarea
          rows={3}
          placeholder="cookie: の値をここに貼り付け（sessionid=... を含む長い文字列）"
          value={cookie}
          onChange={(e) => setCookie(e.target.value)}
        />
        <button disabled={cookie.trim() === ''} onClick={onSaveCookie}>
          保存
        </button>
      </div>

      <h3>2. 取得の実行</h3>
      <div className="enrich-controls">
        <label className="muted">対象</label>
        <select
          value={scope}
          disabled={st?.state === 'running'}
          onChange={(e) => setScope(e.target.value)}
        >
          {SCOPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="enrich-controls">
        <button
          disabled={!configured || st?.state === 'running'}
          onClick={() => onStart(10)}
          title="まず10件だけ取得して動作を確認します"
        >
          まず10件だけ試す
        </button>
        <button disabled={!configured || st?.state === 'running'} onClick={() => onStart()}>
          {st?.state === 'stopped' ? '続きを取得' : 'この対象を取得'}
        </button>
        {st?.state === 'running' && <button onClick={onStop}>停止</button>}
        {st && <span className="muted">状態: {STATE_LABEL[st.state]}</span>}
      </div>
      {st && st.total > 0 && (
        <div className="enrich-progress">
          <div className="progress-outer">
            <div className="progress-inner" style={{ width: `${pct}%` }} />
          </div>
          <div className="muted">
            {attempted} / {st.total} 件{st.failed > 0 && `（失敗 ${st.failed}）`}
            {st.current && ` ｜ 取得中: @${st.current}`}
          </div>
        </div>
      )}
      {st?.reason && <p className="warn">{st.reason}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
