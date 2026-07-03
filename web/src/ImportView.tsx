import { useRef, useState } from 'react';
import { importZip } from './api';
import type { ImportSummary } from './types';

export default function ImportView() {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
          <p>「一覧」タブで整理を始められます。</p>
        </div>
      )}
    </div>
  );
}
