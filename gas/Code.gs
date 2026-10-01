/**
 * チケットTSV/CSVエディタ GAS Web App
 * 
 * 役割:
 *  - 高速・軽量なTSV/CSVエディタ画面を配信
 *  - 編集データはブラウザメモリ上のみで処理し、既定では外部へ送信しない
 *  - 例外: 「HP突合」の「AIに説明させる」を押したときだけ、差分になった行を
 *    HpCheck.gs の askGemini 経由で Gemini API へ送る（TSV全体は送らない）
 */

function doGet() {
  var template = HtmlService.createTemplateFromFile('index');
  return template.evaluate()
    .setTitle('チケットTSV/CSVエディタ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * HTMLテンプレート内で別ファイルをインクルードするためのヘルパー
 * @param {string} filename 読み込むファイル名
 * @return {string} HTMLコンテンツ
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
