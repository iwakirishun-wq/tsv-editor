/**
 * hp_ai_view.test.js — AI照合の精度補助（事実の抽出・機械差分・抜粋の絞り込み）と、結果表の描画
 * index.html の ===HP_AI_VIEW_START=== 〜 ===HP_AI_VIEW_END=== と hpRenderAiResult を取り出して検証する。
 * 実行: node tests/hp_ai_view.test.js
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const a = html.indexOf("// ===HP_AI_VIEW_START===");
const b = html.indexOf("// 縦書きヘッダー切り替え");
assert(a > 0 && b > a, "表示ブロックが見つからない");
const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f = new Function("escHtml", html.slice(a, b) + ";return {hpFacts,hpFactDiff,hpSelectLines,hpBuildContext,hpDiffCols,hpQuoteHtml,hpQuoteVerified,hpRenderAiResult};")(escHtml);

let pass = 0;
const eq = (x, y, m) => { assert.strictEqual(JSON.stringify(x), JSON.stringify(y), m); pass++; };
const ok = (c, m) => { assert(c, m); pass++; };

// --- 事実の抽出 ---
eq(f.hpFacts("※4/9(金)0:00~11(日)23:59有効").dates, ["4/9", "4/10", "4/11"], "日付の範囲を展開");
eq(f.hpFacts("※4/9(金)0:00~11(日)23:59有効").times.sort(), ["0:00", "23:59"]);
eq(f.hpFacts("ナイトパスは8月10日(土)〜8月12日(月・祝)の3日間有効です。").dates, ["8/10", "8/11", "8/12"], "月日の表記・全角波線");
eq(f.hpFacts("ナイトパスは8月10日(土)〜8月12日(月・祝)の3日間有効です。").days, ["3日間"]);
eq(f.hpFacts("入場は17:00以降／19時から").times.sort(), ["17:00", "19:00"], "N時とHH:MMを同じ形に");
eq(f.hpFacts("大人 5,500円 / 子ども 2500円").amounts, ["5500", "2500"], "金額の桁区切り");
eq(f.hpFacts("４／９").dates, ["4/9"], "全角数字");
eq(f.hpFacts("4/9 19:00~21:00開催").dates, ["4/9"], "時刻の終わりを日付と取り違えない");

// --- 機械差分 ---
eq(f.hpFactDiff("※4/8(木)~11(日)有効", ["●チケットは4月9日(金)~11日(日)の3日間通し券です。"]), ["日付 4/8"], "HPに無い日付だけ");
eq(f.hpFactDiff("※4/9(金)~11(日)有効", ["●チケットは4月9日(金)~11日(日)の3日間通し券です。"]), [], "一致なら空");
eq(f.hpFactDiff("19時以降入場可", ["入場できるのは17:00以降です。"]), ["時刻 19:00"], "時刻の食い違い");
eq(f.hpFactDiff("17時以降入場可", ["入場できるのは17:00以降です。"]), [], "表記違いは差にしない");
eq(f.hpFactDiff("有効期間 0:00~23:59", ["入場は終日"]), [], "期間の端の0:00/23:59は数えない");
eq(f.hpFactDiff("1台2,000円", ["駐車券は1台1日1,500円です。"]), ["金額 2,000円"]);
eq(f.hpFactDiff("2日間有効", ["3日間有効です"]), ["日数 2日間"]);

// --- 抜粋の絞り込み ---
const lines = Array.from({ length: 60 }, (_, i) => "無関係な案内文その" + i + "です。ご来場をお待ちしております。");
lines[17] = "駐車券は1台1日1,500円です。普通車のみ。";
lines[42] = "駐車場の入退場は各日15:00~19:00制限があります。";
const sel = f.hpSelectLines(lines, ["1台1日1,500円 普通車のみ 各日15:00~19:00退出不可"], 6);
eq(sel.length, 6);
ok(sel.includes(lines[17]) && sel.includes(lines[42]), "関連行が残る");
eq(f.hpSelectLines(["a", "b"], ["x"], 6), ["a", "b"], "少なければそのまま");
const ctx = f.hpBuildContext([{ "HPページ": ["P1"], "現行の備考": "1台1日1,500円" }], { P1: { lines }, P2: { lines } }, 6);
eq(Object.keys(ctx), ["P1"], "行が参照するページだけ");

// --- 差分の列 ---
let d = f.hpDiffCols("※4/8(木)~11(日)有効<br>※座席指定は金~日3日間有効", "※4/9(金)~11(日)有効<br>※座席指定は金~日3日間有効");
ok(d.left.includes("line-through") && d.left.includes("8(木"), "消える所に取り消し線");
ok(d.right.includes("#a8e6a8") && d.right.includes("9(金"), "入る所は緑");
ok(d.left.includes("他1行 同じ") && d.right.includes("他1行 同じ"), "同じ行はたたむ");
d = f.hpDiffCols("", "※新しい備考");
ok(d.leftEmpty && d.right.includes("※新しい備考"), "現行が空");

// --- 引用 ---
ok(f.hpQuoteHtml("3日間通し券です", "存在しない", ["※3日間通し券"]).includes("<mark"), "強調が無ければ共通部分");
ok(!f.hpQuoteHtml("<img src=x onerror=1>", "", []).includes("<img"), "エスケープ");
eq(f.hpQuoteVerified("駐車券は1台1日1,500円です。", "P2", { P2: ["駐車券は1台1日1,500円です。普通車のみ。"] }), true);
eq(f.hpQuoteVerified("存在しない文", "P2", { P2: ["駐車券は1台1日1,500円です。"] }), false);

// --- 描画 ---
const cur = "※4/8(木)~11(日)有効<br>※座席指定は金~日3日間有効";
const fix = "※4/9(金)~11(日)有効<br>※座席指定は金~日3日間有効";
const ctxFull = { T: ["●チケットは4月9日(金)~11日(日)の3日間通し券です。"] };
const picked = [
  { level: "ai", note: cur, seats: ["A1-1観戦券[T0]"], row: { _count: 2, _row: 2534 } },
  { level: "ai", note: "19時以降入場可", seats: ["X席"], row: { _count: 1, _row: 10 } },
  { level: "ai", note: "旧備考", seats: ["Y席"], row: { _count: 1, _row: 20 } },
];
const parsed = { results: [
  { id: 1, "判定": "要修正", "分類": "有効期間", "修正案": fix, "HP根拠": [{ "ページ": "T", "記載": "●チケットは4月9日(金)~11日(日)の3日間通し券です。", "強調": "4月9日(金)~11日(日)の3日間通し券" }] },
  { id: 2, "判定": "問題なし", "分類": "一致", "修正案": "", "HP根拠": [] },
  { id: 3, "判定": "HPに記載なし", "分類": "HPに根拠なし", "修正案": "", "HP根拠": [{ "ページ": "T", "記載": "HPにこんな文は無い", "強調": "" }] },
] };
const out = f.hpRenderAiResult(parsed, picked, "", ctxFull, { 2: ["時刻 19:00"] });
ok(out.includes("修正箇所") && out.includes("変更案") && out.includes("HP根拠"), "列名");
ok(!out.includes("理由") && !out.includes("指摘の内訳"), "説明文を出さない");
ok(out.includes("<mark"), "HP根拠の強調");
ok(out.includes("⚠原文に無い"), "原文に無い引用の警告");
ok(out.includes("HPに無い: 時刻 19:00"), "機械差分の警告（問題なし判定でも）");
ok(out.includes('data-tag="有効期間"') && out.includes("_hp-tag"), "分類の絞り込み");
ok(out.includes("行 2535 ×2"), "行番号");
ok(out.includes("要確認") && !out.includes("問題なし 1件を表示"), "審査未完なら問題なしと表示しない");
const reviewed = f.hpRenderAiResult(parsed, picked, "", ctxFull, {}, { scores: { 1: 0.97, 2: 0.99, 3: 0.99 } });
ok(reviewed.includes("Jev確認 97%"), "根拠がある高確率の行だけ審査済み表示");
ok(reviewed.includes("⚠原文に無い") && reviewed.includes("要確認"), "高確率でも引用不存在は要確認");
const low = f.hpRenderAiResult(parsed, picked, "", ctxFull, {}, { scores: { 1: 0.89 } });
ok(!low.includes("Jev確認 89%"), "暫定閾値未満は要確認");

console.log("hp_ai_view: " + pass + " passed, 0 failed");
