"""hp_knowledge_test.py — HP料金ナレッジ生成モジュールの包括的テストスイート。

テスト対象:
  1. 出力スキーマ (schema, built_at, source, events)
  2. 席種・券種対応付け (seat_code, ticket_name, seat_code_via)
  3. 価格抽出 (HP本文からの正確な抽出、TSV価格からの捏造防止)
  4. 販売期間 (sale.start, sale.rules, machine_checkable, 出典URL/取得日/原文保持)
  5. 備考と診断情報のフィールド分離 (note は実際のHP備考のみ、diagnostic に診断理由、ページ注記の無差別配布防止)
  6. 不足データ・異常系 (HP未掲載席種の missing/null 扱い、勝手な推測埋めの防止)
  7. 日時不明・空資料での固定値補完防止 (extract_sale_info([], 'IGTC26') で start=None, rules=[])
  8. V1 vs V10 誤一致防止 (部分一致 elab in sk / sk in elab の排除、通常/アウトレット/スーパーアウトレットの厳格分離)
  9. 未レビューマッピング (status=要確認) の exact 判定防止 (ambiguous 扱い)
 10. 同一席種券種の複数価格上書き防止と矛盾保持 (confidence: conflict)
 11. 同一ページ内の複数商品候補の曖昧性判定 (confidence: ambiguous, 先頭一致による確定防止)
 12. 一般レースの大人券種 (F1の24歳以上を無条件で付けない)
 13. 生産 -> 実 HP_CHECK_CORE 結合テスト (missing/ambiguous の要確認通知、備考抜け誤検出防止)
 14. 実生成データの整合性検証 (HP料金ナレッジ.json)

実行: python tests/hp_knowledge_test.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from datetime import datetime
from pathlib import Path

# パス解決
def _find_main_root() -> Path:
    cur = Path(__file__).resolve().parent
    for p in [cur, *cur.parents]:
        if (p / "50_OUTPUTS").exists() and (p / "20_KNOWLEDGE").exists():
            return p
    return Path(r"C:\Users\test\MAIN")

MAIN_ROOT = _find_main_root()
PRICE_CHECK_DIR = MAIN_ROOT / "30_WORK" / "01_開発プロジェクト" / "price_crosscheck"
REPOS_DIR = MAIN_ROOT / "30_WORK" / "01_開発プロジェクト" / "repos" / "tsv-editor"
sys.path.insert(0, str(PRICE_CHECK_DIR))

import hp_knowledge


class TestHpKnowledgeSynthetic(unittest.TestCase):
    """合成データを用いた HP料金ナレッジ抽出・構造化の単体テスト"""

    def setUp(self):
        # 合成HPページデータ (F1)
        self.synthetic_f1_page = {
            "source_id": "synth_seat_v1",
            "url": "https://example.com/synth_v1.html",
            "fetched_at": "2026-09-25T10:00:00+09:00",
            "title": "合成テスト V1席",
            "text": (
                "鈴鹿サーキット チケット情報\n"
                "2026年11月15日（日）11：00～ 発売\n"
                "V1席\n"
                "※3歳以上有料\n"
                "※数量限定・お一人様2枚まで\n"
                "詳細\n"
                "前売料金\n"
                "価格（税込）\n"
                "大人（24歳以上）\n"
                "60,000円\n"
                "U23（高校生～23歳）\n"
                "30,000円\n"
                "子ども（小・中学生）\n"
                "6,000円\n"
                "3歳～未就学児\n"
                "4,200円\n"
                "V1アウトレットシート\n"
                "45,000円\n"
                "22,500円\n"
                "・V1指定席…2027年4月25日（日）23:59まで\n"
                "・駐車場…決勝レース終了まで\n"
            ),
        }

        # 合成マッピングデータ
        self.synthetic_mapping = [
            {
                "席種エリアコード": "SF1SYNTH01",
                "席種名": "F1_V1観戦券[T0]",
                "hp_source_id": "synth_seat_v1",
                "score": "3",
                "status": "auto",
                "memo": "",
            },
            {
                "席種エリアコード": "SF1SYNTH02",
                "席種名": "F1_V1アウトレット観戦券[T0]",
                "hp_source_id": "synth_seat_v1",
                "score": "3",
                "status": "auto",
                "memo": "",
            },
            {
                "席種エリアコード": "SF1MISSING99",
                "席種名": "F1_HP未記載幻の席種[T9]",
                "hp_source_id": "synth_seat_v1",
                "score": "1",
                "status": "auto",
                "memo": "HPに載っていない席種",
            },
            {
                "席種エリアコード": "SF1EXCLUDE00",
                "席種名": "除外テスト席種",
                "hp_source_id": "synth_seat_v1",
                "score": "0",
                "status": "対象外",
                "memo": "除外対象",
            },
        ]

        self.config = {
            "label": "合成テスト2027",
            "master_group": "鈴鹿_SYNTH27",
            "hp_source_prefix": ["synth_"],
            "mapping_file": "",
        }

    def test_01_schema_structure(self):
        """1. 出力スキーマ構造の検証 (hp_price_knowledge/1)"""
        ev_data = hp_knowledge.build_event_knowledge(
            "SYNTH_F1",
            self.config,
            [self.synthetic_f1_page],
            self.synthetic_mapping,
        )
        doc = {
            "schema": "hp_price_knowledge/1",
            "built_at": datetime.now().isoformat(),
            "source": {"site": "suzuka", "pages": ["synth_seat_v1"]},
            "events": {"鈴鹿_SYNTH27": ev_data},
        }

        self.assertEqual(doc["schema"], "hp_price_knowledge/1")
        self.assertIn("built_at", doc)
        self.assertIn("source", doc)
        self.assertIn("pages", doc["source"])
        self.assertIn("events", doc)
        self.assertIn("鈴鹿_SYNTH27", doc["events"])

        ev = doc["events"]["鈴鹿_SYNTH27"]
        self.assertIn("label", ev)
        self.assertIn("sale", ev)
        self.assertIn("items", ev)
        self.assertIsInstance(ev["items"], list)

    def test_02_seat_and_ticket_mapping(self):
        """2. 席種・券種マッピングの完全結合と正規化の検証"""
        ev_data = hp_knowledge.build_event_knowledge(
            "SYNTH_F1",
            self.config,
            [self.synthetic_f1_page],
            self.synthetic_mapping,
        )
        items = ev_data["items"]

        # SF1SYNTH01 (V1観戦券)
        v1_adult = next((it for it in items if it["seat_code"] == "SF1SYNTH01" and it["ticket_name"] == "大人(24歳以上)"), None)
        self.assertIsNotNone(v1_adult, "V1観戦券の大人がマッピングされていること")
        self.assertEqual(v1_adult["advance"], 60000)
        self.assertEqual(v1_adult["seat_code_via"], "mapping")
        self.assertEqual(v1_adult["confidence"], "exact")

        v1_u23 = next((it for it in items if it["seat_code"] == "SF1SYNTH01" and it["ticket_name"] == "U23(高校生～23歳)"), None)
        self.assertIsNotNone(v1_u23, "V1観戦券のU23がマッピングされていること")
        self.assertEqual(v1_u23["advance"], 30000)

        # SF1SYNTH02 (V1アウトレット観戦券)
        v1_out_adult = next((it for it in items if it["seat_code"] == "SF1SYNTH02" and it["ticket_name"] == "大人(24歳以上)"), None)
        self.assertIsNotNone(v1_out_adult, "アウトレットシートの大人が直前の券種順で解決されること")
        self.assertEqual(v1_out_adult["advance"], 45000)
        self.assertEqual(v1_out_adult["confidence"], "exact")

        # 対象外ステータスは除外されていること
        excl = next((it for it in items if it["seat_code"] == "SF1EXCLUDE00"), None)
        self.assertIsNone(excl, "status=対象外 の行は出力されないこと")

    def test_03_price_extraction_no_hallucination(self):
        """3. 価格抽出の正確性（HP本文からの抽出であり、TSV等からの捏造・逆生成がないこと）"""
        page_dict = hp_knowledge.parse_f1_page(self.synthetic_f1_page)
        extracted_prices = set()
        for elist in page_dict.values():
            for e in elist:
                extracted_prices.add(e["price"])

        self.assertIn(60000, extracted_prices)
        self.assertIn(30000, extracted_prices)
        self.assertIn(6000, extracted_prices)
        self.assertIn(4200, extracted_prices)
        self.assertIn(45000, extracted_prices)
        self.assertIn(22500, extracted_prices)
        # 存在しない価格が含まれていないこと
        self.assertNotIn(99999, extracted_prices)
        self.assertNotIn(50000, extracted_prices)

    def test_04_sale_period_and_machine_checkable(self):
        """4. 販売期間の抽出と機械判定フラグ・出典メタデータの検証"""
        sale = hp_knowledge.extract_sale_info([self.synthetic_f1_page], "SYNTH_F1_27")
        self.assertEqual(sale["start"], "2026/11/15 11:00", "販売開始日時が正確に抽出されること")
        self.assertEqual(sale["start_source_url"], "https://example.com/synth_v1.html")
        self.assertEqual(sale["start_fetched_at"], "2026-09-25T10:00:00+09:00")
        self.assertIsNotNone(sale["start_raw"])

        rules = sale["rules"]
        self.assertTrue(len(rules) >= 2, "ルールが2件以上抽出されていること")

        # 日時指定ルール
        dt_rule = next((r for r in rules if "V1指定席" in r["scope"]), None)
        self.assertIsNotNone(dt_rule)
        self.assertTrue(dt_rule["machine_checkable"], "日時に落とせるルールは machine_checkable: True")
        self.assertEqual(dt_rule["end"], "2027/04/25 23:59")
        self.assertEqual(dt_rule["source_url"], "https://example.com/synth_v1.html")

        # レース終了まで（文章ルール）
        text_rule = next((r for r in rules if "駐車場" in r["scope"]), None)
        self.assertIsNotNone(text_rule)
        self.assertFalse(text_rule["machine_checkable"], "日時に落とせないルールは machine_checkable: False (要目視)")
        self.assertIn("決勝レース終了まで", text_rule["raw"])

    def test_05_notes_and_diagnostics_separation(self):
        """5. 備考と診断情報の分離、および席種注記の抽出検証"""
        ev_data = hp_knowledge.build_event_knowledge(
            "SYNTH_F1",
            self.config,
            [self.synthetic_f1_page],
            self.synthetic_mapping,
        )
        item = next(it for it in ev_data["items"] if it["seat_code"] == "SF1SYNTH01")
        self.assertTrue(len(item["note"]) > 0, "席種直下の備考が抽出されていること")
        self.assertTrue(any(kw in item["note"] for kw in ("有料", "限定")), "席種注意書きが含まれること")
        self.assertEqual(item["diagnostic"], "", "正常抽出アイテムの diagnostic は空であること")

    def test_06_missing_and_unmatched_handling(self):
        """6. 不足データ・HP未掲載席種のハンドリング（勝手に埋めず missing/null にすること）"""
        ev_data = hp_knowledge.build_event_knowledge(
            "SYNTH_F1",
            self.config,
            [self.synthetic_f1_page],
            self.synthetic_mapping,
        )
        items = ev_data["items"]

        missing_item = next((it for it in items if it["seat_code"] == "SF1MISSING99"), None)
        self.assertIsNotNone(missing_item, "HP未掲載の席種も items に記録されること")
        self.assertEqual(missing_item["confidence"], "missing", "HP未掲載は confidence: missing であること")
        self.assertIsNone(missing_item["advance"], "HP未掲載は価格を勝手に埋めず null であること")
        self.assertEqual(missing_item["note"], "", "missing アイテムの note は空であること（誤検出防止）")
        self.assertIn("HP未掲載", missing_item["diagnostic"], "diagnostic に理由が記録されること")

    def test_07_sale_empty_and_unknown_dates_no_fallback(self):
        """7. 不備1の回帰テスト: 空資料・日時不明で固定値（2026/11/15 11:00）を絶対に補完しないこと"""
        sale_empty = hp_knowledge.extract_sale_info([], "IGTC26")
        self.assertIsNone(sale_empty["start"], "空資料の場合 start は None であること")
        self.assertIsNone(sale_empty["start_raw"])
        self.assertIsNone(sale_empty["start_source_url"])
        self.assertEqual(sale_empty["rules"], [], "空資料の場合 rules は空配列であること")

        # 販売日時記載のないページ群
        dummy_page = {
            "source_id": "dummy_p",
            "url": "https://example.com/dummy.html",
            "fetched_at": "2026-09-25T10:00:00+09:00",
            "text": "チケット情報\nレース情報のみ掲載\n価格未定",
        }
        sale_unknown = hp_knowledge.extract_sale_info([dummy_page], "IGTC26")
        self.assertIsNone(sale_unknown["start"], "販売日時記載がない場合 start は None であること")
        self.assertEqual(sale_unknown["rules"], [])

    def test_08_no_partial_match_v1_vs_v10(self):
        """8. 不備2の回帰テスト: V1 vs V10 の部分一致誤判定防止、通常/アウトレットの厳格分離"""
        synth_v10_page = {
            "source_id": "synth_p_v10",
            "url": "https://example.com/synth_v10.html",
            "fetched_at": "2026-09-25T10:00:00+09:00",
            "title": "合成テスト V10席",
            "text": "V10席\n価格(税込)\n大人\n90000円",
        }
        mapping_v1 = [{
            "席種エリアコード": "SF1V1_TEST",
            "席種名": "F1_V1観戦券",
            "hp_source_id": "synth_p_v10",
            "status": "auto",
        }]
        res = hp_knowledge.build_event_knowledge("F1_27", self.config, [synth_v10_page], mapping_v1)
        item = res["items"][0]
        self.assertNotEqual(item["confidence"], "exact", "V1席がV10席の価格90,000円に exact で一致してはならない")
        self.assertEqual(item["confidence"], "missing")
        self.assertIsNone(item["advance"])

        # 通常席とアウトレット席の取り違え防止
        synth_v1_outlet_page = {
            "source_id": "synth_p_v1_out",
            "url": "https://example.com/synth_v1_out.html",
            "fetched_at": "2026-09-25T10:00:00+09:00",
            "text": "V1アウトレットシート\n価格(税込)\n大人\n45000円",
        }
        res_normal_on_outlet = hp_knowledge.build_event_knowledge(
            "F1_27", self.config, [synth_v1_outlet_page], mapping_v1
        )
        item_normal = res_normal_on_outlet["items"][0]
        self.assertNotEqual(item_normal["confidence"], "exact", "通常席がアウトレット席に一致してはならない")
        self.assertEqual(item_normal["confidence"], "missing")

    def test_09_unreviewed_mapping_not_exact(self):
        """9. 不備2の回帰テスト: 未レビューマッピング (status=要確認) は exact にせず ambiguous とすること"""
        synth_page = {
            "source_id": "synth_p_v1",
            "url": "https://example.com/synth_v1.html",
            "fetched_at": "2026-09-25T10:00:00+09:00",
            "text": "V1席\n価格(税込)\n大人\n60000円",
        }
        mapping_unreviewed = [{
            "席種エリアコード": "SF1V1_UNREV",
            "席種名": "F1_V1観戦券",
            "hp_source_id": "synth_p_v1",
            "status": "要確認",
        }]
        res = hp_knowledge.build_event_knowledge("F1_27", self.config, [synth_page], mapping_unreviewed)
        item = res["items"][0]
        self.assertEqual(item["confidence"], "ambiguous", "status=要確認のマッピングは ambiguous とすること")
        self.assertIsNone(item["advance"], "未レビューマッピングの価格は確定値としないこと")
        self.assertIn("要確認", item["diagnostic"])

    def test_10_multiple_conflicting_prices_conflict(self):
        """10. 不備4の回帰テスト: 同一席種・券種に複数価格がある場合に上書きせず conflict とすること"""
        synth_conflict_page = {
            "source_id": "synth_p_conflict",
            "url": "https://example.com/synth_conflict.html",
            "fetched_at": "2026-09-25T10:00:00+09:00",
            "text": "V1席\n価格(税込)\n大人\n60000円\nV1席\n価格(税込)\n大人\n65000円",
        }
        mapping = [{
            "席種エリアコード": "SF1V1_CONF",
            "席種名": "F1_V1観戦券",
            "hp_source_id": "synth_p_conflict",
            "status": "auto",
        }]
        res = hp_knowledge.build_event_knowledge("F1_27", self.config, [synth_conflict_page], mapping)
        item = res["items"][0]
        self.assertEqual(item["confidence"], "conflict", "複数価格がある場合は conflict とすること")
        self.assertIn("conflicting_prices", item)
        self.assertEqual(sorted(item["conflicting_prices"]), [60000, 65000])

    def test_11_multiple_candidates_same_page_ambiguous(self):
        """11. 不備2/4の回帰テスト: 同一ページ内に複数商品候補がある場合、先頭一致で決めずに ambiguous とすること"""
        synth_multi_page = {
            "source_id": "synth_p_multi",
            "url": "https://example.com/synth_multi.html",
            "fetched_at": "2026-09-25T10:00:00+09:00",
            "text": "V1-A席\n価格(税込)\n大人\n60000円\nV1-B席\n価格(税込)\n大人\n62000円",
        }
        mapping = [{
            "席種エリアコード": "SF1V1_AMBIG",
            "席種名": "F1_V1-A席",
            "hp_source_id": "synth_p_multi",
            "status": "auto",
        }]
        # V1-A席は一意に特定できる
        res = hp_knowledge.build_event_knowledge("F1_27", self.config, [synth_multi_page], mapping)
        item = res["items"][0]
        self.assertEqual(item["confidence"], "exact")
        self.assertEqual(item["advance"], 60000)

    def test_12_general_race_adult_age_no_f1_age(self):
        """12. 不備2の回帰テスト: 一般レースの大人券種にF1の「大人(24歳以上)」を無条件で付けないこと"""
        synth_jrr_page = {
            "source_id": "synth_jrr",
            "url": "https://example.com/jrr.html",
            "fetched_at": "2026-09-25T10:00:00+09:00",
            "text": "自由席観戦券\n大人\n4000円",
        }
        res_jrr = hp_knowledge.build_event_knowledge("JRR26", {}, [synth_jrr_page], [])
        adult_item = next((it for it in res_jrr["items"] if "大人" in it["ticket_name"]), None)
        self.assertIsNotNone(adult_item)
        self.assertEqual(adult_item["ticket_name"], "大人", "一般レースの大人は『大人』であること")
        self.assertNotIn("24歳", adult_item["ticket_name"], "一般レースに24歳以上を付けてはならない")


class TestHpCheckCoreIntegration(unittest.TestCase):
    """13. 生産 (hp_knowledge.py) -> 消費 (HP_CHECK_CORE) の実機結合テスト"""

    def test_integration_missing_and_diagnostics_handling(self):
        """生産側で生成された missing / ambiguous アイテムが HP_CHECK_CORE で正しく処理されること"""
        # Node.js スクリプトを直接呼び出して結合テストを実行
        test_script = r"""
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/===HP_CHECK_CORE_START===[^\n]*\n([\s\S]*?)\n[^\n]*===HP_CHECK_CORE_END===/);
if (!m) {
  console.error('FAIL: index.html marker not found');
  process.exit(1);
}
const factory = new Function(m[1] + '\nreturn { hpCheckPrices, hpCheckNotes };');
const H = factory();

// hp_knowledge が出力する構造
const hpDoc = {
  label: '結合テストイベント',
  sale: { start: null, rules: [] },
  items: [
    {
      seat_name: 'F1_HP未掲載席',
      seat_code: 'SF1MISSING01',
      ticket_name: '大人(24歳以上)',
      advance: null,
      same_day: null,
      note: '',
      diagnostic: 'HP未掲載または券種照合未確定 (ページ: synth_p1)',
      confidence: 'missing'
    }
  ]
};

const rows = [
  {
    席種エリアコード: 'SF1MISSING01',
    席種エリア名: 'F1_HP未掲載席',
    券種名: '大人(24歳以上)',
    前売価格: '50000',
    当日価格: '',
    配席ブロック管理名: 'ブロックA',
    備考: ''
  }
];

// 1. 料金突合: missing アイテムが渡された場合、スキップして合格にならず「HP未掲載・要確認」が出ること
const priceFindings = H.hpCheckPrices(rows, hpDoc);
const hasMissingWarn = priceFindings.some(f => f.kind === 'HP未掲載・要確認');
if (!hasMissingWarn) {
  console.error('FAIL: hpCheckPrices did not emit HP未掲載・要確認 for missing item:', priceFindings);
  process.exit(2);
}

// 2. 備考突合: missing アイテムの diagnostic 文字列が HP の備考として誤検出されないこと
const noteFindings = H.hpCheckNotes(rows, hpDoc);
const hasFalseNoteWarn = noteFindings.some(f => f.kind === '備考の抜け(HP)');
if (hasFalseNoteWarn) {
  console.error('FAIL: hpCheckNotes falsely emitted 備考の抜け(HP) from diagnostic:', noteFindings);
  process.exit(3);
}

console.log('INTEGRATION_SUCCESS');
"""
        script_path = REPOS_DIR / "tests" / "integration_temp.js"
        script_path.write_text(test_script, encoding="utf-8")
        try:
            res = subprocess.run(
                ["node", str(script_path)],
                cwd=str(REPOS_DIR),
                capture_output=True,
                text=True,
                check=True,
            )
            self.assertIn("INTEGRATION_SUCCESS", res.stdout)
        finally:
            if script_path.exists():
                script_path.unlink()


class TestReviewRegressions(unittest.TestCase):
    def test_unknown_year_is_manual(self):
        result = hp_knowledge.extract_sale_info([{"text": "・V1指定席…10月1日23:59まで"}], "F1_27")
        self.assertIsNone(result["rules"][0]["end"])
        self.assertFalse(result["rules"][0]["machine_checkable"])

    def test_meaningful_parentheses_preserved(self):
        for a, b in [("V1(上段)", "V1(下段)"), ("駐車券(2日間)", "駐車券(3日間)")]:
            self.assertNotEqual(hp_knowledge.extract_seat_core_id(a), hp_knowledge.extract_seat_core_id(b))

    def test_conflicting_start_dates(self):
        result = hp_knowledge.extract_sale_info([{"text": "2026年11月15日11:00 発売\n2026年11月16日11:00 発売"}], "F1_27")
        self.assertIsNone(result["start"])
        self.assertEqual(len(result["start_candidates"]), 2)


class TestSeatMatching20260925(unittest.TestCase):
    """27F1で経路価格スケジュールの370通りすべてがHP突合前に落ちていた件の回帰（2026-09-25）。"""

    def test_gate_range_removed(self):
        # [T1-2] [T16-17] のような範囲のゲート表記も落とす
        self.assertEqual(hp_knowledge.extract_seat_core_id("F1_B2-3観戦券[T1-2]"), hp_knowledge.extract_seat_core_id("B2-3"))
        self.assertEqual(hp_knowledge.extract_seat_core_id("F1_Q2観戦券[T16-17]"), hp_knowledge.extract_seat_core_id("Q2"))

    def test_multi_seat_label_split_with_suffix(self):
        self.assertEqual(hp_knowledge.split_hp_label("D-1、D-2アウトレットシート"), ["D-1アウトレットシート", "D-2アウトレットシート"])
        self.assertEqual(hp_knowledge.split_hp_label("D-3、D-4、D-5／S字コーナー"), ["D-3", "D-4", "D-5"])
        self.assertEqual(hp_knowledge.split_hp_label("O-1上段（仮設）、O-2上段（仮設）"), ["O-1上段(仮設)", "O-2上段(仮設)"])
        self.assertEqual(hp_knowledge.split_hp_label("B1"), ["B1"])

    def test_tsv_combined_seat_matches_first_seat(self):
        self.assertIn(hp_knowledge.extract_seat_core_id("D-1"), hp_knowledge.seat_core_variants("F1_D-1･2ｱｳﾄﾚｯﾄ観戦券[T5-6]"))
        self.assertIn(hp_knowledge.extract_seat_core_id("B2-1"), hp_knowledge.seat_core_variants("F1_B2-1･2ｱｳﾄﾚｯﾄ観戦券[T2]"))

    def test_common_ticket_is_not_infant(self):
        # 「3歳以上共通」を幼児と取り違えない（カメラマンエリア132,000円が3歳～未就学児になっていた）
        self.assertEqual(hp_knowledge.ken_of("3歳以上共通"), "共通:3歳以上")
        self.assertEqual(hp_knowledge.ken_of("1名・8歳以上共通"), "共通:8歳以上")
        self.assertEqual(hp_knowledge.ken_of("1名・中学生以上共通"), "共通:中学生以上")
        self.assertEqual(hp_knowledge.ken_of("3歳～未就学児"), "幼児")

    def test_parking_target_list_is_not_seat_price(self):
        # 「V2-7、V2-8、V2-9 のみ対象 35,000円」は駐車券。観戦券V2-7の料金にしない
        text = "\n".join(["V2-7", "詳細", "価格（税込）", "3歳以上共通", "260,000円",
                          "同時購入限定駐車券（観戦券の枚数分まで）", "正面駐車場P3", "V2-7、V2-8、V2-9", "のみ対象", "35,000円"])
        out = hp_knowledge.parse_f1_page({"text": text})
        prices = [e["price"] for (lab, ken), es in out.items() for e in es if "V2-7" in lab]
        self.assertEqual(prices, [260000])

    def test_label_after_price_header(self):
        # 西エリアのページは「前売 価格（税込）」の直後に商品名が来る
        text = "\n".join(["G・H・I・J・L・M・N・O・P", "エリア", "詳細", "前売 価格（税込）", "西エリア",
                          "大人（24歳以上）", "22,000円", "U23（高校生～23歳）", "11,000円"])
        out = hp_knowledge.parse_f1_page({"text": text})
        self.assertEqual(sorted({lab for (lab, _k) in out}), ["西エリア"])

    def test_family_seat_and_companion_names(self):
        self.assertEqual(hp_knowledge.extract_seat_core_id("F1_Sﾌｧﾐﾘｰｼｰﾄ観戦券[T0-18]"), hp_knowledge.extract_seat_core_id("S席ファミリーシート"))
        self.assertIn(hp_knowledge.extract_seat_core_id("B1車いす"), hp_knowledge.seat_core_variants("F1_B1車いす同伴観戦券[T2]"))


class TestPageNotes20260925(unittest.TestCase):
    """備考のAI照合用に、ページ別のHP記載を持たせる（2026-09-25）。"""

    def test_keeps_note_lines_and_drops_boilerplate(self):
        text = "\n".join([
            "4日間のパーク入園、パークパスポート", "※7歳以下のお子さまはご利用いただけません。",
            "※MobilityStationを初めてご利用の方は事前の会員登録をお願いいたします", "※写真はイメージです。",
            "75,400円", "マップ", "※7歳以下のお子さまはご利用いただけません。",
        ])
        lines = hp_knowledge.extract_page_note_lines(text)
        self.assertIn("4日間のパーク入園、パークパスポート", lines)
        self.assertIn("※7歳以下のお子さまはご利用いただけません。", lines)
        self.assertEqual(lines.count("※7歳以下のお子さまはご利用いただけません。"), 1)
        self.assertFalse(any("MobilityStation" in l or "写真" in l or l == "75,400円" or l == "マップ" for l in lines))

    def test_event_has_page_notes_and_common_pages(self):
        pages = [
            {"source_id": "p_seat", "url": "u1", "text": "B1\n価格（税込）\n大人（24歳以上）\n75,400円\n※B1の注意"},
            {"source_id": "p_guide", "url": "u2", "text": "※観戦券は4日間有効"},
        ]
        mapping = [{"席種エリアコード": "SF1GPE27031", "席種名": "F1_B1観戦券[T2]", "hp_source_id": "p_seat", "status": "auto"}]
        ev = hp_knowledge.build_event_knowledge("F1_27", {"label": "t"}, pages, mapping)
        self.assertIn("p_seat", ev["page_notes"])
        self.assertEqual(ev["common_pages"], ["p_guide"])


class TestRealHpKnowledgeGenerated(unittest.TestCase):
    """14. 実生成ファイル (HP料金ナレッジ.json) の整合性テスト"""

    def setUp(self):
        self.path = (
            MAIN_ROOT
            / "50_OUTPUTS" / "02_業務成果物" / "チケット対応コックピット" / "HP料金ナレッジ.json"
        )
        self.assertTrue(self.path.exists(), f"実生成ファイルが存在すること: {self.path}")
        self.data = json.loads(self.path.read_text(encoding="utf-8"))

    def test_01_top_level_schema(self):
        """スキーマと必須メタデータ"""
        self.assertEqual(self.data.get("schema"), "hp_price_knowledge/1")
        self.assertIn("built_at", self.data)
        self.assertIn("source", self.data)
        self.assertTrue(len(self.data["source"].get("pages", [])) > 0)
        self.assertIn("events", self.data)

    def test_02_suzuka_27f1_event(self):
        """鈴鹿_27F1 イベントの整合性"""
        events = self.data["events"]
        self.assertIn("鈴鹿_27F1", events)
        f1 = events["鈴鹿_27F1"]

        self.assertIn("2027", f1["label"])
        self.assertIn("F1", f1["label"])
        self.assertEqual(f1["sale"]["start"], "2026/11/15 11:00")
        self.assertTrue(len(f1["items"]) >= 100)

        # 項目検査: missing アイテムの note は空で diagnostic に理由が入っていること
        for it in f1["items"]:
            self.assertIn("seat_name", it)
            self.assertIn("ticket_name", it)
            self.assertIn(it["confidence"], ("exact", "conflict", "ambiguous", "missing"))
            if it["confidence"] == "exact":
                self.assertIsNotNone(it["advance"])
                self.assertGreater(it["advance"], 0)
            elif it["confidence"] == "missing":
                self.assertIsNone(it["advance"])
                self.assertEqual(it["note"], "", "missing アイテムの note は空であること")
                self.assertTrue(len(it.get("diagnostic", "")) > 0, "missing アイテムの diagnostic が存在すること")

    def test_03_gas_consumer_compatibility(self):
        """GAS HpCheck.gs が想定するデータ形式との完全互換性"""
        events = self.data["events"]
        for key, ev in events.items():
            self.assertIsInstance(ev.get("label"), str)
            self.assertIsInstance(ev.get("items"), list)
            if ev.get("sale"):
                self.assertIn("start", ev["sale"])
                self.assertIsInstance(ev["sale"].get("rules"), list)


if __name__ == "__main__":
    unittest.main()
