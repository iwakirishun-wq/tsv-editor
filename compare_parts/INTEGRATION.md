# TSV差分比較機能 統合メモ

`compare_parts/` 配下の部品を `index.html` へ組み込む際の手順です。

## 1. ファイル構成
- `compare_parts/compare_engine.js`: 純粋な比較ロジック（DOM・window非依存）
- `compare_parts/compare_ui.html`: モーダル用HTMLフラグメント（`#cmp-overlay`）
- `compare_parts/compare_ui.css`: モーダル用スタイル（`cmp-` 接頭辞、既存変数 `--text-dim`, `--header-bg` を利用）
- `compare_parts/compare_ui.js`: UI制御（`window.TsvCompare` を公開）

## 2. index.html への貼り付け箇所

### CSS (`<style>` 内)
`compare_parts/compare_ui.css` の内容を既存の `<style>` 末尾に追加してください。

### HTML (`<body>` 末尾付近)
`compare_parts/compare_ui.html` の内容を `</body>` の直前（他のモーダルと同列）に貼り付けてください。
必須のルート要素IDは `cmp-overlay`（`class="modal-overlay cmp-overlay" hidden`）です。

### JS (`<script>` 内)
1. **比較エンジンの公開**
   `compare_parts/compare_engine.js` を埋め込み、グローバルに `window.TsvCompareEngine` を公開してください。
   例:
   ```js
   window.TsvCompareEngine = (function () {
     var module = { exports: {} };
     // ここに compare_engine.js の中身を配置
     return module.exports;
   })();
   ```
   公開が必要な関数:
   - `parseTsvForCompare(text, delim)`
   - `compareTables(base, cur, opts)`
   - `charDiff(a, b)`

2. **UIスクリプトの読み込み**
   `window.TsvCompareEngine` の定義後に `compare_parts/compare_ui.js` の内容を配置してください。
   これにより `window.TsvCompare = { open(opts) }` が公開されます。

## 3. 呼び出し方法
ツールバー等に「TSV差分比較」ボタンを追加し、クリック時に `window.TsvCompare.open(...)` を呼び出します。

```js
window.TsvCompare.open({
  getCurrentTab: function () {
    // 現在のアクティブタブがあれば { fileName: string, text: string } を返す
    // 無ければ null を返す
    return currentTab ? { fileName: currentTab.name, text: getTabTsvText(currentTab) } : null;
  }
});
```

- `getCurrentTab` を渡すと、左右それぞれのカードに「開いているタブを使う」ボタンが表示されます。
- 渡さない場合はファイル選択・ドラッグ＆ドロップのみが表示されます。
- モーダルは「閉じる」ボタンまたは `Esc` キーで閉じます。
