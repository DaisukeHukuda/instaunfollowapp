# Instagram フォロー整理アプリ

自分のInstagramのフォロー/フォロワーを公式エクスポートから読み込み、
関係性（相互・片思い・ファン）で整理してアンフォロー作業を助けるPCローカル専用アプリ。

## 使い方

1. `npm install`（初回のみ）
2. `npm start`
3. ブラウザで http://localhost:3900 を開く
4. 「取り込み」タブでInstagramのエクスポートZIP（**JSON形式**）を読み込む
5. 「一覧」タブで整理。「開く」でプロフィールを開き、Instagram上でアンフォロー →
   アプリに戻って「アンフォロー済み」を押して記録

- アンフォロー/フォローの実行自体は自動化しません（規約違反・凍結リスク回避のため）。
- データはすべて `data/` フォルダ内（PCの外に出ません）。

## 開発

- `npm run dev` … サーバ(3900) + Vite(5173) を同時起動（http://localhost:5173 を開く）
- `npm test` … サーバのユニットテスト
- `node server/scripts/make-sample-zip.mjs` … 動作確認用サンプルZIPを生成

設計書: `docs/superpowers/specs/2026-07-03-insta-follow-manager-design.md`
