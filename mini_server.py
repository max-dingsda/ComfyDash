# mini_server.py — ComfyDash Mini-API (v1.1)
# Features
# - GET  /health  -> { ok, ts, host, port }
# - POST /scan    -> body { root, output? } -> { ok, data, warning? }
# - CORS + OPTIONS support
# - Robust scanner invocation: import main.scan(...) OR CLI fallback
# - **Auto-port selection**: tries desired port (default 8000), then 8001..8019
#   unless --strict is provided (then it fails instead of bumping).

from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse
from datetime import datetime, timezone
from pathlib import Path
import json
import sys
import importlib
import subprocess
import socket
import importlib.util
import hashlib
import urllib.request
import time
from pathlib import Path

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000
AUTO_PORT_MAX_TRIES = 20  # 8000..8019

# will be set in main()
SELECTED_HOST = DEFAULT_HOST
SELECTED_PORT = DEFAULT_PORT


def iso_now():
    return datetime.now(timezone.utc).isoformat()


def json_bytes(obj):
    return json.dumps(obj, ensure_ascii=False).encode("utf-8")


def write_file(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

def _load_scanner_module():
    base_dir = Path(__file__).resolve().parent
    scanner_py = (base_dir / "Scanner" / "main.py").resolve()
    if not scanner_py.exists():
        raise RuntimeError(f"Scanner file not found: {scanner_py}")
    spec = importlib.util.spec_from_file_location("comfydash_scanner", str(scanner_py))
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot create import spec for {scanner_py}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[attr-defined]
    return mod, scanner_py


def call_scanner_via_import(root: Path, output: Path | None):
    mod, _ = _load_scanner_module()
    for fn_name in ("scan", "run_scan", "do_scan"):
        fn = getattr(mod, fn_name, None)
        if fn is None: 
            continue
        try:
            return fn(str(root), str(output) if output else None)
        except TypeError:
            return fn(str(root))
    raise RuntimeError("No suitable scan function found in Scanner/main.py (expected scan/run_scan/do_scan).")


def call_scanner_via_cli(root: Path, output: Path | None):
    _, scanner_py = _load_scanner_module()
    cmd = [sys.executable, str(scanner_py), "--root", str(root), "--stdout"]
    if output is not None:
        cmd += ["--output", str(output)]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return json.loads(proc.stdout)


def calculate_file_hash(filepath: Path, algorithm='sha256', chunk_size=8192):
    """Calculate hash of a file."""
    hasher = hashlib.new(algorithm)
    with open(filepath, 'rb') as f:
        while chunk := f.read(chunk_size):
            hasher.update(chunk)
    return hasher.hexdigest().upper()


def query_civitai_by_hash(file_hash: str):
    """Query CivitAI API by file hash."""
    url = f"https://civitai.com/api/v1/model-versions/by-hash/{file_hash}"
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            data = json.loads(response.read())
            return {
                'found': True,
                'model_id': data.get('modelId'),
                'model_name': data.get('model', {}).get('name'),
                'version_name': data.get('name'),
                'url': f"https://civitai.com/models/{data.get('modelId')}",
                'trained_words': data.get('trainedWords', []),
                'base_model': data.get('baseModel'),
            }
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {'found': False, 'error': 'Not found on CivitAI'}
        return {'found': False, 'error': f'HTTP {e.code}'}
    except Exception as e:
        return {'found': False, 'error': str(e)}


class Handler(BaseHTTPRequestHandler):
    server_version = "ComfyDashMini/1.1"

    # --- CORS helpers ---
    def _set_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self._set_cors()
        self.end_headers()

    # --- Utility ---
    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception as e:
            raise ValueError(f"Invalid JSON body: {e}")

    def _send_json(self, obj, status=200):
        payload = json_bytes(obj)
        self.send_response(status)
        self._set_cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    # --- Routes ---
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            return self._send_json({
                "ok": True,
                "ts": iso_now(),
                "host": SELECTED_HOST,
                "port": SELECTED_PORT,
            })
        self._send_json({"ok": False, "error": "Not found"}, status=404)

    def do_POST(self):
        path = urlparse(self.path).path
        
        if path == "/scan":
            return self._handle_scan()
        elif path == "/enrich-civitai":
            return self._handle_enrich_civitai()
        
        return self._send_json({"ok": False, "error": "Not found"}, status=404)
    
    def _handle_scan(self):
        try:
            body = self._read_json()
        except ValueError as e:
            return self._send_json({"ok": False, "error": str(e)}, status=400)

        root = body.get("root")
        output = body.get("output")

        if not root or not isinstance(root, str):
            return self._send_json({"ok": False, "error": "Field 'root' (string) is required."}, status=400)

        root_p = Path(root).expanduser()
        if not root_p.exists():
            return self._send_json({"ok": False, "error": f"Root does not exist: {root_p}"}, status=400)

        out_p = Path(output).expanduser() if isinstance(output, str) and output.strip() else None

        # Try Python import first, fallback to CLI
        try:
            try:
                catalog = call_scanner_via_import(root_p, out_p)
            except Exception:
                catalog = call_scanner_via_cli(root_p, out_p)
        except Exception as e:
            import traceback; traceback.print_exc()
            return self._send_json({"ok": False, "error": str(e)}, status=500)

        # Optionally write here (if the scanner didn't already do it)
        if out_p:
            try:
                if not out_p.exists():
                    write_file(out_p, catalog)
            except Exception as e:
                return self._send_json({"ok": True, "warning": f"Could not write output: {e}", "data": catalog}, status=200)

        return self._send_json({"ok": True, "data": catalog}, status=200)
    
    def _handle_enrich_civitai(self):
        """Handle CivitAI enrichment request."""
        try:
            body = self._read_json()
        except ValueError as e:
            return self._send_json({"ok": False, "error": str(e)}, status=400)
        
        file_path = body.get("path")
        if not file_path:
            return self._send_json({"ok": False, "error": "Field 'path' is required"}, status=400)
        
        filepath = Path(file_path)
        if not filepath.exists():
            return self._send_json({"ok": False, "error": f"File not found: {file_path}"}, status=400)
        
        try:
            # Calculate hash
            file_hash = calculate_file_hash(filepath)
            
            # Query CivitAI
            result = query_civitai_by_hash(file_hash)
            
            return self._send_json({"ok": True, "data": result}, status=200)
        except Exception as e:
            import traceback; traceback.print_exc()
            return self._send_json({"ok": False, "error": str(e)}, status=500)


def try_bind(host: str, port: int):
    """Return HTTPServer bound to (host, port) or raise OSError."""
    return HTTPServer((host, port), Handler)


def pick_free_port(host: str, desired: int, strict: bool):
    """Try desired port, then bump up to AUTO_PORT_MAX_TRIES. Returns (server, port)."""
    first_err = None
    for offset in range(AUTO_PORT_MAX_TRIES):
        p = desired + offset
        try:
            srv = try_bind(host, p)
            return srv, p
        except OSError as e:
            if first_err is None:
                first_err = e
            # If strict and this was the desired port, stop immediately
            if strict:
                break
            continue
    # If we get here, binding failed for all tries
    raise first_err or OSError(f"Could not bind to any port from {desired} to {desired + AUTO_PORT_MAX_TRIES - 1}")


def main(argv=None):
    global SELECTED_HOST, SELECTED_PORT
    argv = argv or sys.argv[1:]

    host, port = DEFAULT_HOST, DEFAULT_PORT
    strict = False

    # naive args parsing: --host, --port, --strict
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--host" and i + 1 < len(argv):
            host = argv[i + 1]
            i += 2
            continue
        if a == "--port" and i + 1 < len(argv):
            try:
                port = int(argv[i + 1])
            except ValueError:
                print(f"Invalid --port value: {argv[i + 1]}", file=sys.stderr)
                sys.exit(2)
            i += 2
            continue
        if a == "--strict":
            strict = True
            i += 1
            continue
        i += 1

    httpd, chosen_port = pick_free_port(host, port, strict)
    SELECTED_HOST, SELECTED_PORT = host, chosen_port

    print(
        f"ComfyDash mini server listening on http://{host}:{chosen_port}\n"
        f"(Auto-port {'ON' if not strict else 'OFF'}; desired={port}, selected={chosen_port})"
    )

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        print("ComfyDash mini server stopped")


if __name__ == "__main__":
    main()
