/**
 * チケットTSV/CSVエディタ GAS Web App
 *
 * 役割:
 *  - 高速・軽量なTSV/CSVエディタ画面を配信
 *  - 編集データはブラウザメモリ上のみで処理し、既定では外部へ送信しない
 *  - 例外: 「HP突合」の「AIに説明させる」を押したときだけ、差分になった行を
 *    HpCheck.gs の askGemini 経由で Gemini API へ送る（TSV全体は送らない）
 *  - 例外2: 「不具合報告」を押して保存したときだけ、画面・内部状態・操作ログ（任意で表全体）を
 *    BugReport.gs 経由で本人のDriveへ保存する（GAS版だけの機能。外部サービスへは送らない）
 */

function doGet() {
  var template = HtmlService.createTemplateFromFile('index');
  var output = template.evaluate()
    .setTitle('チケットTSV/CSVエディタ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return injectBugReport_(output);
}

/**
 * GAS版だけの「不具合レポート」(BugReport.html) を、配信するHTMLの最初の <body> 直後へ注入する。
 * index.html は通常版（ルートの index.html）と同一内容のコピーなので、GAS専用コードは混ぜずにここで足す。
 * 失敗してもエディタ本体は配信する（不具合報告が壊れてもアプリを使えなくしない）。
 * @param {GoogleAppsScript.HTML.HtmlOutput} output
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 */
function injectBugReport_(output) {
  try {
    var html = output.getContent();
    var m = /<body[^>]*>/i.exec(html);
    if (!m) return output;
    var raw = HtmlService.createHtmlOutputFromFile('index').getContent();
    var md5 = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw, Utilities.Charset.UTF_8)
      .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
    var inject = HtmlService.createHtmlOutputFromFile('BugReport').getContent().replace('__PAGE_MD5__', md5);
    var at = m.index + m[0].length;
    output.setContent(html.slice(0, at) + inject + html.slice(at));
  } catch (e) {
    console.error('不具合レポートの注入に失敗: ' + e.message);
  }
  return output;
}

/**
 * HTMLテンプレート内で別ファイルをインクルードするためのヘルパー
 * @param {string} filename 読み込むファイル名
 * @return {string} HTMLコンテンツ
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
