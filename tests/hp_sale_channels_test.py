"""一般HPと先行・別経路の分離。HP_KNOWLEDGE_MODULEで旧版との再現比較も可能。"""
import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODULE = ROOT / 'hp_knowledge.py'
if not DEFAULT_MODULE.is_file():
    DEFAULT_MODULE = ROOT.parent.parent / 'price_crosscheck' / 'hp_knowledge.py'
spec = importlib.util.spec_from_file_location('hp_knowledge_channels', os.environ.get('HP_KNOWLEDGE_MODULE', str(DEFAULT_MODULE)))
H = importlib.util.module_from_spec(spec)
spec.loader.exec_module(H)


def page(text, name='guide', title='2027 F1 チケット'):
    return {'source_id': name, 'url': 'https://example.com/' + name + '.html', 'fetched_at': '2026-09-30T03:00:00+09:00', 'title': title, 'text': text}


class TestSaleChannels(unittest.TestCase):
    def test_mixed_general_amex_platinum_starts_and_ends(self):
        data = H.extract_sale_info([page('AMEX先行販売\n2026年10月1日10:00 発売\nV1指定席…2026年10月5日23:59まで\nプラチナ先行販売\n2026年10月10日10:00 発売\n一般販売\n2026年11月15日11:00 発売\nV1指定席…2027年4月25日23:59まで')], 'F1_27')
        self.assertEqual(data['start'], '2026/11/15 11:00')
        self.assertEqual([r['end'] for r in data['rules']], ['2027/04/25 23:59'])
        self.assertEqual(data['channels']['amex']['start'], '2026/10/01 10:00')
        self.assertEqual(data['channels']['platinum']['start'], '2026/10/10 10:00')
        self.assertEqual(data['start_source_url'], 'https://example.com/guide.html')

    def test_page_order_does_not_change_general(self):
        pages = [page('AMEX先行販売\n2026年10月1日10:00 発売', 'amex'), page('一般販売\n2026年11月15日11:00 発売', 'general')]
        for variant in (pages, pages[::-1]):
            self.assertEqual(H.extract_sale_info(variant, 'F1_27')['start'], '2026/11/15 11:00')

    def test_presale_only_unknown_and_conflict_are_unconfirmed(self):
        for text in ('AMEX先行販売\n2026年10月1日10:00 発売', '2026年10月1日10:00 発売', '一般販売 AMEX先行販売 2026年10月1日10:00 発売', '一般販売\n2026年11月15日11:00 発売\n2026年11月16日11:00 発売', '一般販売\n2026年11月15日11:00 発売\n12月1日10:00 発売'):
            with self.subTest(text=text):
                self.assertIsNone(H.extract_sale_info([page(text)], 'F1_27')['start'])

    def test_card_list_and_presale_exclusion_notes_do_not_reclassify(self):
        text = '一般販売\n2026年11月15日11:00 発売\n※先行販売チケットはアップグレードできません。\n支払方法\nVisa\nAmerican Express\nMastercard'
        result = H.extract_sale_info([page(text)], 'F1_27')
        self.assertEqual(result['start'], '2026/11/15 11:00')
        self.assertNotIn('amex', result['channels'])
        self.assertNotIn('presale', result['channels'])
        self.assertIn('※先行販売チケットはアップグレードできません。', H.general_page(page(text))['text'])

    def test_bare_date_table_and_asoview_variant(self):
        text = '販売開始日\n11月15日(日)11:00～\n全席種販売開始\n11月16日(月)11:00～\n西エリア券 のみアソビュ―!で販売'
        result = H.extract_sale_info([page(text)], 'F1_27', {'sale_year': 2026})
        self.assertEqual(result['start'], '2026/11/15 11:00')
        self.assertEqual(result['channels']['other']['start'], '2026/11/16 11:00')
        self.assertEqual(result['start_raw'], '11月15日(日)11:00～')
        self.assertIsNone(H.extract_sale_info([page(text)], 'F1_27')['start'])

    def test_year_evidence_must_not_cross_sales_channels(self):
        data = H.extract_sale_info([page('AMEX先行販売\n2026年11月15日11:00 発売\n一般販売\n11月15日11:00 発売')], 'F1_27')
        self.assertIsNone(data['start'])
        self.assertEqual(data['channels']['amex']['start'], '2026/11/15 11:00')

    def test_general_conflicting_years_not_silently_selected(self):
        self.assertIsNone(H.extract_sale_info([page('一般販売\n2026年11月15日11:00 発売\n2027年11月15日11:00 発売')], 'F1_27')['start'])

    def test_non_f1_legacy_period_kept(self):
        data = H.extract_sale_info([page('2026年10月1日10:00 発売\nV1指定席…2026年10月5日23:59まで')], 'JRR26')
        self.assertEqual(data['start'], '2026/10/01 10:00')
        self.assertEqual(data['rules'][0]['end'], '2026/10/05 23:59')

    def test_special_prices_and_ai_notes_excluded(self):
        text = 'AMEX先行販売\n2026年10月1日10:00 発売\nV1席\n価格(税込)\n大人(24歳以上)\n50,000円\n※AMEX先行特典\n一般販売\n2026年11月15日11:00 発売\nV1席\n価格(税込)\n大人(24歳以上)\n60,000円\n※一般の注意'
        data = H.build_event_knowledge('F1_27', {'label': '2027 F1'}, [page(text)], [{'席種エリアコード': 'SF1GPE27011', '席種名': 'F1_V1観戦券[T0]', 'hp_source_id': 'guide', 'status': 'auto'}])
        adult = next(i for i in data['items'] if i['seat_code'] == 'SF1GPE27011' and i['ticket_name'] == '大人(24歳以上)')
        self.assertEqual(adult['advance'], 60000)
        self.assertEqual(adult['confidence'], 'exact')
        self.assertFalse(any('AMEX先行特典' in line for notes in data['page_notes'].values() for line in notes['lines']))
        self.assertEqual(data['reference_channel'], 'general')

    def test_event_prefix_and_unpublished_sources_are_excluded(self):
        pages = [page('一般販売\n2026年11月15日11:00 発売', 'suzuka_f1_2027_general'),
                 page('一般販売\n2025年11月15日11:00 発売', 'suzuka_f1_2026_general'),
                 dict(page('一般販売\n2026年10月1日10:00 発売', 'suzuka_f1_2027_hidden'), url='https://testweb.example.com/f1')]
        data = H.extract_sale_info(pages, 'F1_27', {'hp_source_prefix': ['suzuka_f1_2027']})
        self.assertEqual(data['start'], '2026/11/15 11:00')

    def test_dedicated_member_page_cannot_supply_public_prices(self):
        p = page('V1席\n価格(税込)\n大人(24歳以上)\n50,000円', title='AMEX会員専用チケット')
        self.assertFalse(H.parse_f1_page(H.general_page(p)))

    def test_date_for_event_is_not_a_sale_start(self):
        result = H.extract_sale_info([page('一般販売\n2026年11月15日11:00 発売\n※2027年4月11日の年齢で購入してください。\n4月9日(金)00:00～\n会場へ入場可能')], 'F1_27')
        self.assertEqual(result['start'], '2026/11/15 11:00')


if __name__ == '__main__':
    unittest.main()
