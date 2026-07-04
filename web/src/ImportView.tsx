import { useEffect, useRef, useState } from 'react';
import EnrichPanel from './EnrichPanel';
import { fetchStats, importZip } from './api';
import type { ImportDiff, ImportSummary, StatsResponse } from './types';

export default function ImportView() {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);

  useEffect(() => {
    fetchStats().then(setStats).catch(() => {});
  }, [summary]);

  const upload = (file: File) => {
    setBusy(true);
    setError('');
    setSummary(null);
    importZip(file)
      .then(setSummary)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="import-view">
      <h2>エクスポートZIPの取り込み</h2>
      <ol className="guide">
        <li>Instagramアプリ: 設定 → アカウントセンター → あなたの情報とアクセス許可 → 情報をエクスポート</li>
        <li>「フォロワーとフォロー中」だけ選択・期間は「すべての期間」・<strong>フォーマットは必ず JSON</strong></li>
        <li>完了メールが届いたらZIPをダウンロードして、ここに読み込ませる</li>
      </ol>
      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) upload(file);
        }}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? '取り込み中…' : 'ここにZIPをドラッグ&ドロップ（クリックでファイル選択）'}
        <input
          ref={inputRef}
          type="file"
          accept=".zip"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
            e.target.value = '';
          }}
        />
      </div>
      {error && <p className="error">{error}</p>}
      {summary && (
        <div className="import-summary">
          <h3>取り込み完了 ✅</h3>
          <ul>
            <li>合計: {summary.imported} アカウント</li>
            <li>フォロワー: {summary.followers} / フォロー中: {summary.following}</li>
            <li>
              相互 {summary.mutual} ｜ 片思い {summary.followingOnly} ｜ ファン {summary.followerOnly}
            </li>
          </ul>
          <h4>前回からの変化</h4>
          <DiffSummary diff={summary.diff} />
          <p>「一覧」タブで整理を始められます。</p>
        </div>
      )}
      {stats && (
        <div className="stats-section">
          <h2>統計</h2>
          <p className="muted">
            最終取り込み: {stats.updatedAt ? new Date(stats.updatedAt).toLocaleString('ja-JP') : '未取り込み'} ｜ 全
            {stats.counts.total}件（相互 {stats.counts.mutual} ｜ 片思い {stats.counts.followingOnly} ｜ ファン{' '}
            {stats.counts.followerOnly} ｜ 未処理 {stats.counts.pending} ｜ キュー {stats.counts.queued}）
          </p>
          {stats.lastDiff && (
            <>
              <p className="muted">
                前回取り込み（{new Date(stats.lastDiff.importedAt).toLocaleString('ja-JP')}）の差分:
              </p>
              <DiffSummary diff={stats.lastDiff} />
            </>
          )}
        </div>
      )}
      <hr className="divider" />
      <EnrichPanel />
    </div>
  );
}

function DiffSummary({ diff }: { diff: ImportDiff & { importedAt?: string } }) {
  const rows: { label: string; users: string[]; highlight?: boolean }[] = [
    { label: 'アンフォロー確定', users: diff.unfollowConfirmed, highlight: true },
    { label: 'アンフォロー未完了（未処理に戻しました）', users: diff.unfollowIncomplete },
    { label: 'フォローバック反映', users: diff.followBackConfirmed },
    { label: '新規フォロワー', users: diff.newFollowers, highlight: true },
    { label: '離脱フォロワー', users: diff.lostFollowers },
    { label: '新しくフォロー', users: diff.newFollowing },
  ];
  return (
    <ul className="diff-list">
      {rows.map((r) => (
        <li key={r.label}>
          <span className={r.highlight && r.users.length > 0 ? 'diff-highlight' : ''}>
            {r.label}: {r.users.length} 件
          </span>
          {r.users.length > 0 && r.users.length <= 50 && (
            <details>
              <summary>一覧を見る</summary>
              <div className="diff-users">
                {r.users.map((u) => (
                  <a key={u} href={`https://www.instagram.com/${u}/`} target="_blank" rel="noreferrer">
                    @{u}
                  </a>
                ))}
              </div>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
