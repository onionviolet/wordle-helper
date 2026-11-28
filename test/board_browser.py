"""Exercise the board in a clean browser session. Pass a URL to check a deployment."""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import expect, sync_playwright


def check(browser, url, width):
    page = browser.new_page(viewport={"width": width, "height": 860})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(url)
    loc = page.locator

    def guess(word):
        loc("#guess-input").fill(word)
        loc("#guess-input").press("Enter")

    guess("crane 20000")
    guess("climb")
    expect(loc("#summary h2")).to_have_text("0 possible words")
    loc("#tile-1-0").click()
    expect(loc(".check-color")).to_have_count(0)
    loc("#tile-1-0").click()
    page.wait_for_timeout(800)
    expect(loc("#summary .count")).to_be_attached()
    expect(loc(".check-color")).to_have_count(0)
    loc("#tile-1-0").click()
    expect(loc(".check-color")).to_have_count(0)
    expect(loc(".check-color")).to_have_count(1)
    loc("#tile-1-0").click()
    loc("#tile-1-0").click()

    loc("#quick summary").click()
    expect(loc("#correct-0")).to_have_value("")
    expect(loc("#input-absent")).to_have_value("")
    loc("#from-correct a").first.click()
    expect(loc("#tile-0-0")).to_be_focused()
    loc('#from-absent a[href="#tile-0-1"]').click()
    expect(loc("#tile-0-1")).to_be_focused()
    page.keyboard.press("Space")
    expect(loc('#from-present a[href="#tile-0-1"]')).to_have_text("R")
    loc("#from-present a").first.click()
    expect(loc("#tile-0-1")).to_be_focused()
    page.keyboard.press("Space")
    page.keyboard.press("Space")

    count = loc("#summary .count").text_content()
    loc("#input-present").fill("o")
    filtered = loc("#summary .count").text_content()
    assert filtered != count
    loc("#input-present").fill("")
    expect(loc("#summary .count")).to_have_text(count)
    loc("#input-present").fill("o")
    before = loc(".tile").evaluate_all("(els) => els.map(el => el.getAttribute('aria-label'))")
    loc("#clear").click()
    expect(loc(".tile")).to_have_count(0)
    expect(loc("#input-present")).to_have_value("")
    loc("#undo-clear").click()
    page.reload()
    expect(loc("#input-present")).to_have_value("o")
    expect(loc("#summary .count")).to_have_text(filtered)
    assert loc(".tile").evaluate_all("(els) => els.map(el => el.getAttribute('aria-label'))") == before
    loc("#clear").click()
    guess("geese 02000")
    expect(loc("#undo-clear")).to_be_hidden()
    assert "E" not in loc("#from-absent").text_content()
    assert not errors, errors
    page.close()
    print(f"{width}px passed")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        url = sys.argv[1]
    else:
        root = Path(__file__).resolve().parents[1]
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=root))
        Thread(target=server.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{server.server_port}"
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel=os.environ.get("BROWSER_CHANNEL"))
        for width in (1280, 390):
            check(browser, url, width)
