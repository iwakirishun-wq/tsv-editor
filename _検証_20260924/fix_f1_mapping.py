# -*- coding: utf-8 -*-
"""27F1 の対応表（席種エリアコード → HPページ）を席種名から素直に作り直す。

自動ドラフトは名称トークン＋価格一致で推定するため、A1席が family_seat に割り当たるなど
明らかな誤りが混ざっていた。F1は席種名の先頭に席のアルファベットが入る規則性があるので、
そこを使ったほうが確実。status は auto のままにして、人のレビューが要ることは変えない。
"""
import sys, re, pathlib, collections
sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

PC = pathlib.Path("C:/Users/test/MAIN/30_WORK/01_\u958b\u767a\u30d7\u30ed\u30b8\u30a7\u30af\u30c8/price_crosscheck")
MAP = PC / "mappings" / "F1_27_mapping.tsv"
APPLY = "--apply" in sys.argv

# 席種名に出る手掛かり → HPページ。上から順に当てる（先に書いたものが優先）
RULES = [
    (r"ﾊﾟﾄﾞｯｸ|パドック|Paddock", "suzuka_f1_2027_paddock_club"),
    (r"VIP", "suzuka_f1_2027_vip_suite"),
    (r"R-?BOX", "suzuka_f1_2027_r_box"),
    (r"S-?BOX|ﾌｧﾐﾘｰ|ファミリー", "suzuka_f1_2027_family_seat"),
    (r"GRAN\s*VIEW|ｸﾞﾗﾝﾋﾞｭｰ|グランビュー", "suzuka_f1_2027_wheel"),
    (r"Ferris|ﾌｪﾘｽ|観覧車", "suzuka_f1_2027_wheel"),
    (r"ｶﾒﾗﾏﾝ|カメラマン", "suzuka_f1_2027_cameraman_seat"),
    (r"西ｴﾘｱ|西エリア", "suzuka_f1_2027_west_seat"),
    (r"駐車", "suzuka_f1_2027_reserve_parking"),
    (r"^A1", "suzuka_f1_2027_seat_a1"), (r"^A2", "suzuka_f1_2027_seat_a2"),
    (r"^B1", "suzuka_f1_2027_seat_b1"), (r"^B2", "suzuka_f1_2027_seat_b2"),
    (r"^C", "suzuka_f1_2027_seat_c"),   (r"^D", "suzuka_f1_2027_seat_d"),
    (r"^E", "suzuka_f1_2027_seat_e"),   (r"^G", "suzuka_f1_2027_seat_g"),
    (r"^H", "suzuka_f1_2027_seat_h"),   (r"^I", "suzuka_f1_2027_seat_i"),
    (r"^M", "suzuka_f1_2027_seat_m"),   (r"^O", "suzuka_f1_2027_seat_o"),
    (r"^P", "suzuka_f1_2027_seat_p"),
    (r"^Q1", "suzuka_f1_2027_seat_q1"), (r"^Q2", "suzuka_f1_2027_seat_q2"),
    (r"^R", "suzuka_f1_2027_seat_r"),
    (r"^V1", "suzuka_f1_2027_seat_v1"), (r"^V2", "suzuka_f1_2027_seat_v2"),
]

def page_for(name):
    n = re.sub(r"^[A-Za-z0-9]+_", "", str(name))          # F1_ を外す
    n = re.sub(r"\u3010[^\u3011]*\u3011", "", n).strip()   # 【未定席種】等
    for pat, page in RULES:
        if re.search(pat, n, re.I):
            return page
    return ""

t = MAP.read_text(encoding="utf-8-sig").replace("\r\n", "\n")
L = [l for l in t.split("\n") if l.strip()]
h = L[0].split("\t")
ci, ni, hi, si = h.index("\u5e2d\u7a2e\u30a8\u30ea\u30a2\u30b3\u30fc\u30c9"), h.index("\u5e2d\u7a2e\u540d"), h.index("hp_source_id"), h.index("status")
rows = [l.split("\t") for l in L[1:]]

changed, same, none = [], 0, 0
for r in rows:
    new = page_for(r[ni])
    if not new:
        none += 1
        continue
    if r[hi].strip() != new:
        changed.append((r[ci], r[ni], r[hi], new))
        r[hi] = new
    else:
        same += 1

print("\u5bfe\u5fdc\u8868 %d\u884c" % len(rows))
print("  \u5909\u3048\u306a\u3044(\u5143\u304b\u3089\u6b63\u3057\u3044): %d" % same)
print("  \u5f53\u3066\u76f4\u3059            : %d" % len(changed))
print("  \u898f\u5247\u306b\u5f53\u305f\u3089\u306a\u3044      : %d" % none)
print()
print("--- \u5f53\u3066\u76f4\u3057\u306e\u4f8b\uff08\u5148\u982d20\uff09---")
for c, n, o, w in changed[:20]:
    print("  %-13s %-32s %-30s -> %s" % (c, n[:32], (o or "(\u306a\u3057)")[:30], w))
print()
by = collections.Counter(r[hi] for r in rows if r[hi].strip())
print("--- \u30da\u30fc\u30b8\u5225\u306e\u5272\u5f53\u4ef6\u6570 ---")
for k, v in by.most_common():
    print("  %-34s %3d" % (k, v))

if not APPLY:
    print()
    print("*** \u78ba\u8a8d\u306e\u307f\u3002\u9069\u7528\u306f --apply ***")
    raise SystemExit

import shutil, datetime
bk = MAP.with_name(MAP.name + ".bak_" + datetime.datetime.now().strftime("%Y%m%d_%H%M%S"))
shutil.copy2(MAP, bk)
MAP.write_text("\t".join(h) + "\n" + "\n".join("\t".join(r) for r in rows) + "\n", encoding="utf-8-sig")
print()
print("\u30d0\u30c3\u30af\u30a2\u30c3\u30d7:", bk.name)
print("\u66f4\u65b0:", MAP.name)
