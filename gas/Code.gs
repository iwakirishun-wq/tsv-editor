/**
 * チケットTSV/CSVエディタ GAS Web App
 * 
 * 役割:
 *  - 高速・軽量なTSV/CSVエディタ画面を配信
 *  - 編集データはブラウザメモリ上のみで処理（完全セキュア・外部送信なし）
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
