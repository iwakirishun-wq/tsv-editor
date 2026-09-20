"""保存前差分表示のブラウザ回帰テスト。実行: python tests/save_diff_ui_test.py"""

from pathlib import Path

from playwright.sync_api import sync_playwright


INDEX = Path(__file__).resolve().parents[1] / "index.html"
HEADERS = "tenant_cd\tclub_cd\tseat_type_area_cd\tgrp_nm\tvalue\n"


def load(page, rows):
    page.goto(INDEX.as_uri())
    page.wait_for_load_state("networkidle")
    page.locator("#file-input").set_input_files(
        {
            "name": "save_diff_synthetic.tsv",
            "mimeType": "text/tab-separated-values",
            "buffer": (HEADERS + rows).encode("utf-8"),
        }
    )
    page.wait_for_function("state.data.length === 2")


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    try:
        load(page, "1\tC\tS1\tA\told\n1\tC\tS2\tB\told\n")
        result = page.evaluate("""() => {
          state.data[1][4] = 'changed';
          return buildSaveDiff();
        }""")
        assert (result["added"], result["removed"], result["changed"]) == (0, 0, 1)
        assert result["byGroup"] == [
            {"group": "B", "added": 0, "removed": 0, "changed": 1}
        ]

        load(page, "1\tC\tS1\tA\told\n1\tC\tS2\tB\told\n")
        page.evaluate("""() => {
          state.filteredIndices = [0];
          void doSaveFile();
        }""")
        page.locator("._ss-filtered").click()
        page.locator("._save-diff-ov").wait_for()
        assert "削除 1" in page.locator("._save-diff-ov").inner_text()
        page.locator("._sd-cancel").click()

        load(page, "1\tC\tS1\tA\told\n1\tC\tS1\tA\told\n")
        page.evaluate("void doSaveFile()")
        page.locator("._save-diff-ov").wait_for()
        assert "キーが重複" in page.locator("._save-diff-ov").inner_text()
        page.locator("._sd-cancel").click()

        load(page, "1\tC\tS1\tA\told\n1\tC\tS2\tB\told\n")
        page.evaluate("""() => {
          state.headers.push('new_column');
          state.data.forEach((row) => row.push(''));
          void doSaveFile();
        }""")
        page.locator("._save-diff-ov").wait_for()
        assert "追加された列" in page.locator("._save-diff-ov").inner_text()
        page.locator("._sd-cancel").click()
        print("save diff UI: 4 scenarios passed")
    finally:
        browser.close()
