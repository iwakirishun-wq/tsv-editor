"""Header comment focus and grid isolation regression tests."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    try:
        for name in ("index.html", "gas/index.html"):
            page = browser.new_page()
            page.goto((ROOT / name).as_uri())
            page.wait_for_load_state("networkidle")
            page.locator("#file-input").set_input_files({
                "name": "synthetic.tsv", "mimeType": "text/tab-separated-values",
                "buffer": b"grp_nm\tvalue\nA\told\nB\told\n",
            })
            page.wait_for_function("state.data.length === 2")
            original = page.evaluate("JSON.stringify(state.data)")
            page.locator("td[data-col]").first.click()
            page.locator("th[data-col]").first.dblclick()
            assert page.evaluate("document.activeElement.tagName") == "TEXTAREA"
            page.keyboard.press("Control+a")
            page.keyboard.type("new")
            page.keyboard.press("Enter")
            page.keyboard.insert_text("日本語メモ")
            assert page.locator("._comment-edit-area").input_value() == "new\n日本語メモ"
            page.locator("._comment-save").click()
            assert page.evaluate("state.headerComments.grp_nm") == "new\n日本語メモ"
            page.locator("th[data-col]").first.dblclick()
            assert page.locator("._comment-edit-area").input_value() == "new\n日本語メモ"
            page.locator("._comment-cancel").click()
            page.evaluate("openDictEditor()")
            page.locator("#dict-new-key").click()
            page.keyboard.type("new_column")
            assert page.locator("#dict-new-key").input_value() == "new_column"
            page.locator("#dict-add-btn").click()
            display = page.locator('input[data-dict-key="new_column"]')
            page.keyboard.type("New display")
            assert display.input_value() == "New display"
            page.keyboard.press("Tab")
            page.keyboard.type("New comment")
            page.keyboard.press("Enter")
            page.keyboard.type("second line")
            page.locator("#dict-save-btn").click()
            assert page.evaluate("state.headerComments.new_column") == "New comment\nsecond line"
            assert page.evaluate("JSON.stringify(state.data)") == original
            # Mouse selection and keyboard movement both update the formula bar.
            page.locator('tr[data-row="1"] td[data-col="0"]').click()
            assert page.locator("#fbar-val").input_value() == "B"
            page.keyboard.press("ArrowUp")
            assert page.locator("#fbar-val").input_value() == "A"
            page.locator('tr[data-row="1"] td[data-col="0"]').dblclick()
            page.keyboard.press("Control+a")
            page.keyboard.type("changed")
            page.keyboard.press("Enter")
            assert page.evaluate("state.data[1][0]") == "changed"
            print(name + ": comment/dictionary input, persistence, mouse/keyboard selection and cell editing passed")
            page.close()
    finally:
        browser.close()
