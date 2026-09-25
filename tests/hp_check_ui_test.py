"""HP button error feedback and success paths; only synthetic data/server mocks."""
from pathlib import Path
from playwright.sync_api import sync_playwright

INDEX = Path(__file__).resolve().parents[1] / "index.html"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        page.goto(INDEX.as_uri())
        page.wait_for_load_state("networkidle")
        page.locator("#btn-hp-check").click()
        page.locator("._hp-notice-ov").wait_for(timeout=3000)
        assert "対象外" in page.locator("._hp-notice-ov").inner_text()
        page.locator("._hp-notice-close").click()
        page.evaluate("""() => {
          state.headers = ['販売開始日時', '前売価格'];
          state.data = [['2026/09/01 10:00', '1000']];
          window.google = {script: {run: {
            withSuccessHandler(fn) { this.ok = fn; return this; },
            withFailureHandler(fn) { return this; },
            listHpEvents() { this.ok({error: 'HP_KNOWLEDGE_FILE_ID が未設定です'}); }
          }}};
        }""")
        page.locator("#btn-hp-check").dispatch_event("click")
        page.locator("._hp-notice-ov").wait_for()
        assert "HP_KNOWLEDGE_FILE_ID" in page.locator("._hp-notice-ov").inner_text()
        page.locator("._hp-notice-close").click()
        assert page.locator("#btn-hp-check").is_enabled()
        assert page.locator("#btn-hp-check .rb-icon svg").count() == 1
        assert page.locator("#btn-hp-check span:not(.rb-icon)").inner_text() == "HP突合"
        page.evaluate("""() => {
          state.headers = ['seat_type_area_cd', 'seat_type_area_control_nm', 'nte', 'grp_nm'];
          state.data = [['S1', 'A席', '注意事項', 'G'], ['S2', 'B席', '', 'G']];
          state.forceRender = true;
        }""")
        page.on("dialog", lambda d: d.dismiss())
        page.locator("#btn-hp-check").dispatch_event("click")
        page.locator("._hp-res-ov").wait_for()
        assert "HPナレッジ無し" in page.locator("._hp-res-ov").inner_text()
        assert "B席" in page.locator("._hp-res-ov").inner_text()
        page.locator("._hp-close").click()
        page.evaluate("""() => {
          state.headers = ['販売開始日時', '前売価格'];
          state.data = [['2026/09/01 10:00', '1000']];
          state.forceRender = true;
          google.script.run.listHpEvents = function() {
            const ok = this.ok;
            setTimeout(() => ok([{key: 'test', label: 'テストイベント'}]), 100);
          };
          google.script.run.getHpKnowledge = function() {
            this.ok({schema: 'hp_price_knowledge/1', event_key: 'test', label: 'テストイベント', items: []});
          };
        }""")
        page.locator("#btn-hp-check").click()
        page.locator("._hp-res-ov").wait_for()
        assert "テストイベント" in page.locator("._hp-res-ov").inner_text()
        assert errors == [], errors
        print("HP UI: 4 scenarios passed (unsupported file, GAS error, notes, GAS success)")
    finally:
        browser.close()
