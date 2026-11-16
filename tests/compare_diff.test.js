"use strict";

const assert = require("assert");
const {
  compareTables,
  charDiff,
  parseTsvForCompare,
  buildHtmlReport
} = require("../compare_parts/compare_engine.js");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    console.error("FAIL:", name);
    console.error(err && err.stack ? err.stack : err);
  }
}

// 1. parseTsvForCompare: BOM, quotes, embedded newlines, escaped quotes, padding
test("parseTsvForCompare: BOM・クォート・セル内改行・エスケープ・列埋め", () => {
  const raw =
    '\uFEFFcol1\tcol2\tcol3\r\n' +
    '"a\nb"\t"c""d"\t100\r\n' +
    'x\ty\n' +
    'p\tq\tr\ts\n';
  const parsed = parseTsvForCompare(raw);
  assert.deepStrictEqual(parsed.headers, ["col1", "col2", "col3", ""]);
  assert.strictEqual(parsed.rows.length, 3);
  assert.deepStrictEqual(parsed.rows[0], ["a\nb", 'c"d', "100", ""]);
  assert.deepStrictEqual(parsed.rows[1], ["x", "y", "", ""]);
  assert.deepStrictEqual(parsed.rows[2], ["p", "q", "r", "s"]);
});

// 2. Empty TSV & header-only TSV
test("parseTsvForCompare & compareTables: 空TSV・ヘッダーのみ", () => {
  const empty = parseTsvForCompare("");
  assert.deepStrictEqual(empty, { headers: [], rows: [] });

  const headerOnly = parseTsvForCompare("a\tb\n");
  assert.deepStrictEqual(headerOnly, { headers: ["a", "b"], rows: [] });

  const res = compareTables(empty, headerOnly);
  assert.strictEqual(res.counts.added, 0);
  assert.strictEqual(res.counts.removed, 0);
  assert.strictEqual(res.counts.changed, 0);
  assert.strictEqual(res.counts.same, 0);
  assert.deepStrictEqual(
    res.addedCols.map((c) => c.header),
    ["a", "b"]
  );
});

// 3. Key auto-detection: candidate 1 (tenant_cd, club_cd, seat_type_area_cd)
test("compareTables: キー自動検出(英語3列)", () => {
  const base = parseTsvForCompare(
    "tenant_cd\tclub_cd\tseat_type_area_cd\tname\n" +
      "T1\tC1\tA01\t指定席A\n" +
      "T1\tC1\tA02\t自由席\n"
  );
  const cur = parseTsvForCompare(
    "tenant_cd\tclub_cd\tseat_type_area_cd\tname\n" +
      "T1\tC1\tA02\t自由席\n" +
      "T1\tC1\tA01\t指定席S\n"
  );
  const res = compareTables(base, cur);
  assert.strictEqual(res.positional, false);
  assert.deepStrictEqual(res.keyCols, [
    "tenant_cd",
    "club_cd",
    "seat_type_area_cd"
  ]);
  assert.strictEqual(res.counts.changed, 1);
  assert.strictEqual(res.counts.same, 1);
  const changedRow = res.rows.find((r) => r.status === "changed");
  assert.strictEqual(changedRow.key, "T1 / C1 / A01");
  assert.strictEqual(changedRow.baseRowNo, 1);
  assert.strictEqual(changedRow.curRowNo, 2);
});

// 4. Key auto-detection: Japanese 7-col candidate vs 3-col vs 1-col
test("compareTables: キー自動検出(日本語7列/3列/1列)", () => {
  const h7 =
    "席種エリアコード\t券種コード\t販売価格区分\t会員ランク区分\t販売経路区分\tアップグレード元席種エリアコード\tアップグレード元券種コード\t価格";
  const r7 = compareTables(
    parseTsvForCompare(h7 + "\n01\t02\t1\t0\t1\t\t\t1000"),
    parseTsvForCompare(h7 + "\n01\t02\t1\t0\t1\t\t\t1200")
  );
  assert.strictEqual(r7.keyCols.length, 7);
  assert.strictEqual(r7.counts.changed, 1);

  const h3 = "席種エリアコード\t券種コード\t販売価格区分\t価格";
  const r3 = compareTables(
    parseTsvForCompare(h3 + "\n01\t02\t1\t1000"),
    parseTsvForCompare(h3 + "\n01\t02\t1\t1000")
  );
  assert.deepStrictEqual(r3.keyCols, [
    "席種エリアコード",
    "券種コード",
    "販売価格区分"
  ]);
  assert.strictEqual(r3.counts.same, 1);

  const h1 = "席種エリアコード\t名称";
  const r1 = compareTables(
    parseTsvForCompare(h1 + "\n01\tA"),
    parseTsvForCompare(h1 + "\n01\tB")
  );
  assert.deepStrictEqual(r1.keyCols, ["席種エリアコード"]);
  assert.strictEqual(r1.counts.changed, 1);
});

// 5. Row add / remove / change & byColumn
test("compareTables: 行追加・削除・変更と列別変更件数", () => {
  const base = parseTsvForCompare(
    "seat_type_area_cd\tname\tprice\n" +
      "A1\tArea1\t1000\n" +
      "A2\tArea2\t2000\n" +
      "A3\tArea3\t3000\n"
  );
  const cur = parseTsvForCompare(
    "seat_type_area_cd\tname\tprice\n" +
      "A1\tArea1_new\t1500\n" +
      "A3\tArea3\t3500\n" +
      "A4\tArea4\t4000\n"
  );
  const res = compareTables(base, cur);
  assert.deepStrictEqual(res.counts, {
    added: 1,
    removed: 1,
    changed: 2,
    same: 0
  });
  assert.deepStrictEqual(res.byColumn, [
    { header: "price", n: 2 },
    { header: "name", n: 1 }
  ]);
  const added = res.rows.find((r) => r.status === "added");
  assert.strictEqual(added.baseRowNo, null);
  assert.strictEqual(added.curRowNo, 3);
  assert.strictEqual(added.cells[0].before, null);
  assert.strictEqual(added.cells[1].after, "Area4");

  const removed = res.rows.find((r) => r.status === "removed");
  assert.strictEqual(removed.baseRowNo, 2);
  assert.strictEqual(removed.curRowNo, null);
  assert.strictEqual(removed.cells[0].after, null);
  assert.strictEqual(removed.cells[1].before, "Area2");
});

// 6. Column add / remove & duplicate header names
test("compareTables: 列追加・削除・同名重複列", () => {
  const base = parseTsvForCompare(
    "seat_type_area_cd\tnote\told_col\tnote\n" +
      "A1\tfirst\told\tsecond\n"
  );
  const cur = parseTsvForCompare(
    "seat_type_area_cd\tnote\tnote\tnew_col\n" +
      "A1\tfirst\tsecond_mod\tnew\n"
  );
  const res = compareTables(base, cur);
  assert.deepStrictEqual(
    res.removedCols.map((c) => c.header),
    ["old_col"]
  );
  assert.deepStrictEqual(
    res.addedCols.map((c) => c.header),
    ["new_col"]
  );
  assert.deepStrictEqual(
    res.commonCols.map((c) => c.header),
    ["seat_type_area_cd", "note", "note (2)"]
  );
  assert.strictEqual(res.counts.changed, 1);
  assert.deepStrictEqual(res.byColumn, [{ header: "note (2)", n: 1 }]);
});

// 7. Audit columns ignored by default & overrideable
test("compareTables: 監査列の既定無視と上書き", () => {
  const base = parseTsvForCompare(
    "seat_type_area_cd\tname\tcreate_dt\tupdate_dt\tcreate_user\tupdate_user\n" +
      "A1\tArea1\t2025-01-01\t2025-01-01\tu1\tu1\n"
  );
  const cur = parseTsvForCompare(
    "seat_type_area_cd\tname\tcreate_dt\tupdate_dt\tcreate_user\tupdate_user\n" +
      "A1\tArea1\t2026-01-01\t2026-01-02\tu2\tu2\n"
  );
  const resDefault = compareTables(base, cur);
  assert.strictEqual(resDefault.counts.same, 1);
  assert.strictEqual(resDefault.counts.changed, 0);

  const resOverride = compareTables(base, cur, { ignoreColumns: [] });
  assert.strictEqual(resOverride.counts.changed, 1);
  assert.strictEqual(resOverride.byColumn.length, 4);
});

// 8. Duplicate keys matched in occurrence order
test("compareTables: 重複キーの出現順突合とdupKeysカウント", () => {
  const base = parseTsvForCompare(
    "seat_type_area_cd\tval\n" +
      "A1\tv1\n" +
      "A1\tv2\n" +
      "A1\tv3\n"
  );
  const cur = parseTsvForCompare(
    "seat_type_area_cd\tval\n" +
      "A1\tv1\n" +
      "A1\tv2_mod\n"
  );
  const res = compareTables(base, cur);
  assert.strictEqual(res.dupKeys, 1);
  assert.deepStrictEqual(res.counts, {
    added: 0,
    removed: 1,
    changed: 1,
    same: 1
  });
});

// 9. Positional matching
test("compareTables: キー無し時の行順突合", () => {
  const base = parseTsvForCompare("colA\tcolB\n10\t20\n30\t40\n");
  const cur = parseTsvForCompare("colA\tcolB\n10\t25\n30\t40\n50\t60\n");
  const res = compareTables(base, cur);
  assert.strictEqual(res.positional, true);
  assert.deepStrictEqual(res.keyCols, []);
  assert.deepStrictEqual(res.counts, {
    added: 1,
    removed: 0,
    changed: 1,
    same: 1
  });
});

// 10. Leading zeros & trim option
test("compareTables: 先頭0の数値風文字列比較とtrimオプション", () => {
  const base = parseTsvForCompare("seat_type_area_cd\tcode\nA1\t001\nA2\t 100 \n");
  const cur = parseTsvForCompare("seat_type_area_cd\tcode\nA1\t1\nA2\t100\n");

  const resNoTrim = compareTables(base, cur, { trim: false });
  assert.strictEqual(resNoTrim.counts.changed, 2);

  const resTrim = compareTables(base, cur, { trim: true });
  assert.strictEqual(resTrim.counts.changed, 1);
  assert.strictEqual(resTrim.counts.same, 1);
});

// 11. charDiff round-trip tests
test("charDiff: eq+del=元 / eq+ins=後 の往復検証", () => {
  const pairs = [
    ["", ""],
    ["abc", "abc"],
    ["", "hello"],
    ["hello", ""],
    ["指定席A", "指定席S"],
    ["2025/01/01 10:00", "2025/02/01 12:30"],
    ["abcdef", "abXYef"],
    ["A".repeat(300) + "X" + "B".repeat(300), "A".repeat(300) + "Y" + "B".repeat(300)],
    ["X".repeat(250) + "123", "Y".repeat(250) + "456"]
  ];

  for (const [a, b] of pairs) {
    const ops = charDiff(a, b);
    const reconA = ops
      .filter((op) => op.t === "eq" || op.t === "del")
      .map((op) => op.s)
      .join("");
    const reconB = ops
      .filter((op) => op.t === "eq" || op.t === "ins")
      .map((op) => op.s)
      .join("");
    assert.strictEqual(reconA, a, `reconA mismatch for ${a.slice(0, 20)}`);
    assert.strictEqual(reconB, b, `reconB mismatch for ${b.slice(0, 20)}`);
  }
});

// 12. buildHtmlReport: HTML escape, all diff rows (>200), excludes 'same' rows, self-contained
test("buildHtmlReport: HTMLエスケープ・全行出力・変更なし除外・自己完結", () => {
  const header = "seat_type_area_cd\tname\tnote\n";
  const baseLines = [header];
  const curLines = [header];

  // Add 1 'same' row that must NOT appear in table rows
  baseLines.push("SAME_KEY_000\tUNCHANGED_NAME\tkeep\n");
  curLines.push("SAME_KEY_000\tUNCHANGED_NAME\tkeep\n");

  // Add 250 changed rows (>200 limit) including XSS payload
  baseLines.push('XSS_KEY\t"<script>alert(1)</script>"\told_note\n');
  curLines.push('XSS_KEY\t"<script>alert(2)</script>"\tnew_note\n');

  for (let i = 1; i <= 250; i++) {
    baseLines.push(`K${i}\tname_${i}\tv1\n`);
    curLines.push(`K${i}\tname_${i}\tv2\n`);
  }

  // Add 1 added row and 1 removed row
  baseLines.push("DEL_KEY\tdel_name\tdel_v\n");
  curLines.push("ADD_KEY\tadd_name\tadd_v\n");

  const res = compareTables(
    parseTsvForCompare(baseLines.join("")),
    parseTsvForCompare(curLines.join(""))
  );
  const html = buildHtmlReport(res, {
    baseName: '<img src=x onerror="alert(1)">base.tsv',
    curName: "cur.tsv",
    generatedAt: "2026-11-16 11:10"
  });

  // Self-contained: no external http:// or https://
  assert.strictEqual(html.indexOf("http://"), -1);
  assert.strictEqual(html.indexOf("https://"), -1);
  assert.ok(html.includes('<meta charset="utf-8">'));

  // HTML escaping: raw <script>alert or <img src=x must not appear
  assert.strictEqual(html.indexOf("<script>alert"), -1);
  assert.strictEqual(html.indexOf("<img src=x"), -1);
  assert.ok(html.includes("&lt;script&gt;alert("));

  // Same row excluded from body table, but count shown in summary
  assert.ok(html.includes("変更なし 1行"));
  assert.strictEqual(html.indexOf("SAME_KEY_000"), -1);

  // All 251 changed + 1 added + 1 removed = 253 rows included (no 200-row cap)
  assert.ok(html.includes("K250"));
  assert.ok(html.includes("ADD_KEY"));
  assert.ok(html.includes("DEL_KEY"));
});

if (failed > 0) {
  console.error(`${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
