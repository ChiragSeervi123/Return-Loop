"""Rebuild the QR code on the /docs cover, which opens the live app when scanned.

    python tools/make_qr.py       # needs: pip install segno

Writes templates/diagrams/qr_live.svg for config.PUBLIC_URL. Run it again if that URL changes,
then rebuild the PDFs (tools/make_pdfs.py).
"""
import pathlib
import sys

import segno

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from config import PUBLIC_URL  # noqa: E402


def main():
    out = ROOT / "templates" / "diagrams" / "qr_live.svg"
    # Level Q survives a smudged or creased printout; the 4-module quiet zone is what scanners expect.
    qr = segno.make(PUBLIC_URL, error="q")
    qr.save(str(out), kind="svg", xmldecl=False, omitsize=True, border=4,
            dark="#14110F", light="#FFFFFF", svgclass="doc-qr__code", lineclass=None,
            title=f"QR code: {PUBLIC_URL}")
    print("wrote", out.relative_to(ROOT), "for", PUBLIC_URL)


if __name__ == "__main__":
    main()
