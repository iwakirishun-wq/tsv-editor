# tsv-editor architecture

`tsv-editor` はブラウザで `index.html` を直接開ける単一ファイル配布を維持しつつ、編集用ソースを `src/` に分割しています。

## Source layout

- `src/index.template.html`: 単一HTMLを生成するための外枠。CSS、本文DOM、JavaScript はプレースホルダーで差し込みます。
- `src/index.body.html`: `<body>` 直下のUIマークアップ。末尾の `<script>` は含めません。
- `src/styles/app.css`: アプリ本体のCSS。HTMLエクスポート用テンプレート文字列内のCSSは、該当するJSファイル側に残します。
- `src/scripts/*.js`: ブラウザに読み込ませる従来のグローバルスクリプトを、元の `// ===== ... =====` セクション単位で並べ替えずに分割したものです。
- `tools/build_single_html.py`: `src/` から単一のHTMLを生成、または既存 `index.html` と一致するか検証します。

## JavaScript chunks

`src/scripts` はファイル名順に連結されます。ES modules は `file://` での直接利用に制約があるため使っていません。

- `00-state-dom.js`: 状態、DOM参照、基本アクセサ、dirty状態。
- `01-tabs-init-files.js`: タブ、初期化、ファイル読込、ヘッダー変換、リロード警告。
- `02-sort-filter-render.js`: ソート、フィルター、仮想描画、theadイベント委譲。
- `03-mouse-editing-keyboard.js`: マウス操作、編集、辞書エディター、キーボード操作。
- `04-clipboard-replace-context.js`: クリップボード、行コピー、置換、右クリックメニュー。
- `05-utilities-resize-view.js`: 検索系ユーティリティ、リサイズ、非表示、行操作、表示補助。
- `06-html-sej-export.js`: HTMLプレビュー/エクスポート、SEJ連携。
- `07-view-options-recent-pwa.js`: 表示オプション、最近開いたファイル、フォーカス制御、マニュアル、PWA関連。

## Build

開発時は `src/` を編集し、生成結果を検証してから `index.html` を更新します。

```powershell
python tools\build_single_html.py --check
python tools\build_single_html.py
```

一時的に `dist/index.html` を作る場合は出力先を指定します。

```powershell
python tools\build_single_html.py --output dist\index.html
```

## Refactoring rules

- 配布面は `index.html` 1ファイルのまま維持します。
- `src/scripts` の連結順はファイル名で決まるため、依存順を変える変更はレビューで明示します。
- localStorage のキー、ショートカット、既存UI文言、保存形式は、分割作業では変更しません。
- 実データTSVはリポジトリに追加しません。テストに必要なデータはダミーだけを使います。
