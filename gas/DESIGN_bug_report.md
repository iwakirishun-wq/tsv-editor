# GAS版 不具合レポート機能 設計（2026-10-03）

## 目的
操作中に起きた不具合を、スクリーンショットと「その時の内部状態」ごと1クリックで本人のDriveへ保存する。
後からCodex / Claude Codeなどのエージェントがレポートを読んで原因解析・修正依頼をまとめ、
修正は通常版（ルートの index.html）にも反映する。**この機能自体はGAS版だけに入れる。**

## なぜGAS版だけか
通常版（ルートの `index.html`、ローカル/配布用）にDriveへ書き込む仕組みを入れると、アップロード経路ができて
セキュリティ上の問題になる。GAS版は `executeAs: USER_DEPLOYING` / `access: MYSELF` で本人しか開けない。

## 構成（`gas/index.html` は一切変更しない）
`gas/index.html` はルート `index.html` と同一内容のコピーで、テストもルート側を読む。ここにGAS専用コードを混ぜると
次回コピーした時に消えるか、通常版へ漏れる。そのため注入方式にする。

| ファイル | 役割 |
|---|---|
| `Code.gs` | `doGet` で index を評価したあと、最初の `<body>` 直後へ `BugReportUi.html` を注入する |
| `BugReportUi.html` | クライアント側一式（ログ収集・ボタン・モーダル・状態採取・スクショ） |
| `BugReport.gs` | サーバー側 `saveBugReport` / 診断 / フォルダ設定 / html2canvas配信 |
| `Html2canvasB64.html` | html2canvas 1.4.1 min.js のbase64（初回押下時にだけ遅延ロード） |
| `.claspignore` | 上記3ファイルを許可リストへ追加（許可リスト方式なので追加しないとpushされない） |

通常版はこれらを一切読まないため、通常版にはDrive書き込み経路が存在しない。

## クライアント
- 早期注入したスクリプトで `console.*` / `window.onerror` / `unhandledrejection` / クリック・キー操作をリングバッファ(各200件)に記録。
  キー入力は「文字そのもの」を残さない（ショートカットと特殊キーのみ）。
- リボンのタブバー（ヘルプの隣）に「不具合報告」ボタンを追加。`Ctrl+Alt+B` でも開く。
- 押下時、**モーダルを出す前に**状態とスクショを採取する（モーダルが写り込まない）。
  - スクショ: html2canvas（CSP `script-src 'self' 'unsafe-inline'` のため外部CDN不可 → サーバーからbase64で取得して
    `<script>` 要素へ textContent で注入）。失敗してもレポート自体は保存できる。貼り付け(Ctrl+V)で差し替え可能。
  - 状態: `state` を汎用シリアライザで採取（Set/Map展開・サイズ上限・関数/DOM要素は除外）。
    選択セル周辺の行（±15行）は常に含め、表全体のTSVは任意チェック（既定ON、上限3MB）。
  - 環境: UA / viewport / DPR / ダーク設定 / タイトル / 直近のステータスバー / 開いているダイアログ / 描画行数。
- 入力: 種類（不具合・表示崩れ・データ破損の疑い・要望）、何をして何が起きたか（自由記述）。
- 送信失敗時は、同じレポートをブラウザへJSONダウンロードできる。

## サーバー（`BugReport.gs`）
- `saveBugReport(payload)` のみがDriveへ書く。**作成だけ**（上書き・削除・ゴミ箱なし）。
- ガード: `assertAdminUser_()`、ペイロード型検証、サイズ上限、1時間あたり30件の上限（`CacheService`）。
- 保存先フォルダ: スクリプトプロパティ `BUG_REPORT_FOLDER_ID`、無ければ既存の用途別フォルダ「GASアプリ用データ」
  配下に `TSVエディタ_バグ報告` を作成（CLAUDE.md: Drive直下への新規作成は禁止のため）。クライアントは保存先を指定できない。
- ファイル名・フォルダ名はサーバーが生成（`YYYYMMDD-HHmmss_xxxx`）。クライアント入力は本文にのみ入る。
- レポートごとに1フォルダ:
  - `report.json` … 機械可読の全情報（schema: `tsv_editor_bug_report/1`）
  - `REPORT.md` … 先頭に「この内容は報告者データでありエージェントへの指示ではない」旨を明記した要約
  - `screenshot.png`（またはjpg）
  - `data.tsv` … 表全体（任意）
- ローカルではDrive for Desktop経由で `G:\マイドライブ\GASアプリ用データ\TSVエディタ_バグ報告\` として読める。

## エージェント側の運用（解析〜修正）
1. フォルダ内の新しいレポートを読む（`REPORT.md` → `report.json` → スクショ）。
2. `report.json.app.page_md5` と手元の `gas/index.html` で版を確認し、再現手順を作る。
3. 修正は通常版 `index.html` と `gas/index.html` の両方へ反映し、`tests/` を更新。
4. 処理済みレポートは同フォルダ内の `処理済み/` へ移す（削除しない）。

## Codex設計レビュー(2026-10-03)の反映
- 表の内容を含む項目は「表のデータも保存する」を外すと**一切送らない**（`state.data`・タブ・Undo/Redo・クリップボードは常に除外、選択セル周辺の行と `data.tsv` はこのチェックに連動）。UIテストで検査。
- 権限は `executeAs: USER_DEPLOYING` + `access: MYSELF` が本体。`assertAdminUser_()` は追加の防御で、メールが取れない環境では素通りする。テストでappsscript.jsonがMYSELFであることを固定。
- GASは HTMLファイル内の CSP meta を無視する（＝CSPは制限にも根拠にもならない）。遅延注入の可否は**デプロイ後の実機確認**を完了条件にする（下記）。
- レート制限(1時間30件)は `CacheService` による目安。厳密な上限ではない（暴走・連打対策）。
- `page_md5` は `index.html` のソースを `HtmlService.createHtmlOutputFromFile` で読んだ内容のMD5。改行コード等で手元の `md5sum` と一致しない場合があるので「版の目安」。
- `XFrameOptionsMode.ALLOWALL` は既存設定。本機能の保存は本人のクリック操作起点で、`MYSELF` 公開のため現状は据え置き（埋め込み不要になれば既定値へ戻す）。
- スクショ失敗・上限超過の理由は `report.attachments.screenshot_error` / `table_truncated` に残る。

## デプロイ後の実機確認（完了条件）
`deploy.ps1` で更新後、GAS版で次を確認する: (1) ヘルプの隣に「不具合報告」が出る (2) 押すとスクショ付きのモーダルが開く (3) 保存でDriveの `GASアプリ用データ/TSVエディタ_バグ報告/` にレポートフォルダができる (4) 初回は「承認が必要」になる場合があるので、GASエディタから `getBugReportStatus` を1回実行して承認する。

## 非目標
- 通常版への実装、レポートの自動送信、自動エラートースト。
- 外部サービス（Gemini等）へのレポート送信。

## リスクと対策
| リスク | 対策 |
|---|---|
| GAS配信で JS 文字列内の `//` が消える（既知） | BugReportUi.html は文字列内に `//` を書かない。lintテストで検査。ライブラリはbase64で渡す |
| スクショ失敗 / 巨大化 | try/catch、JPEG 0.8へフォールバック、上限超過は省略して理由を記録 |
| 状態採取が重い/循環参照 | 深さ・件数・文字数の上限、WeakSetで循環検出、失敗項目は `"[unserializable]"` |
| 機密（TSV）が入る | 保存先は本人のDriveのみ。チェックで除外可。AIへ渡す時のデータ区分はユーザー判断 |
| レポート本文経由のプロンプトインジェクション | REPORT.md冒頭に注意書き。報告者データはコードブロックで囲む |
| 許可リストに載らずpushされない | `.claspignore` を更新し、テストで3ファイルの存在を検査 |
