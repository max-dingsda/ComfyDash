#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ComfyDash Scanner v1.1.1 — FAST HASH
- Deutlich schneller bei großen Dateien (Checkpoints), da kein Voll-Hash mehr.
- ID wird aus (Dateiname | Größe | mtime_ns) + kleinen Content-Samples erzeugt (BLAKE2s).
- API kompatibel zu v1.1: scan(root, output=None) + CLI (--stdout).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, List

MODEL_SUBFOLDERS = {
    "checkpoint": ["models/checkpoints"],
    "lora": ["models/loras", "models/lora"],
    "embedding": ["models/embeddings", "models/embedding"],
}

CHECKPOINT_EXT = {".ckpt", ".safetensors", ".pt", ".bin"}
LORA_EXT       = {".safetensors"}
EMBED_EXT      = {".pt", ".bin", ".safetensors"}


def fast_id(path: Path) -> str:
    """Schnelle, stabile ID: Metadaten + kleine Head/Tail-Samples.
    Vermeidet das Durchlesen von Multi-GB-Dateien.
    """
    st = path.stat()
    basis = f"{path.name}|{st.st_size}|{int(st.st_mtime_ns)}".encode("utf-8")
    h = hashlib.blake2s(digest_size=16)
    h.update(basis)
    # bis zu 64 KiB vom Anfang + Ende (falls vorhanden)
    try:
        with path.open("rb") as f:
            head = f.read(65536)
            if head:
                h.update(head)
            if st.st_size > 131072:
                try:
                    f.seek(-65536, os.SEEK_END)
                    tail = f.read(65536)
                    if tail:
                        h.update(tail)
                except OSError:
                    pass
    except Exception:
        # Sampling optional – Basis reicht
        pass
    return h.hexdigest()


def guess_base_model(name: str) -> str:
    n = name.lower()
    if any(k in n for k in ("flux", "flux.1", "flux1")):
        return "flux"
    if "pony" in n or "illustrious" in n:
        return "pony"
    if any(k in n for k in ("sdxl", "juggernautxl", "xlbase", "refiner")) and "1.5" not in n:
        return "sdxl"
    return "sd15"


def collect_items(root: Path) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []

    def add_item(kind: str, path: Path):
        name = path.stem
        base = guess_base_model(name)
        st = path.stat()
        items.append({
            "id": fast_id(path),
            "type": kind,
            "name": name,
            "path": str(path),
            "size": st.st_size,
            "base": base,
            "mtime": int(st.st_mtime),
        })

    for kind, rels in MODEL_SUBFOLDERS.items():
        for rel in rels:
            folder = (root / rel).resolve()
            if not folder.exists():
                continue
            # schneller als rglob("*") + is_file Checks
            for p in folder.rglob("*"):
                if not p.is_file():
                    continue
                ext = p.suffix.lower()
                if kind == "checkpoint" and ext in CHECKPOINT_EXT:
                    add_item("checkpoint", p)
                elif kind == "lora" and ext in LORA_EXT:
                    add_item("lora", p)
                elif kind == "embedding" and ext in EMBED_EXT:
                    add_item("embedding", p)

    items.sort(key=lambda x: (x["type"], x["name"].lower()))
    return items


def scan(root: str | Path, output: str | Path | None = None) -> Dict[str, Any]:
    root = Path(root).expanduser()
    if not root.exists():
        raise FileNotFoundError(f"ComfyUI root does not exist: {root}")

    items = collect_items(root)
    catalog: Dict[str, Any] = {
        "schema": "comfydash/catalog@1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "comfyui_root": str(root),
        "count": len(items),
        "items": items,
    }

    if output:
        out = Path(output).expanduser()
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    return catalog


# ---------------- CLI -----------------

def parse_args(argv=None):
    ap = argparse.ArgumentParser(description="ComfyDash Scanner v1.1.1 (FAST)")
    ap.add_argument("--root", required=True, help="ComfyUI root (contains models/…)")
    ap.add_argument("--output", help="Write catalog to this path (optional)")
    ap.add_argument("--stdout", action="store_true", help="Print catalog JSON to stdout")
    return ap.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    cat = scan(args.root, args.output)
    if args.stdout:
        print(json.dumps(cat, ensure_ascii=False))
    else:
        if not args.output:
            default_out = Path(args.root) / "catalog.json"
            default_out.write_text(json.dumps(cat, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"✅ Wrote catalog: {default_out}  ({len(cat['items'])} items)")


if __name__ == "__main__":
    main()
