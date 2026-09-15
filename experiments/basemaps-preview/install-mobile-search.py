from __future__ import annotations

import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def require(path: Path) -> Path:
    if not path.is_file():
        raise RuntimeError(f"Falta archivo requerido: {path}")
    return path


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Uso: install-mobile-search.py <deploy-dir>")

    deploy = Path(sys.argv[1]).resolve()
    index = require(deploy / "index.php")
    js_source = require(HERE / "mobile-search-menu.js")
    css_source = require(HERE / "mobile-search-menu.css")

    shutil.copy2(js_source, deploy / "mobile-search-menu.js")
    shutil.copy2(css_source, deploy / "mobile-search-menu.css")

    text = index.read_text(encoding="utf-8")

    css_tag = '  <link rel="stylesheet" href="./mobile-search-menu.css?v=1" />\n'
    js_tag = '  <script src="./mobile-search-menu.js?v=1"></script>\n'

    if "mobile-search-menu.css" not in text:
        if "</head>" not in text:
            raise RuntimeError("No se encontro </head> en index.php")
        text = text.replace("</head>", css_tag + "</head>", 1)

    if "mobile-search-menu.js" not in text:
        if "</body>" not in text:
            raise RuntimeError("No se encontro </body> en index.php")
        text = text.replace("</body>", js_tag + "</body>", 1)

    index.write_text(text, encoding="utf-8")

    verify = index.read_text(encoding="utf-8")
    for needle in ("mobile-search-menu.css?v=1", "mobile-search-menu.js?v=1"):
        if needle not in verify:
            raise RuntimeError(f"No se pudo instalar {needle}")

    print("Menu movil de busqueda instalado en", deploy)


if __name__ == "__main__":
    main()
