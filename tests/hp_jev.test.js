const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const gas = fs.readFileSync(path.join(root, 'gas', 'HpCheck.gs'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let pass = 0;
function ok(cond, msg) {
  assert(cond, msg);
  pass++;
}

function server(status, body) {
  let request;
  const sandbox = {
    Date, JSON, Number, String, Array, Object, Error, isFinite, isNaN, Math,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'mock-key' }) },
    UrlFetchApp: { fetch: (url, options) => {
      request = { url, options, body: JSON.parse(options.payload) };
      return { getResponseCode: () => status, getContentText: () => typeof body === 'string' ? body : JSON.stringify(body) };
    } }
  };
  vm.runInNewContext(gas, sandbox);
  return { call: sandbox.reviewHpWithJev, testConnection: sandbox.testJevConnection, request: () => request };
}

const rows = [{ id: 1, '現行の備考': 'A' }, { id: 2, '現行の備考': 'B' }];
const results = [{ id: 1, '判定': '要修正', '修正案': 'A1' }, { id: 2, '判定': '問題なし', '修正案': '' }];
const payload = { rows, results, context: { P: ['HP原文'] } };

// 1. 正常系呼び出しと信頼できない入力に関する指示の検証
const s = server(200, { model: 'typesafe/jev-1.13-20260917', answers: {
  row_1: { type: 'noul', noul: 0.98 }, row_2: { type: 'noul', noul: 0.4 }
}, usage: { cost: 0.00002 } });
const good = s.call(payload);
assert.strictEqual(good.scores[1], 0.98);
assert.strictEqual(good.scores[2], 0.4);
assert.strictEqual(good.cost_usd, 0.00002);
pass++;

assert(s.request().url.endsWith('/api/alpha/decisions'));
assert.strictEqual(s.request().body.model, 'typesafe/jev-1.13');
assert(s.request().body.questions.row_1.instructions.includes('ID 1'));
// 残余要件1: Jevに対し、入力データは信頼できない外部入力であり、埋め込まれた指示を無視するよう指示していること
const instr = s.request().body.questions.row_1.instructions;
ok(instr.includes('信頼できない') && instr.includes('無視'), 'プロンプトインジェクション防御の明示');
assert(!JSON.stringify(s.request().body).includes('mock-key'), 'キーがリクエストボディに漏洩しない');
pass++;

// エラー系
assert(server(429, { error: 'rate limited' }).call(payload).error.includes('429'));
assert(server(200, '{not json').call(payload).error);
assert(server(200, { answers: {} }).call({ ...payload, results: [results[0], results[0]] }).error, '重複IDを拒否');
pass++;

// 2. 残余要件2: 厳格な数値検証（真偽値/文字列/null/NaNの型強制を禁止）
const malformedAnswers = server(200, {
  answers: {
    row_1: { type: 'noul', noul: true },       // boolean true -> 1 への型強制を拒絶
    row_2: { type: 'noul', noul: '0.95' },     // string "0.95" -> 0.95 への型強制を拒絶
    row_3: { type: 'noul', noul: false },      // boolean false -> 0 への型強制を拒絶
    row_4: { type: 'noul', noul: null },       // null -> 0 への型強制を拒絶
    row_5: { type: 'noul', noul: NaN },        // NaN 拒絶
    row_6: { type: 'noul', noul: -0.1 },       // 範囲外 拒絶
    row_7: { type: 'noul', noul: 1.1 }         // 範囲外 拒絶
  },
  usage: { cost: true }                        // boolean cost -> 1 への型強制を拒絶
}).call({
  rows: [{ id: 1 }, { id: 2 }],
  results: [{ id: 1, 判定: '問題なし' }, { id: 2, 判定: '問題なし' }],
  context: { P: ['HP原文'] }
});
ok(Object.keys(malformedAnswers.scores).length === 0, '不正な確率値型はすべて拒絶');
ok(malformedAnswers.cost_usd === null, '真偽値の料金はnullとなり0や1へ型強制されない');

const stringCostRes = server(200, {
  answers: { row_1: { type: 'noul', noul: 0.9 } },
  usage: { cost: '0.005' }                     // string cost 拒絶
}).call({
  rows: [{ id: 1 }],
  results: [{ id: 1, 判定: '問題なし' }],
  context: { P: ['HP原文'] }
});
ok(stringCostRes.cost_usd === null, '文字列の料金はnullとなり型強制されない');

// 3. 残余要件4: Jev接続テスト（固定の合成フィクスチャ4件、1回のAPI呼び出し、キー非露出）
const connMock = server(200, {
  model: 'typesafe/jev-1.13',
  answers: {
    row_1: { type: 'noul', noul: 0.95 }, // 根拠合致 -> pass
    row_2: { type: 'noul', noul: 0.2 },  // 価格不一致 -> needs-review
    row_3: { type: 'noul', noul: 0.1 },  // 日付不一致 -> needs-review
    row_4: { type: 'noul', noul: 0.0 }   // 根拠欠落 -> needs-review
  },
  usage: { cost: 0.00004 }
});
const connResult = connMock.testConnection();
ok(connResult.success === true, '接続テスト成功');
ok(connResult.verdict === 'pass', '合成フィクスチャの期待値と一致');
ok(Array.isArray(connResult.cases) && connResult.cases.length === 4, '4件の固定フィクスチャ');
ok(connResult.cases[0].expected === 'pass' && connResult.cases[0].verdict === 'pass', 'ケース1: 根拠合致');
ok(connResult.cases[1].expected === 'needs-review' && connResult.cases[1].verdict === 'needs-review', 'ケース2: 価格不一致');
ok(connResult.cases[2].expected === 'needs-review' && connResult.cases[2].verdict === 'needs-review', 'ケース3: 日付不一致');
ok(connResult.cases[3].expected === 'needs-review' && connResult.cases[3].verdict === 'needs-review', 'ケース4: 根拠欠落');
ok(typeof connResult.elapsed_ms === 'number' && connResult.elapsed_ms >= 0, '所要時間を計測');
ok(connResult.cost_usd === 0.00004, '費用を取得');
ok(!JSON.stringify(connResult).includes('mock-key'), 'APIキーが返却値に露出しない');
ok(connMock.request().url.endsWith('/api/alpha/decisions'), 'Decisions APIを1回呼び出し');
ok(connMock.request().body.questions.row_1.instructions.includes('信頼できない'), 'テストフィクスチャでもuntrusted data指示');

// 接続テスト: サーバーエラー時
const connErr = server(500, { error: { message: 'Internal Server Error' } }).testConnection();
ok(connErr.error && connErr.error.includes('500'), 'APIエラー時はエラーを返す');

// 4. 画面側の分割・並行数・検証ロジックを抽出して検証
const a = html.indexOf('function hpResultCoverage(');
const b = html.indexOf('// ===HP_AI_VIEW_START===', a);
assert(a > 0 && b > a);

let active = 0, peak = 0, calls = [];
let mockJevCost = 0.001, mockJevFail = false;
const hpCallServer = async (name, arg) => {
  active++; peak = Math.max(peak, active); calls.push(name);
  await new Promise((resolve) => setTimeout(resolve, 2));
  active--;
  if (name === 'askGemini') {
    return {
      text: JSON.stringify({ results: arg.rows.map(r => ({ id: r.id, '判定': '問題なし', 'HP根拠': [] })) }),
      model: 'anthropic/claude-haiku-5.5',
      usage: { input: 1, output: 1 },
      cost_usd: 0.01
    };
  }
  if (name === 'reviewHpWithJev') {
    if (mockJevFail) return { error: 'Jev connection failed (HTTP 500)' };
    return {
      scores: Object.fromEntries(arg.rows.map(r => [r.id, 0.99])),
      model: 'typesafe/jev-1.13',
      cost_usd: mockJevCost,
      elapsed_ms: 2
    };
  }
};

const escHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const funcs = new Function('hpCallServer', 'hpBuildContext', 'escHtml', html.slice(a, b) + ';return { hpAskAi, hpResultCoverage, hpReviewSummary };')(
  hpCallServer, () => ({ P: ['HP原文'] }), escHtml
);

// hpResultCoverage の検証
assert.strictEqual(funcs.hpResultCoverage(rows, { results: [results[0], results[0]] }), false);
assert.strictEqual(funcs.hpResultCoverage(rows, { results: [results[0]] }), false);
assert.strictEqual(funcs.hpResultCoverage(rows, { results }), true);
pass++;

(async () => {
  // 並行数・バッチ分割検証
  const many = Array.from({ length: 49 }, (_, i) => ({ id: i + 1 }));
  const answer = await funcs.hpAskAi(many, 'question', {}, 'anthropic/claude-haiku-5.5');
  ok(peak <= 3, `通信上限: ${peak}`);
  ok(calls.filter(x => x === 'reviewHpWithJev').length === 5, '49件が12件ずつ5分割');
  ok(JSON.parse(answer.text).results.length === 49, '49件全件の回答');
  ok(Object.keys(answer.review.scores).length === 49, '49件全件のスコア');
  ok(answer.review.cost_status === 'known', '全件成功時の料金ステータスはknown');
  ok(answer.cost_usd === 0.05 + 0.005, '1次生成とJevの合算料金');
  ok(answer.gen_cost_usd === 0.05, '1次生成料金が分離保持されている');
  ok(answer.review_cost_usd === 0.005, 'Jev料金が分離保持されている');

  // 5. 残余要件2: 料金不明時の検証（決して$0と偽らず、不明または一部と表示し、既知分を分離保持）
  mockJevCost = null; // Jev利用料がnull
  const answerUnknownCost = await funcs.hpAskAi([{ id: 1 }], 'question', {}, 'anthropic/claude-haiku-5.5');
  ok(answerUnknownCost.review.cost_status === 'unknown', 'Jev費用がnullのときはunknown');
  ok(answerUnknownCost.review.cost_usd === null, 'review.cost_usd は null（0ではない）');
  ok(answerUnknownCost.cost_usd === null, '合計 cost_usd は null（0と誤認させない）');
  ok(answerUnknownCost.gen_cost_usd === 0.01, '既知の生成料金は分離保持');

  // hpReviewSummary の表示検証（$0.00000 と誤認表示しない）
  const summaryUnknown = funcs.hpReviewSummary(answerUnknownCost.review, 1);
  ok(summaryUnknown.includes('Jev料金: 不明'), 'Jev料金不明と表示');
  ok(!summaryUnknown.includes('$0.00000'), '$0.00000と表示しない');

  const summaryPartial = funcs.hpReviewSummary({ scores: { 1: 0.9 }, cost_status: 'partial', cost_usd: 0.0001, model: 'typesafe/jev-1.13' }, 2);
  ok(summaryPartial.includes('一部不明') && summaryPartial.includes('$0.00010'), '一部判明分と表示');

  // 6. 残余要件5: Jev失敗/非対応時でもHaikuの回答は保持しつつ「要確認」とし、自動合格にしない
  mockJevFail = true;
  const answerFailedJev = await funcs.hpAskAi([{ id: 1 }], 'question', {}, 'anthropic/claude-haiku-5.5');
  ok(answerFailedJev.text && JSON.parse(answerFailedJev.text).results.length === 1, 'Haiku出力は保持される');
  ok(Object.keys(answerFailedJev.review.scores).length === 0, 'Jev失敗時はスコア空');
  ok(answerFailedJev.review.errors.length > 0, 'Jevエラーが記録される');
  ok(answerFailedJev.review.cost_status === 'unknown', '失敗時のJev費用はunknown');

  // 7. 表示ブロック（===HP_AI_VIEW_START=== から ===HP_AI_VIEW_END===）を取り出して描画とフェイルクローズ・文言を検証
  const viewStart = html.indexOf('// ===HP_AI_VIEW_START===');
  const viewEnd = html.indexOf('// 縦書きヘッダー切り替え');
  const viewFuncs = new Function('escHtml', html.slice(viewStart, viewEnd) + ';return { hpRenderAiResult };')(escHtml);

  // Jev審査未完 / スコアなし時は、Haikuが「問題なし」と判定していても「要確認」になること（フェイルクローズ）
  const haikuPass = { results: [{ id: 1, '判定': '問題なし', '修正案': '', 'HP根拠': [{ 'ページ': 'P', '記載': '文' }] }] };
  const picked1 = [{ level: 'ai', note: '文', seats: ['S'], row: { _count: 1, _row: 0 } }];
  const ctx = { P: ['文'] };

  const renderedWithoutJev = viewFuncs.hpRenderAiResult(haikuPass, picked1, '', ctx, {}, answerFailedJev.review);
  ok(renderedWithoutJev.includes('要確認'), 'Jev失敗時は要確認として分類');
  ok(!renderedWithoutJev.includes('問題なし 1件を表示'), '自動合格させない');

  // 残余要件3: HPに記載なしの文言検証（提供根拠に記載なし・要確認であり、HP全体に記載なしと断定しない）
  const haikuMissing = { results: [{ id: 1, '判定': 'HPに記載なし', '修正案': '', 'HP根拠': [] }] };
  const renderedMissing = viewFuncs.hpRenderAiResult(haikuMissing, picked1, '', ctx, {}, { scores: { 1: 0.5 } });
  ok(renderedMissing.includes('提示根拠に記載なし（要確認）'), '提供根拠に記載なし（要確認）のフラグ表示');
  ok(renderedMissing.includes('提示された抜粋内に記載なし・要確認'), '抜粋内での未確認である旨を明記');
  ok(!renderedMissing.includes('<th>記載なし</th>') && !renderedMissing.includes('<div>記載なし</div>'), 'HP全体に記載なしと断定する表現を排除');

  console.log(`hp_jev: ${pass} passed, 0 failed`);
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
