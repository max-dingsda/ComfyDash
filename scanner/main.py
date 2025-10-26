#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ComfyDash Scanner (MVP single-file)
- Scans standard ComfyUI folders under --root:
  models/checkpoints, models/loras, models/embeddings
- Produces a catalog.json with stable IDs, base model heuristics,
  checkpoint suitability (photo/drawing) and starter presets.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
from datetime import datetime, timezone
from tqdm import tqdm

# --- config: what to scan (relative to root) ---
REL_DIRS = {
    "checkpoint": "models/checkpoints",
    "lora": "models/loras",
    "embedding": "models/embeddings",
}

# --- file extensions we care about ---
EXTS = {
    "checkpoint": {".safetensors", ".ckpt"},
    "lora": {".safetensors"},
    "embedding": {".pt", ".bin"},
}

def compute_stable_id(path: Path) -> str:
    """Stable ID = sha256(first 128KB) + filesize (hex-short).
    Robust gegen Race-Conditions: falls Datei weg/gesperrt -> Exception nach oben.
    """
    try:
        size = path.stat().st_size
        with path.open("rb") as f:
            chunk = f.read(128 * 1024)
    except (FileNotFoundError, PermissionError) as e:
        # re-raise; wird eine Ebene höher abgefangen und die Datei übersprungen
        raise e

    h = hashlib.sha256()
    h.update(chunk)
    digest = h.hexdigest()[:16]
    return f"{digest}_{size:x}"


def infer_base_model(name_lower: str):
    """
    Very simple offline heuristic:
    - flux -> flux
    - pony/illustrious -> pony
    - xl/sdxl/juggernautxl -> sdxl
    - otherwise sd15
    Returns (base_model, confidence)
    """
    if any(k in name_lower for k in ("flux", "flux.1", "flux1")):
        return "flux", "medium"
    if "pony" in name_lower or "illustrious" in name_lower:
        return "pony", "medium"
    if any(k in name_lower for k in ("sdxl", "xl", "juggernautxl", "xlbase", "refiner")) and "1.5" not in name_lower:
        return "sdxl", "medium"
    return "sd15", "low"  # default assumption

def infer_suitability_checkpoint(name_lower: str, base_model: str):
    """
    Decide photo (📷) vs drawing (✏️) suitability for checkpoints.
    """
    photo_keywords = ("real", "photoreal", "realistic", "juggernaut", "rev", "analog", "photograph")
    draw_keywords = ("anime", "comic", "toon", "manga", "cartoon", "pony", "illustrious")
    photo = any(k in name_lower for k in photo_keywords)
    draw = any(k in name_lower for k in draw_keywords)

    # base_model hints
    if base_model == "pony":
        draw = True
        photo = False
    if base_model == "flux":
        # flux models are versatile; mark both True mildly
        photo = True if not photo else photo
        draw = True if not draw else draw

    return bool(photo), bool(draw)

def presets_for_checkpoint(base_model: str, drawing: bool):
    """
    Starter presets (Sampler/Steps/CFG) per earlier spec.
    Returns dict with strings/numbers.
    """
    # Defaults SD1.5 realistic
    sampler = "DPM++ 2M Karras"
    steps = 24
    cfg = 5.5
    rng_steps = "20–30"
    rng_cfg = "5.0–7.0"

    if base_model == "sd15" and drawing:
        sampler = "DPM++ SDE Karras"
        steps, rng_steps = 22, "18–26"
        cfg, rng_cfg = 7.0, "6.5–8.5"
    elif base_model == "sdxl" and not drawing:
        sampler = "DPM++ 2M SDE Karras"
        steps, rng_steps = 36, "30–45"
        cfg, rng_cfg = 4.0, "3.5–5.0"
    elif base_model == "sdxl" and drawing:
        sampler = "DPM++ 2M SDE Karras"
        steps, rng_steps = 42, "35–55"
        cfg, rng_cfg = 5.0, "4.5–6.0"
    elif base_model == "pony":
        sampler = "DPM++ SDE Karras"
        steps, rng_steps = 22, "18–26"
        cfg, rng_cfg = 7.5, "6.5–9.0"
    elif base_model == "flux":
        # conservative generic prefs
        sampler = "DPM++ 2M SDE Karras"
        steps, rng_steps = 30, "24–40"
        cfg, rng_cfg = 5.0, "4.0–6.0"

    return {
        "sampler": sampler,
        "steps": steps,
        "steps_range": rng_steps,
        "cfg": cfg,
        "cfg_range": rng_cfg,
    }

def item_from_path(root: Path, item_type: str, file_path: Path):
    name = file_path.name
    name_lower = name.lower()
    item = {
        "id": compute_stable_id(file_path),
        "type": item_type,  # "checkpoint" | "lora" | "embedding"
        "root_id": "default",
        "rel_path": str(file_path.relative_to(root)).replace("\\", "/"),
        "abs_path": str(file_path).replace("\\", "/"),
        "file_name": name,
        "provenance": "auto",
        "civitai_title": None,
        "civitai_link": None,
        "base_model": None,
        "confidence": None,
    }

    base_model, conf = infer_base_model(name_lower)
    item["base_model"] = base_model
    item["confidence"] = conf

    if item_type == "checkpoint":
        photo, draw = infer_suitability_checkpoint(name_lower, base_model)
        item["suitability"] = {
            "photo": photo,
            "drawing": draw,
        }
        item["presets"] = presets_for_checkpoint(base_model, drawing=draw)

    # LoRA/Embedding: keep minimal MVP fields; triggers/tokens come later via metadata or manual annotations
    return item

def scan(root: Path):
    root = root.resolve()
    results = []
    for ttype, rel in REL_DIRS.items():
        base_dir = root / rel
        if not base_dir.exists():
            continue
        # walk recursively
        for dirpath, _, filenames in os.walk(base_dir):
            d = Path(dirpath)
            for fn in filenames:
                ext = Path(fn).suffix.lower()
                if ext in EXTS[ttype]:
                    p = d / fn
                    results.append(item_from_path(root, ttype, p))
    return results

def main():
    ap = argparse.ArgumentParser(description="ComfyDash Scanner (MVP)")
    ap.add_argument("--root", required=True, help="ComfyUI root folder, e.g. F:\\AI\\ComfyUI")
    ap.add_argument("--output", required=True, help="Output catalog.json path")
    args = ap.parse_args()

    root = Path(args.root)
    if not root.exists():
        raise SystemExit(f"Root does not exist: {root}")

    print(f"🔎 Scanning: {root}")
    items = []
    # tqdm over three known folders for a bit of progress feedback
    for ttype, rel in REL_DIRS.items():
        base_dir = root / rel
        if not base_dir.exists():
            continue
        paths = []
        for dirpath, _, filenames in os.walk(base_dir):
            for fn in filenames:
                paths.append(Path(dirpath) / fn)
        exts = EXTS[ttype]
        paths = [p for p in paths if p.suffix.lower() in exts]
        for p in tqdm(paths, desc=f"{ttype:>10}", unit="file"):
            try:
                items.append(item_from_path(root, ttype, p))
            except FileNotFoundError:
                print(f"⚠️  übersprungen (nicht gefunden): {p}")
            except PermissionError:
                print(f"⚠️  übersprungen (keine Berechtigung): {p}")


    catalog = {
        "version": 1,
         "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "root_id": "default",
        "comfyui_root": str(root).replace("\\", "/"),
        "items": items,
    }

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)

    print(f"✅ Wrote catalog: {out}  ({len(items)} items)")

if __name__ == "__main__":
    main()
