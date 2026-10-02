"""GAS版 不具合レポートのUIテスト。Code.gsの注入を再現し、google.script.runはスタブ。合成データのみ。
実行: python tests/bug_report_ui_test.py
"""
import json, re, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / "gas" / "index.html").read_text(encoding="utf-8")
inject = (ROOT / "gas" / "BugReport.html").read_text(encoding="utf-8").replace("__PAGE_MD5__", "testmd5")
m = re.search(r"<body[^>]*>", html, re.I)
page_html = html[: m.end()] + inject + html[m.end():]
lib_b64 = re.sub(r"\s+", "", (ROOT / "gas" / "Html2canvasB64.html").read_text(encoding="utf-8"))

STUB = """
window.__saved = null; window.__lastTried = null; window.__failSave = false; window.__libCalls = 0;
window.google = {script: {run: (function(){
  function mk(ok, ng){ return new Proxy({}, {get(_, name){
    if (name === 'withSuccessHandler') return fn => mk(fn, ng);
    if (name === 'withFailureHandler') return fn => mk(ok, fn);
    return (...args) => setTimeout(() => {
      if (name === 'getHtml2canvasSource') { window.__libCalls++; ok(%s); }
      else if (name === 'saveBugReport') {
        window.__lastTried = args[0]; if (window.__failSave) ng(new Error('stub failure'));
        else { window.__saved = args[0]; ok({ok:true, folderName:'20261003-000000_abcd', folderUrl:'https://drive.example/f'}); }
      } else ng(new Error('unexpected ' + name));
    }, 0);
  }}); }
  return mk(()=>{}, ()=>{});
})()}};
""" % json.dumps(lib_b64)

with tempfile.TemporaryDirectory() as td:
    f = Path(td) / "gas_page.html"
    f.write_text(page_html, encoding="utf-8")
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        pg = b.new_page(viewport={"width": 1280, "height": 800})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.add_init_script(STUB)
        pg.goto(f.as_uri()); pg.wait_for_load_state("networkidle")

        # ボタンがヘルプの隣に付き、リボンのタブ切替を壊さない
        assert pg.locator("#btn-bugreport").count() == 1
        pg.locator('.rb-tab[data-tab="home"]').click()
        assert pg.locator(".rb-tab-active").get_attribute("data-tab") == "home"

        pg.evaluate("""() => { state.headers=['a','b']; state.data=[['1','2'],['3','4']]; state.selected={row:1,col:0}; state.fileName='t.tsv';
          state.hiddenRows = new Set([0]); console.error('synthetic-error'); }""")
        before = pg.evaluate("JSON.stringify(state.data)")

        pg.locator("#btn-bugreport").click()
        pg.locator("#_br-ov.open").wait_for(timeout=30000)
        assert "取得済み" in pg.locator("#_br-shot-status").inner_text(), pg.locator("#_br-shot-status").inner_text()
        assert pg.locator("#_br-shot-img").evaluate("e => e.naturalWidth") > 100

        # モーダル内の入力がアプリのセルを書き換えない
        pg.locator("#_br-comment").click()
        pg.keyboard.type("abc 日本語 123")
        pg.keyboard.press("Control+a"); pg.keyboard.press("Delete")
        pg.keyboard.type("フィルター中にF4で壊れた")
        assert pg.evaluate("JSON.stringify(state.data)") == before

        pg.locator("#_br-kind").select_option("data")
        pg.locator("#_br-send").click()
        pg.locator("#_br-msg.ok").wait_for()
        s = pg.evaluate("window.__saved")
        r = s["report"]
        assert r["schema"] == "tsv_editor_bug_report/1" and r["kind"] == "data"
        assert r["comment"] == "フィルター中にF4で壊れた"
        assert r["app"]["page_md5"] == "testmd5"
        assert r["app"]["table"]["rows"] == 2 and r["app"]["table"]["fileName"] == "t.tsv"
        assert r["app"]["state"]["selected"] == {"row": 1, "col": 0}
        assert r["app"]["state"]["hiddenRows"]["$set"] == 1
        assert "data" not in r["app"]["state"] and "undoStack" not in r["app"]["state"]
        assert r["app"]["near_selection"]["rows"][1] == ["3", "4"]
        assert any("synthetic-error" in l["msg"] for l in r["logs"])
        assert any(e["type"] == "click" for e in r["events"])
        # 入力した文字は操作ログに残らない
        assert not any(e["type"] == "key" and e["target"] in ("a", "b", "c", "日") for e in r["events"])
        assert s["screenshot"]["mime"] in ("image/png", "image/jpeg") and len(s["screenshot"]["b64"]) > 1000
        assert s["tsv"].splitlines() == ["a\tb", "1\t2", "3\t4"]
        assert r["attachments"]["table_included"] and r["attachments"]["screenshot_included"]
        assert "folderName" not in json.dumps(s)  # サーバー側で決める値をクライアントが送らない

        # 2回目: ライブラリは再取得しない / 表を外す / 失敗時はDLボタンが出る
        pg.locator("#_br-cancel").click()
        pg.evaluate("window.__failSave = true")
        pg.keyboard.press("Control+Alt+b")
        pg.locator("#_br-ov.open").wait_for(timeout=30000)
        assert pg.evaluate("window.__libCalls") == 1
        pg.locator("#_br-use-table").uncheck()
        pg.locator("#_br-send").click()
        pg.locator("#_br-msg.err").wait_for()
        assert pg.locator("#_br-dl").is_visible()
        # 表チェックを外した送信には、セル内容(選択周辺・data.tsv)が一切含まれない
        s2 = pg.evaluate("window.__lastTried")
        assert s2["tsv"] is None and s2["report"]["app"]["near_selection"] is None
        assert '"3"' not in json.dumps(s2["report"]["app"]) and "synthetic" not in json.dumps(s2["report"]["app"])
        pg.keyboard.press("Escape")
        assert pg.locator("#_br-ov.open").count() == 0

        assert not errs, errs
        b.close()
print("bug_report_ui: ボタン・スクショ・状態採取・入力隔離・送信・失敗時フォールバック すべて成功")
