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
import struct
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

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


def read_safetensors_metadata(path: Path) -> Optional[Dict[str, Any]]:
    """Read metadata from safetensors file header."""
    try:
        with path.open('rb') as f:
            # First 8 bytes = header length (little-endian uint64)
            header_len_bytes = f.read(8)
            if len(header_len_bytes) < 8:
                return None
            header_len = struct.unpack('<Q', header_len_bytes)[0]
            
            # Read header JSON (limit to 10MB for safety)
            if header_len > 10_000_000:
                return None
            header_json = f.read(header_len)
            header = json.loads(header_json.decode('utf-8'))
            
            # Metadata is in __metadata__ key
            return header.get('__metadata__', {})
    except Exception:
        return None


def extract_trigger_from_comment(comment: str) -> Optional[str]:
    """Extract trigger word from ss_training_comment field."""
    if not comment:
        return None
    # Look for 'trigger word:' or 'trigger:'
    for prefix in ['trigger word:', 'trigger:']:
        if prefix in comment.lower():
            idx = comment.lower().index(prefix)
            trigger = comment[idx + len(prefix):].strip()
            # Take only the first word/phrase (up to comma or newline)
            trigger = trigger.split(',')[0].split('\n')[0].strip()
            return trigger if trigger else None
    return None


def extract_top_tags(tag_frequency: str, top_n: int = 15) -> Optional[str]:
    """Extract top N tags from ss_tag_frequency JSON string."""
    try:
        tag_data = json.loads(tag_frequency)
        # Flatten all tag frequencies from all categories
        all_tags = {}
        for category_tags in tag_data.values():
            if isinstance(category_tags, dict):
                for tag, count in category_tags.items():
                    all_tags[tag] = all_tags.get(tag, 0) + count
        
        # Sort by frequency and take top N (excluding the trigger word itself)
        sorted_tags = sorted(all_tags.items(), key=lambda x: x[1], reverse=True)
        top_tags = [tag for tag, _ in sorted_tags[:top_n]]
        
        return ', '.join(top_tags) if top_tags else None
    except Exception:
        return None


def extract_civitai_url(metadata: Dict[str, Any]) -> Optional[str]:
    """Try to extract CivitAI URL from metadata."""
    # Common fields where URLs might be stored
    for field in ['ss_url', 'ss_civitai_url', 'civitai_url', 'url', 'ss_training_comment']:
        value = metadata.get(field, '')
        if value and 'civitai.com' in str(value).lower():
            # Extract URL if it's in a comment
            if 'civitai.com' in str(value):
                parts = str(value).split()
                for part in parts:
                    if 'civitai.com' in part:
                        return part.strip('"\'')
    return None


def extract_base_from_metadata(metadata: Dict[str, Any]) -> Optional[str]:
    """Extract base model from safetensors metadata."""
    # Check ss_base_model_version
    base_version = metadata.get('ss_base_model_version', '')
    if 'xl' in base_version.lower():
        return 'sdxl'
    if 'v2' in base_version.lower():
        return 'sd20'
    if 'v1' in base_version.lower() or 'sd_v1' in base_version.lower():
        return 'sd15'
    
    # Check ss_sd_model_name
    model_name = metadata.get('ss_sd_model_name', '')
    if model_name:
        if 'xl' in model_name.lower():
            return 'sdxl'
        if 'v2' in model_name.lower() or '2-' in model_name:
            return 'sd20'
        if 'v1' in model_name.lower() or '1-5' in model_name:
            return 'sd15'
    
    return None


def collect_items(root: Path) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []

    def add_item(kind: str, path: Path):
        name = path.stem
        base = guess_base_model(name)
        st = path.stat()
        
        # Basic item data
        item = {
            "id": fast_id(path),
            "type": kind,
            "name": name,
            "path": str(path),
            "size": st.st_size,
            "base": base,
            "mtime": int(st.st_mtime),
        }
        
        # Extract metadata from safetensors files
        if path.suffix.lower() == '.safetensors':
            metadata = read_safetensors_metadata(path)
            if metadata:
                # Extract base model from metadata (overrides filename guess)
                meta_base = extract_base_from_metadata(metadata)
                if meta_base:
                    item['base'] = meta_base
                
                # Extract CivitAI URL
                civitai_url = extract_civitai_url(metadata)
                if civitai_url:
                    item['civitai_url'] = civitai_url
                
                # For LoRAs: extract trigger and tags
                if kind == 'lora':
                    # Trigger from ss_training_comment
                    training_comment = metadata.get('ss_training_comment', '')
                    if training_comment:
                        trigger = extract_trigger_from_comment(training_comment)
                        if trigger:
                            item['trigger'] = trigger
                    
                    # Top tags from ss_tag_frequency
                    tag_frequency = metadata.get('ss_tag_frequency', '')
                    if tag_frequency:
                        top_tags = extract_top_tags(tag_frequency, top_n=15)
                        if top_tags:
                            item['tags'] = top_tags
        
        items.append(item)

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
