# mini_server.py — minimaler lokaler HTTP‑Server ohne externe Dependencies
# Endpoints:
#   GET  /health             -> {"ok": true}
#   POST /scan               -> Body: {"root": "F:\\AI\\ComfyUI", "output": "optional\\catalog.json"}
#                               ruft main.scan() auf und liefert den Katalog als JSON zurück

from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from urllib.parse import urlparse
from datetime import datetime, timezone
from pathlib import Path
import importlib
import sys

# Dein bestehender Scanner aus main.py
scanner = importlib.import_module("main")


def make_catalog(root: Path):
    items = scanner.scan(root)
    return {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "root_id": "default",
        "comfyui_root": str(root).replace("\\", "/"),
        "items": items,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "ComfyDashMini/1.0"

    def _set_headers(self, status: int = 200, content_type: str = "application/json") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        # CORS für das Frontend (http://localhost:5173)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802 (PowerShell-style name)
        self._set_headers(204)

    def do_GET(self) -> None:  # noqa: N802
        p = urlparse(self.path).path
        if p == "/health":
            self._set_headers(200)
            self.wfile.write(json.dumps({"ok": True}).encode("utf-8"))
        else:
            self._set_headers(404)
            self.wfile.write(json.dumps({"error": "not found"}).encode("utf-8"))

    def do_POST(self) -> None:  # noqa: N802
        p = urlparse(self.path).path
        if p != "/scan":
            self._set_headers(404)
            self.wfile.write(json.dumps({"error": "not found"}).encode("utf-8"))
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length) if length > 0 else b"{}"
            data = json.loads(body.decode("utf-8") or "{}")

            root = Path(data.get("root", "")).resolve()
            output = data.get("output")
            if not root.exists():
                self._set_headers(400)
                self.wfile.write(json.dumps({"ok": False, "error": f"Root does not exist: {root}"}).encode("utf-8"))
                return

            catalog = make_catalog(root)

            if output:
                out = Path(output)
                out.parent.mkdir(parents=True, exist_ok=True)
                with out.open("w", encoding="utf-8") as f:
                    json.dump(catalog, f, ensure_ascii=False, indent=2)

            self._set_headers(200)
            self.wfile.write(json.dumps(catalog).encode("utf-8"))
        except Exception as e:  # pylint: disable=broad-except
            self._set_headers(500)
            self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode("utf-8"))


def main() -> None:
    host = "127.0.0.1"
    port = 8000

    argv = sys.argv[1:]
    for i, a in enumerate(argv):
        if a == "--host" and i + 1 < len(argv):
            host = argv[i + 1]
        if a == "--port" and i + 1 < len(argv):
            port = int(argv[i + 1])

    httpd = HTTPServer((host, port), Handler)
    print(f"ComfyDash mini server listening on http://{host}:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    httpd.server_close()


if __name__ == "__main__":
    main()
