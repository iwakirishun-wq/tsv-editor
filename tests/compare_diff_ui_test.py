"""TSV差分比較ダイアログのブラウザ回帰テスト。実行: python tests/compare_diff_ui_test.py"""
from pathlib import Path
from playwright.sync_api import sync_playwright

INDEX = Path(__file__).resolve().parents[1] / "index.html"
H = "tenant_cd\tclub_cd\tseat_type_area_cd\tgrp_nm\tprice\tupdate_dt\n"
BASE = H + "1\tC\tS1\tA\t1000\t2026-01-01\n1\tC\tS2\tB\t2000\t2026-01-01\n1\tC\tS3\tC\t3000\t2026-01-01\n"
CUR = H + "1\tC\tS1\tA\t1200\t2026-11-01\n1\tC\tS2\tB\t2000\t2026-11-01\n1\tC\tS4\tD\t4000\t2026-11-01\n"
fails = []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        fails.append(name)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    page = b.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(INDEX.as_uri())
    page.wait_for_load_state("networkidle")
    page.locator("#file-input").set_input_files({"name": "cur.tsv", "mimeType": "text/tab-separated-values", "buffer": CUR.encode()})
    page.wait_for_function("state.data.length === 3")
    page.evaluate("window.TsvCompare.open({getCurrentTab:()=>null})")
    page.locator("#cmp-file-base").set_input_files({"name": "base.tsv", "mimeType": "text/tab-separated-values", "buffer": BASE.encode()})
    page.locator("#cmp-file-cur").set_input_files({"name": "cur.tsv", "mimeType": "text/tab-separated-values", "buffer": CUR.encode()})
    page.wait_for_function("document.getElementById('cmp-name-cur').textContent==='cur.tsv'")
    page.click("#cmp-run-btn")
    s = page.inner_text("#cmp-summary")
    check("summary counts", "追加 1行" in s and "削除 1行" in s and "変更 1行" in s and "変更なし 1行" in s)
    check("audit col ignored", "update_dt" not in page.inner_text("#cmp-by-col"))
    check("price col listed", "price (1)" in page.inner_text("#cmp-by-col"))
    check("4 rows shown", page.locator("#cmp-tbody tr").count() == 4)
    check("char diff bold", page.locator("#cmp-tbody .cmp-val-after strong").count() >= 1)
    page.click('[data-status="added"]')
    check("filter added", page.locator("#cmp-tbody tr").count() == 1)
    # open tab as 'cur'
    page.evaluate("window.TsvCompare.open({getCurrentTab:()=>({fileName:'tab.tsv',text:%r,delim:'\t'})})" % CUR)
    # real tab via button
    page.keyboard.press("Escape")
    check("esc closes", page.locator("#cmp-overlay").is_hidden())
    page.click('.rb-tab[data-tab="file"]')
    page.click("#btn-compare")
    check("tab button shown", page.locator("#cmp-tab-cur").is_visible())
    page.click("#cmp-tab-base")
    check("tab text loaded", page.inner_text("#cmp-name-base") == "cur.tsv")
    page.click("#cmp-tab-cur")
    page.click("#cmp-run-btn")
    check("tab vs tab no diff", "変更 0行" in page.inner_text("#cmp-summary") and "追加 0行" in page.inner_text("#cmp-summary"))
    check("no page errors", not errs)
    b.close()
raise SystemExit(1 if fails else 0)
