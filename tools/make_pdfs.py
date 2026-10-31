"""Rebuild the two PDFs from a running app: the documentation (A4) and the presentation (slides).

    python app.py                 # in one terminal (or any URL via --base)
    python tools/make_pdfs.py     # in another; needs: pip install playwright && playwright install chromium

Writes static/docs/ReturnLoop-Documentation.pdf (the /docs "Download PDF" button)
and docs/ReturnLoop-presentation.pdf. tools/refresh_docs.py runs this too.
"""
import argparse
import pathlib

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
FOOTER = ('<div style="width:100%;font:8px monospace;color:#6B6A66;letter-spacing:1px;padding:0 14mm;'
          'display:flex;justify-content:space-between"><span>RETURNLOOP · REQUIREMENTS &amp; DESIGN</span>'
          '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>')


def launch(p):
    """Playwright's bundled Chromium, else an installed Edge or Chrome."""
    for channel in (None, "msedge", "chrome"):
        try:
            return p.chromium.launch(channel=channel) if channel else p.chromium.launch()
        except Exception:
            continue
    raise SystemExit("No browser found: run `playwright install chromium`.")


def build(base, browser):
    """Print /docs to A4 and /ppt to slide-size pages."""
    page = browser.new_page(viewport={"width": 1440, "height": 1000})

    page.goto(f"{base}/docs", wait_until="networkidle")
    page.emulate_media(media="print")
    out = ROOT / "static" / "docs" / "ReturnLoop-Documentation.pdf"
    page.pdf(path=str(out), prefer_css_page_size=True, print_background=True,
             display_header_footer=True, header_template="<div></div>", footer_template=FOOTER)
    print("wrote", out.relative_to(ROOT))

    page.emulate_media(media="screen")
    page.goto(f"{base}/ppt")
    page.wait_for_function("document.querySelectorAll('.deck pre.mermaid svg').length >= 5", timeout=120000)
    page.emulate_media(media="print")
    out = ROOT / "docs" / "ReturnLoop-presentation.pdf"
    page.pdf(path=str(out), prefer_css_page_size=True, print_background=True)
    print("wrote", out.relative_to(ROOT))
    page.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:5000")
    base = ap.parse_args().base.rstrip("/")
    with sync_playwright() as p:
        browser = launch(p)
        build(base, browser)
        browser.close()


if __name__ == "__main__":
    main()
