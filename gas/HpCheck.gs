/**
 * HP料金ナレッジ突合チェック & Gemini連携 サーバー側処理
 * 
 * 公開関数:
 *  - listHpEvents(): Drive上のナレッジからイベント一覧を取得
 *  - getHpKnowledge(eventKey): 指定イベントのナレッジを取得（イベント単位で絞り込み）
 *  - askGemini(payload): 差分行データについてGemini APIに問い合わせ
 * 
 * 注意:
 *  - 文字列リテラル内に "//" を含めないこと（GAS配信バグ対策）
 *  - 認証情報・APIキーはスクリプトプロパティで管理し、コードやログに出さないこと
 *  - Driveは読み取り専用で利用すること
 */

/**
 * Drive上のHP料金ナレッジJSONを安全に読み込む内部ヘルパー
 * @return {{ data?: Object, error?: string }}
 */
function loadHpKnowledgeData_() {
  var props = PropertiesService.getScriptProperties();
  var fileId = props.getProperty('HP_KNOWLEDGE_FILE_ID') || DEFAULT_HP_KNOWLEDGE_FILE_ID;
  if (!fileId || !fileId.trim()) {
    return { error: 'HP_KNOWLEDGE_FILE_ID が未設定です' };
  }
  fileId = fileId.trim();

  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (e) {
    return { error: 'Driveファイルが見つかりません (ID: ' + fileId + '): ' + e.message };
  }

  if (!file) {
    return { error: 'Driveファイルが見つかりません (ID: ' + fileId + ')' };
  }

  try {
    if (file.isTrashed && file.isTrashed()) {
      return { error: '指定されたナレッジファイルはゴミ箱にあります (ID: ' + fileId + ')' };
    }
  } catch (_) {
    // isTrashed 判定で例外が出た場合は無視して続行
  }

  var content;
  try {
    content = file.getBlob().getDataAsString('UTF-8');
  } catch (e) {
    return { error: 'ナレッジファイルの読み取りに失敗しました: ' + e.message };
  }

  if (!content || !content.trim()) {
    return { error: 'ナレッジファイルが空です' };
  }

  var data;
  try {
    data = JSON.parse(content);
  } catch (e) {
    return { error: 'ナレッジJSONの解析に失敗しました: ' + e.message };
  }

  if (!data || typeof data !== 'object') {
    return { error: 'ナレッジデータの形式が不正です（オブジェクトではありません）' };
  }

  if (data.schema !== 'hp_price_knowledge/1') {
    return { error: '未対応のスキーマです (期待値: hp_price_knowledge/1, 実際: ' + (data.schema || 'なし') + ')' };
  }

  return { data: data };
}

/**
 * 利用可能なイベントの一覧を取得する
 * @return {Array<{ key: string, label: string, built_at: ?string, item_count: number }> | { error: string }}
 */
function listHpEvents() {
  try {
    var res = loadHpKnowledgeData_();
    if (res.error) {
      return { error: res.error };
    }

    var data = res.data;
    var eventsObj = data.events;
    if (!eventsObj || typeof eventsObj !== 'object') {
      return { error: 'events フィールドが存在しないか不正です' };
    }

    var list = [];
    var keys = Object.keys(eventsObj);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var ev = eventsObj[key] || {};
      var items = ev.items;
      var count = Array.isArray(items) ? items.length : 0;
      list.push({
        key: key,
        label: ev.label || key,
        built_at: ev.built_at || data.built_at || null,
        item_count: count
      });
    }

    return list;
  } catch (e) {
    return { error: 'listHpEvents の実行中にエラーが発生しました: ' + e.message };
  }
}

/**
 * 指定されたイベントのナレッジデータのみを取得する（全体は返さない）
 * @param {string} eventKey イベントのキー（例: '鈴鹿_27F1'）
 * @return {Object} イベントデータまたはエラーオブジェクト
 */
function getHpKnowledge(eventKey) {
  try {
    if (!eventKey || typeof eventKey !== 'string') {
      return { error: 'eventKey が指定されていないか文字列ではありません' };
    }

    var res = loadHpKnowledgeData_();
    if (res.error) {
      return { error: res.error };
    }

    var data = res.data;
    var eventsObj = data.events;
    if (!eventsObj || typeof eventsObj !== 'object') {
      return { error: 'events フィールドが存在しないか不正です' };
    }

    if (!Object.prototype.hasOwnProperty.call(eventsObj, eventKey)) {
      return { error: '指定されたイベントキーが見つかりません: ' + eventKey };
    }

    var ev = eventsObj[eventKey] || {};

    // 同じ中身を event / events / 平坦化の3通りで返すと、せっかくイベント単位に絞った意味が薄れる
    // （items が数百件あると転送量が3倍になる）。画面側が使う平坦形だけを返す。
    return {
      schema: data.schema,
      built_at: data.built_at || null,
      source: data.source || null,
      event_key: eventKey,
      label: ev.label || eventKey,
      sale: ev.sale || null,
      items: ev.items || []
    };
  } catch (e) {
    return { error: 'getHpKnowledge の実行中にエラーが発生しました: ' + e.message };
  }
}

/**
 * 差分行データについて Gemini API に問い合わせを行う
 * @param {{ rows?: Array<Object>, question?: string }} payload
 * @return {{ text?: string, error?: string, truncated?: boolean, truncated_message?: string }}
 */
function askGemini(payload) {
  try {
    var props = PropertiesService.getScriptProperties();
    var apiKey = props.getProperty('GEMINI_API_KEY');
    if (!apiKey || !apiKey.trim()) {
      return { error: 'GEMINI_API_KEY が未設定です' };
    }
    apiKey = apiKey.trim();

    payload = payload || {};
    var rows = payload.rows;
    var question = payload.question || '';

    // 配列以外の入力へのフォールバック
    if (!Array.isArray(rows)) {
      rows = [];
    }

    // サーバー側上限: 最大200行に制限
    var maxRows = 200;
    var originalRowCount = rows.length;
    var isTruncated = false;
    var targetRows = rows;
    if (originalRowCount > maxRows) {
      targetRows = rows.slice(0, maxRows);
      isTruncated = true;
    }

    var model = props.getProperty('GEMINI_MODEL');
    if (!model || !model.trim()) {
      model = 'gemini-2.5-flash';
    } else {
      model = model.trim();
    }

    var promptLines = [];
    promptLines.push('あなたはチケット料金・販売期間等の突合チェックを支援するAIアシスタントです。');
    promptLines.push('提供された差分データを確認し、ユーザーの質問や指示に対して分かりやすく回答してください。');
    promptLines.push('');

    if (isTruncated) {
      promptLines.push('【注意】差分行数が多いため、先頭 ' + maxRows + ' 行（全 ' + originalRowCount + ' 行中）のみを対象としています。');
      promptLines.push('');
    }

    if (question && question.trim()) {
      promptLines.push('【ユーザーの質問・指示】');
      promptLines.push(question.trim());
      promptLines.push('');
    } else {
      promptLines.push('【ユーザーの質問・指示】');
      promptLines.push('差分行データの内容を確認し、不整合や特筆すべき点、備考の差異などを要約・解説してください。');
      promptLines.push('');
    }

    promptLines.push('【対象の差分行データ (JSON)】');
    promptLines.push(JSON.stringify(targetRows, null, 2));

    var fullPrompt = promptLines.join('\n');

    // URL組み立て: 文字列リテラル内に // を含めないよう String.fromCharCode(47) を使用
    var S = String.fromCharCode(47);
    var url = 'https:' + S + S + 'generativelanguage.googleapis.com' + S + 'v1beta' + S + 'models' + S + encodeURIComponent(model) + ':generateContent';

    var requestPayload = {
      contents: [
        {
          parts: [
            {
              text: fullPrompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2
      }
    };

    var fetchOptions = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-goog-api-key': apiKey
      },
      payload: JSON.stringify(requestPayload),
      muteHttpExceptions: true
    };

    var response;
    try {
      response = UrlFetchApp.fetch(url, fetchOptions);
    } catch (fetchErr) {
      return { error: 'Gemini API 呼び出し中に通信エラーが発生しました: ' + fetchErr.message };
    }

    var statusCode = response.getResponseCode();
    var responseBody = response.getContentText();

    if (statusCode !== 200) {
      var errorMsg = 'Gemini API エラー (HTTP ' + statusCode + ')';
      try {
        var errJson = JSON.parse(responseBody);
        if (errJson.error && errJson.error.message) {
          errorMsg += ': ' + errJson.error.message;
        } else {
          errorMsg += ': ' + responseBody;
        }
      } catch (_) {
        errorMsg += ': ' + responseBody;
      }
      return { error: errorMsg };
    }

    var resJson;
    try {
      resJson = JSON.parse(responseBody);
    } catch (parseErr) {
      return { error: 'Gemini API レスポンスのJSON解析に失敗しました: ' + parseErr.message };
    }

    var generatedText = '';
    if (resJson.candidates && resJson.candidates.length > 0) {
      var candidate = resJson.candidates[0];
      if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
        var textParts = [];
        for (var p = 0; p < candidate.content.parts.length; p++) {
          if (candidate.content.parts[p].text) {
            textParts.push(candidate.content.parts[p].text);
          }
        }
        generatedText = textParts.join('');
      } else if (candidate.finishReason) {
        return { error: 'Gemini API からテキストが返されませんでした (finishReason: ' + candidate.finishReason + ')' };
      }
    } else if (resJson.promptFeedback && resJson.promptFeedback.blockReason) {
      return { error: 'プロンプトがブロックされました (blockReason: ' + resJson.promptFeedback.blockReason + ')' };
    } else {
      return { error: 'Gemini API の応答に候補 (candidates) が見つかりませんでした' };
    }

    var result = {
      text: generatedText
    };

    if (isTruncated) {
      result.truncated = true;
      result.truncated_message = '行数が上限（' + maxRows + '行）を超過したため、先頭' + maxRows + '行のみを対象としました（全' + originalRowCount + '行）。';
    }

    return result;
  } catch (e) {
    return { error: 'askGemini の実行中にエラーが発生しました: ' + e.message };
  }
}

var DEFAULT_HP_KNOWLEDGE_FILE_ID = '1kJ-2JnSVOH56wBc_6-nt8Midqmx07ACg';

/**
 * 管理者本人限定の実行権限ガード
 */
function assertAdminUser_() {
  var activeUser = Session.getActiveUser().getEmail();
  var effectiveUser = Session.getEffectiveUser().getEmail();
  if (activeUser && effectiveUser && activeUser !== effectiveUser) {
    throw new Error('管理者本人以外はこの操作を実行できません (active: ' + activeUser + ', effective: ' + effectiveUser + ')');
  }
}

/**
 * 指定されたファイルIDの存在とスキーマを検証してからプロパティに保存する内部処理
 * @param {string} fileId
 * @return {string} 実行結果
 */
function setupHpKnowledgeWithId_(fileId) {
  assertAdminUser_();

  if (!fileId || typeof fileId !== 'string' || !fileId.trim()) {
    throw new Error('有効な fileId を指定してください');
  }
  fileId = fileId.trim();

  /* 1. Drive ファイルの存在確認 */
  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (e) {
    throw new Error('Driveファイルが見つかりません (ID: ' + fileId + '): ' + e.message);
  }
  if (!file) {
    throw new Error('Driveファイルが見つかりません (ID: ' + fileId + ')');
  }

  try {
    if (file.isTrashed && file.isTrashed()) {
      throw new Error('指定されたファイルはゴミ箱にあります (ID: ' + fileId + ')');
    }
  } catch (_) {}

  /* 2. ファイル読み取りとスキーマ検証 */
  var content;
  try {
    content = file.getBlob().getDataAsString('UTF-8');
  } catch (e) {
    throw new Error('ナレッジファイルの読み取りに失敗しました: ' + e.message);
  }
  if (!content || !content.trim()) {
    throw new Error('ナレッジファイルが空です');
  }

  var data;
  try {
    data = JSON.parse(content);
  } catch (e) {
    throw new Error('ナレッジJSONの解析に失敗しました: ' + e.message);
  }

  if (!data || typeof data !== 'object') {
    throw new Error('ナレッジデータの形式が不正です（オブジェクトではありません）');
  }
  if (data.schema !== 'hp_price_knowledge/1') {
    throw new Error('未対応のスキーマです (期待値: hp_price_knowledge/1, 実際: ' + (data.schema || 'なし') + ')');
  }
  if (!data.events || typeof data.events !== 'object') {
    throw new Error('ナレッジデータに events オブジェクトが存在しません');
  }

  /* 3. 検証成功時のみスクリプトプロパティを保存 */
  PropertiesService.getScriptProperties().setProperty('HP_KNOWLEDGE_FILE_ID', fileId);
  return 'HP_KNOWLEDGE_FILE_ID を正常に設定しました (ID: ' + fileId + ', schema: ' + data.schema + ', built_at: ' + (data.built_at || '不明') + ')';
}

/**
 * HP_KNOWLEDGE_FILE_ID を既定の固定IDでセットアップする（引数なし・エディタ実行用）
 * GASエディタの「実行」ボタンから引数なしで直接呼び出し可能。
 * スキーマ読み取りを検証してからプロパティを保存する。管理者本人限定。
 * @return {string} 実行結果
 */
function setupHpKnowledgeDefault() {
  return setupHpKnowledgeWithId_(DEFAULT_HP_KNOWLEDGE_FILE_ID);
}

/**
 * HP_KNOWLEDGE_FILE_ID を設定する（任意のfileId指定用）
 * スキーマ読み取りを検証してからプロパティを保存する。管理者本人限定。
 * @param {string} fileId Google Drive 上の HP料金ナレッジ.json のファイルID
 * @return {string} 実行結果
 */
function setHpKnowledgeFileId(fileId) {
  return setupHpKnowledgeWithId_(fileId);
}

/**
 * HPナレッジの接続状態を確認する（管理者診断用）
 * @return {Object} 状態情報
 */
function getHpKnowledgeStatus() {
  var props = PropertiesService.getScriptProperties();
  var fileId = props.getProperty('HP_KNOWLEDGE_FILE_ID') || DEFAULT_HP_KNOWLEDGE_FILE_ID;
  if (!fileId) {
    return { configured: false, error: 'HP_KNOWLEDGE_FILE_ID が未設定です' };
  }
  var res = loadHpKnowledgeData_();
  if (res.error) {
    return { configured: true, fileId: fileId, error: res.error };
  }
  var events = listHpEvents();
  return {
    configured: true,
    fileId: fileId,
    schema: res.data.schema,
    built_at: res.data.built_at,
    events: events
  };
}

