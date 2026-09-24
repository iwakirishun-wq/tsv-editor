# -*- coding: utf-8 -*-
"""席種起点（改善版）でのHP価格決定率の測定スクリプト。

対象: TSVの「席種エリアコード×券種」58通り（UG非該当、売止めダミー除く）
目的: 「HPはこの席種×券種をいくらと言っているか」を一意に機械決定できる上限を実データで測る。
"""
import sys, json, pathlib, collections, re, random, unicodedata
sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

HERE = pathlib.Path(__file__).resolve().parent
PC = HERE.parents[2] / "price_crosscheck"
if not PC.exists():
    PC = pathlib.Path("C:/Users/test/MAIN/30_WORK/01_開発プロジェクト/price_crosscheck")
sys.path.insert(0, str(PC))
import crosscheck as X

EVENT = "JRR26"
cfg = json.loads((PC / "events" / (EVENT + ".json")).read_text(encoding="utf-8"))
pages = X.load_hp_pages(cfg)
pages_by_id = {p["source_id"]: p for p in pages}
prices_by_id = {p["source_id"]: X.extract_hp_prices(p.get("text") or "") for p in pages}

# 対応表（読み取り専用）
mt = (PC / "mappings" / (EVENT + "_mapping.tsv")).read_text(encoding="utf-8-sig").replace("\r\n", "\n")
ml = [l for l in mt.split("\n") if l.strip()]
mh = ml[0].split("\t")
MAP = {}
for l in ml[1:]:
    d = dict(zip(mh, l.split("\t")))
    if d.get("status") != "対象外":
        MAP[d["席種エリアコード"]] = d

# TSV読み込み
MAIN_ROOT = PC.parents[2] if len(PC.parents) >= 3 else pathlib.Path("C:/Users/test/MAIN")
tsv_rel = cfg.get("schedule_tsv")
TSV = (MAIN_ROOT / tsv_rel) if tsv_rel else (
    MAIN_ROOT / "30_WORK/02_会社業務/01_チケット券売/"
    "料金表/出力TSV/経路価格スケジュール_もてぎ_JRR26_20260707.tsv"
)
txt = TSV.read_bytes().decode("utf-8-sig").replace("\r\n", "\n")
L = [l for l in txt.split("\n") if l.strip()]
h = L[0].split("\t")
ci = {n: h.index(n) for n in ("席種エリアコード", "席種エリア名",
                              "券種名", "前売価格",
                              "アップグレード該当フラグ")}
seen = {}
for l in L[1:]:
    r = l.split("\t")
    if r[ci["アップグレード該当フラグ"]].strip() != "非該当":
        continue
    k = (r[ci["席種エリアコード"]], r[ci["券種名"]])
    if k in seen or not k[0]:
        continue
    seen[k] = {"code": k[0], "seat": r[ci["席種エリア名"]], "ken": k[1],
               "adv": r[ci["前売価格"]].strip()}
rows = [v for v in seen.values() if v["adv"].isdigit() and not set(v["adv"]) <= {"9"}]


# ---------------------------------------------------------------------------
# 表構造の抽出ロジック（HTMLテーブル由来のテキスト解析）
# ---------------------------------------------------------------------------
def extract_table_entries(page_text):
    """HTMLテーブル由来のテキストブロックから (項目名, 金額, 行コンテキスト) を抽出"""
    lines = [unicodedata.normalize("NFKC", l).strip() for l in page_text.split("\n")]
    entries = []
    i = 0
    while i < len(lines):
        line = lines[i]
        pm = re.search(r"([\d,]{3,})\s*円", line)
        if pm:
            start_price = i
            prices = []
            while i < len(lines):
                m = re.search(r"([\d,]{3,})\s*円", lines[i])
                if m:
                    p = int(m.group(1).replace(",", ""))
                    prices.append((p, lines[i]))
                    i += 1
                elif lines[i].startswith("※") or lines[i].startswith("⇒") or lines[i] == "":
                    i += 1
                else:
                    break
            
            back = start_price - 1
            headers = []
            while back >= 0:
                bl = lines[back]
                if not bl or bl.startswith("※") or "横にスクロール" in bl:
                    back -= 1
                    continue
                if "販売期間" in bl or "ご案内" in bl or "注意事項" in bl or "特徴" in bl:
                    break
                headers.insert(0, bl)
                if len(headers) > 25:
                    break
                back -= 1
            
            if len(prices) == 3 and any("大人" in h for h in headers) and any("U23" in h for h in headers):
                row_label = " ".join([h for h in headers if "大人" not in h and "U23" not in h and "中学生" not in h and "歳" not in h])
                is_adv = "当日" not in row_label
                entries.append({"col": "大人", "price": prices[0][0], "context": f"{row_label} / 大人", "is_adv": is_adv})
                entries.append({"col": "U23", "price": prices[1][0], "context": f"{row_label} / U23", "is_adv": is_adv})
                entries.append({"col": "3歳~中学生", "price": prices[2][0], "context": f"{row_label} / 3歳~中学生", "is_adv": is_adv})
            elif len(prices) == 4 and any("ボックス" in h for h in headers):
                entries.append({"col": "ボックスシート", "price": prices[0][0], "context": "ビクトリーコーナーテラス ボックスシート", "is_adv": True})
                entries.append({"col": "ドームテントシート", "price": prices[1][0], "context": "ビクトリーコーナーテラス ドームテントシート", "is_adv": True})
                entries.append({"col": "パーティーテーブルシート", "price": prices[2][0], "context": "ビクトリーコーナーテラス パーティーテーブルシート", "is_adv": True})
                entries.append({"col": "フリーエリア", "price": prices[3][0], "context": "ビクトリーコーナーテラス フリーエリア", "is_adv": True})
            elif len(prices) == 2 and any("4輪" in h for h in headers) and any("2輪" in h for h in headers):
                is_adv = not any("当日" in h for h in headers)
                entries.append({"col": "4輪", "price": prices[0][0], "context": f"{'前売' if is_adv else '当日'}駐車券 / 4輪", "is_adv": is_adv})
                entries.append({"col": "2輪", "price": prices[1][0], "context": f"{'前売' if is_adv else '当日'}駐車券 / 2輪", "is_adv": is_adv})
        else:
            i += 1
    return entries


# ---------------------------------------------------------------------------
# 表記ゆれ吸収・トークン化
# ---------------------------------------------------------------------------
def clean_seat(name):
    """プレフィックス除去、限定条件抽出、人数・販促表記除去、半濁点吸収"""
    n = unicodedata.normalize("NFKC", name)
    # 半濁点ゆれ吸収: キャンフ -> キャンプ
    n = n.replace("キャンフ", "キャンプ")
    n = re.sub(r"^[A-Za-z0-9]+_", "", n)
    n = re.sub(r"\[要引換\]|【[^】]*】", "", n)
    limit = ""
    m = re.search(r"\[(.*?)限定\]", n)
    if m:
        limit = m.group(1).strip()
        n = re.sub(r"\[.*?\]", "", n)
    n = re.sub(r"\(\d+名\)", "", n)
    n = re.sub(r"\(販促\)", "", n)
    return n.strip(), limit


def resolve_target_page(row):
    """席種エリアコード・席種名から最適な掲載HPページを特定する"""
    seat_clean, limit = clean_seat(row["seat"])
    
    # 1. 限定駐車券の場合: limit の席種を扱っている個別ページを探す
    if limit:
        lim_norm = X.normalize(limit)
        best_p, best_s = None, 0
        for p in pages:
            if p["source_id"] in ("motegi_superbike_m_ticket", "motegi_superbike_m"):
                continue
            tn = X.normalize(p["title"])
            score = 10 if lim_norm in tn else 0
            if score > best_s:
                best_s, best_p = score, p["source_id"]
        if best_p:
            return best_p
            
    # 2. 席種名による個別ページのマッチング
    norm_seat = X.normalize(seat_clean)
    toks = [t for t in re.split(r"[\s/・()（）\[\]【】_]+", norm_seat) if len(t) >= 2]
    best_p, best_s = None, 0
    for p in pages:
        if p["source_id"] in ("motegi_superbike_m_ticket", "motegi_superbike_m", "motegi_superbike_m_ticket_about", "motegi_superbike_m_ticket_guide", "motegi_superbike_m_ticket_ticket"):
            continue
        tn = X.normalize(p["title"])
        txt_n = X.normalize(p["text"][:1000])
        score = sum(10 for t in toks if t not in ("観戦券", "指定区画券", "指定席", "エリア", "パス") and t in tn)
        score += sum(3 for t in toks if t not in ("観戦券", "指定区画券", "指定席", "エリア", "パス") and t in txt_n)
        for kw in ["KAWASAKI", "ASTEMO", "TATARA", "SUZUKI", "DUCATI", "DUNLOP", "SORA", "GRANDECK", "グランデッキ", "スカイデッキ", "ペアシート", "ビクトリーコーナーテラス", "S席", "VIPスイート", "エグゼクティブスイート", "VIPテラスプレミアム", "自由席", "パドックパス", "ピットウォーク"]:
            nkw = X.normalize(kw)
            if nkw in norm_seat:
                if nkw in tn: score += 15
                elif nkw in txt_n: score += 8
        if score > best_s:
            best_s, best_p = score, p["source_id"]
    if best_p and best_s >= 8:
        return best_p
        
    # 3. fallback: 対応表 mappings
    m = MAP.get(row["code"], {})
    return m.get("hp_source_id")


def get_ken_tokens(ken_name):
    """券種名からHP側の文脈一致ヒントトークンを生成"""
    norm = X.normalize(ken_name)
    hints = []
    if "大人" in norm:
        hints.extend(["大人", "24歳"])
    if "U23" in norm:
        hints.extend(["U23", "23歳", "高校生"])
    if "中学生" in norm or "子ども" in norm or "こども" in norm:
        hints.extend(["子ども", "こども", "小学生", "小・中学生", "3歳~中学生", "3歳～中学生", "中学生"])
    if "3歳以上共通" in norm:
        hints.extend(["3歳以上共通", "3歳以上", "共通", "1区画", "名分", "定員"])
    if "高校生以上" in norm:
        hints.extend(["高校生以上", "高校生"])
    return hints


def get_seat_tokens(seat_name, limit):
    """席種名から接尾辞を除去したコア単語トークン群を生成"""
    s_clean, _ = clean_seat(seat_name)
    raw_toks = [t.strip() for t in re.split(r"[\s/・()（）\[\]【】_]+", s_clean) if len(t.strip()) >= 2]
    toks = [X.normalize(t) for t in raw_toks]
    core_toks = []
    for t in toks:
        core = re.sub(r"(観戦券|指定区画券|指定席|エリア観戦券|エリア|パス|指定駐車券|駐車券)$", "", t)
        if len(core) >= 2:
            core_toks.append(core)
    return list(dict.fromkeys(toks + core_toks))


# ---------------------------------------------------------------------------
# HP価格決定エンジン（席種×券種 → 金額）
# ---------------------------------------------------------------------------
def resolve_hp_price(row):
    pid = resolve_target_page(row)
    if not pid:
        return None, "対応ページなし"
    page = pages_by_id.get(pid)
    if not page:
        return None, "ページデータなし"
    
    text = page["text"]
    seat_clean, limit = clean_seat(row["seat"])
    norm_seat = X.normalize(seat_clean)
    is_parking = "駐車券" in seat_clean or bool(limit)
    
    # 1. テーブル構造からのマッチング
    tbl_entries = extract_table_entries(text)
    if tbl_entries:
        ken_toks = get_ken_tokens(row["ken"])
        matched_tbl = []
        for te in tbl_entries:
            if not te.get("is_adv", True):
                continue
            col_norm = X.normalize(te["col"])
            ctx_norm = X.normalize(te["context"])
            
            if is_parking:
                if ("4輪" in seat_clean and "4輪" in col_norm) or ("2輪" in seat_clean and "2輪" in col_norm):
                    matched_tbl.append(te["price"])
            else:
                if tbl_entries[0]["col"] in ("大人", "U23", "3歳~中学生"):
                    # 年齢区分テーブル (大人, U23, 子ども)
                    k_ok = any(kt in col_norm or kt in ctx_norm for kt in ken_toks) if ken_toks else True
                    if k_ok:
                        matched_tbl.append(te["price"])
                else:
                    # 席種テーブル (ボックスシート等)
                    if col_norm in norm_seat:
                        matched_tbl.append(te["price"])
        if matched_tbl:
            vals = sorted(set(matched_tbl))
            if len(vals) == 1:
                return vals[0], "ok"
            else:
                return None, f"table複数候補: {vals}"

    # 2. extract_hp_prices による文脈＋近接マッチング
    cands = X.extract_hp_prices(text)
    if not cands:
        return None, "ページに価格なし"
    
    seat_toks = get_seat_tokens(row["seat"], limit)
    ken_toks = get_ken_tokens(row["ken"])
    
    hit_high = []
    hit_low = []
    lines = [unicodedata.normalize("NFKC", l).strip() for l in text.split("\n")]
    
    for it in cands:
        ctx = X.normalize(it["context"])
        p = it["price"]
        
        # 当日料金の除外（前売を探す）
        if "当日" in ctx and "前売" not in ctx:
            continue
            
        # 限定駐車券の場合
        if limit:
            p_seat_norm = X.normalize(seat_clean)
            kw = p_seat_norm.replace("駐車券", "")
            if (kw in ctx or "駐車券" in ctx) and ("当日" not in ctx):
                hit_high.append(it)
            continue
            
        # 一般席種の場合: 駐車券の金額を除外
        if not is_parking:
            if "駐車券" in ctx or "駐車" in ctx:
                continue
            
            # SORAサイトのワンちゃん同伴の区別
            if "ワンちゃん" in seat_clean:
                if "ワンちゃん" not in ctx:
                    continue
            else:
                if "ワンちゃん" in ctx:
                    continue
            
            # 席種名トークンが直接 context にあるか
            s_direct = any(st in ctx for st in seat_toks if len(st) >= 3 and st not in ("観戦券", "指定区画券", "指定席"))
            
            if s_direct:
                hit_high.append(it)
            else:
                title_norm = X.normalize(page["title"])
                if any(st in title_norm for st in seat_toks if len(st) >= 3 and st not in ("観戦券", "指定区画券", "指定席")):
                    hit_low.append(it)
            continue

        # 駐車券の場合
        if is_parking:
            if "S2指定駐車券" in seat_clean:
                if "S2" in ctx:
                    hit_high.append(it)
            elif "キャンプ" in seat_clean:
                # 直前6行以内の近接探索
                for li, line in enumerate(lines):
                    if str(p) in line or f"{p:,}" in line:
                        prev_chunk = " ".join(lines[max(0, li-6):li])
                        if "キャンプ" in prev_chunk:
                            hit_high.append(it)
                            break
            elif "4輪" in seat_clean and "4輪" in ctx:
                hit_high.append(it)
            elif "2輪" in seat_clean and "2輪" in ctx:
                hit_high.append(it)
            else:
                p_seat_norm = X.normalize(seat_clean)
                kw = p_seat_norm.replace("指定駐車券", "").replace("駐車券", "")
                if kw and kw in ctx:
                    hit_high.append(it)
            continue

    # 優先候補の評価
    target_hits = hit_high if hit_high else hit_low
    if not target_hits:
        return None, "HPに該当価格の記載なし"
    
    vals = sorted({x["price"] for x in target_hits})
    if len(vals) == 1:
        return vals[0], "ok"
    else:
        return None, f"複数の金額候補: {vals}"


# ---------------------------------------------------------------------------
# 集計とレポート出力
# ---------------------------------------------------------------------------
resolved = {}
reasons = collections.Counter()
results = []
for row in rows:
    p, why = resolve_hp_price(row)
    resolved[(row["code"], row["ken"])] = p
    reasons[why if p is not None else why] += 1
    results.append((row, p, why))

ok_rows = [r for r in rows if resolved[(r["code"], r["ken"])] is not None]
ng_rows = [r for r in rows if resolved[(r["code"], r["ken"])] is None]

print("=" * 78)
print("席種起点（改善版） 実データ JRR26 / 対象 %d通り" % len(rows))
print("=" * 78)
print()

# 1. 一意に決められた数と割合
print("## 1. HP価格を一意に決められた数と割合（主目的）")
print("   決められた数: %d / %d通り (%.1f%%)" % (len(ok_rows), len(rows), 100.0 * len(ok_rows) / len(rows)))
print()

# 2. 決められなかった理由の内訳
print("## 2. 決められなかった理由の内訳（未解決 %d件）" % len(ng_rows))
ng_reasons = collections.Counter()
for r in ng_rows:
    ng_reasons[results[rows.index(r)][2]] += 1
for k, c in ng_reasons.most_common():
    print("   %-36s %2d件 (%.1f%%)" % (k, c, 100.0 * c / len(rows)))
print("\n   [未解決の明細]")
for r in ng_rows:
    idx = rows.index(r)
    _, p, why = results[idx]
    print("      %-14s %-32s %-16s TSV: %5s円 | 理由: %s" % (
        r["code"], r["seat"][:32], r["ken"][:16], r["adv"], why
    ))
print()

# 3. TSV現在値との一致・不一致
fp = [(r, resolved[(r["code"], r["ken"])]) for r in ok_rows if int(r["adv"]) != resolved[(r["code"], r["ken"])]]
match_count = len(ok_rows) - len(fp)

print("## 3. 決められた分について、TSVの現在値と一致した数・しなかった数")
print("   HP価格を決められた %d通りのうち:" % len(ok_rows))
print("      一致した数   : %d件 (%.1f%%)" % (match_count, 100.0 * match_count / len(ok_rows)))
print("      一致しなかった: %d件 (%.1f%%)" % (len(fp), 100.0 * len(fp) / len(ok_rows)))
print()
if fp:
    print("   【一致しなかった案件（全件列挙）】")
    for r, hp_val in fp:
        print("   --------------------------------------------------------------------------")
        print("   席種コード: %s" % r["code"])
        print("   席種エリア名: %s" % r["seat"])
        print("   券種名    : %s" % r["ken"])
        print("   TSV前売価格: %s円" % f'{int(r["adv"]):,}')
        print("   HP記載価格 : %s円" % f'{hp_val:,}')
        print("   分析考察  :")
        if "S2指定駐車券" in r["seat"]:
            print("     ・本物の登録ミス（TSV側の価格設定誤り）の可能性:")
            print("       公式HPの駐車券ページでは「S2指定駐車券」は3,500円（数量限定）と明記されている。")
            print("       TSVで2,000円と登録されているのは、一般駐車券（2,000円）または限定S2駐車券（2,000円）の")
            print("       価格を誤ってS2指定駐車券に設定した可能性がある。")
            print("     ・対応付け（解釈）の相違の可能性:")
            print("       ビクトリーコーナーテラス購入者向け限定商品として「S2駐車券(2,000円)」が存在しており、")
            print("       TSVのこのコードがその限定枠を意図したものであった場合、名称の区別が不十分なための食い違い。")
print()

# 4. 改善率の比較
print("## 4. 改善率の比較（既存 injection_test_b.py との対比）")
print("   旧実装（injection_test_b.py）:  1 / 58通り ( 1.7% -> 2%)")
print("   新実装（seat_price_resolution.py）: %2d / 58通り (%5.1f%%)" % (
    len(ok_rows), 100.0 * len(ok_rows) / len(rows)
))
print("   向上幅: +%5.1fポイント（約 %d倍）" % (
    100.0 * len(ok_rows) / len(rows) - 1.7,
    round((100.0 * len(ok_rows) / len(rows)) / 1.7)
))
print()

# 5. 誤り注入テスト
print("## 【参考】誤りを注入したときの検出率（HP価格を決められた %d通りが分母）" % len(ok_rows))
random.seed(42)

def run_mutate(name, mutate):
    det = miss = 0
    for r in ok_rows:
        o = int(r["adv"]); b = mutate(o)
        if b is None or b == o:
            continue
        if b != resolved[(r["code"], r["ken"])]:
            det += 1
        else:
            miss += 1
    t = det + miss
    print("   %-30s 検出 %3d / %3d = %5.1f%%" % (name, det, t, 100 * det / max(1, t)))

run_mutate("桁間違い（×10）", lambda p: p * 10)
run_mutate("100円高い", lambda p: p + 100)
run_mutate("1,000円高い", lambda p: p + 1000)

others = [int(r["adv"]) for r in ok_rows]
det = miss = 0
for r in ok_rows:
    o = int(r["adv"]); cand = [p for p in others if p != o]
    if not cand:
        continue
    b = random.choice(cand)
    if b != resolved[(r["code"], r["ken"])]:
        det += 1
    else:
        miss += 1
print("   %-30s 検出 %3d / %3d = %5.1f%%" % ("他の席種の金額と取り違え", det, det + miss, 100 * det / max(1, det + miss)))
print("=" * 78)
