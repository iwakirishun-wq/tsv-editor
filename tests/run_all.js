/**
 * run_all.js — UG判定まわりの回帰テストをまとめて実行する
 *
 * 実行: node tests/run_all.js
 *
 * UG判定ルールを変えたら、正本・JS・VBA・テストの4点をセットで更新すること
 * （正本: 50_OUTPUTS/01_開発成果物/tsv_editor/2026-07-03_UG検算ルール正本.md）。
 */
const path = require("path");
const { spawnSync } = require("child_process");

const SUITES = ["price_rules", "ug_validator", "ug_bridge"];
let failed = 0;

for (const name of SUITES) {
  const r = spawnSync(process.execPath, [path.join(__dirname, name + ".test.js")], { encoding: "utf8" });
  const last = (r.stdout || "").trim().split("\n").pop() || "";
  console.log(name.padEnd(16) + last);
  if (r.status !== 0) {
    failed++;
    process.stderr.write((r.stderr || "") + (r.stdout || ""));
  }
}

console.log(failed ? `\n${failed} 件のテストスイートが失敗しました` : "\nすべてのテストスイートが成功しました");
process.exit(failed ? 1 : 0);
