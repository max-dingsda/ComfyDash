import tempfile
import unittest
from pathlib import Path

from scanner.main import scan


class ScanTests(unittest.TestCase):
    def test_combines_model_folders_recursively(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = {
                "models/checkpoints/old.ckpt": "checkpoint",
                "models/diffusion_models/flux2/nested/flux2.safetensors": "checkpoint",
                "models/diffusion_models/flux2-Q4.GGUF": "checkpoint",
                "models/diffusion models/flux2.bin": "checkpoint",
                "models/loras/style.safetensors": "lora",
                "models/embeddings/token.pt": "embedding",
            }
            for name in [*files, "models/diffusion_models/readme.txt"]:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"test")
            catalog = scan(root)
            actual = {Path(item["path"]).relative_to(root).as_posix(): item["type"]
                      for item in catalog["items"]}
            self.assertEqual(actual, files)
            self.assertEqual(catalog["count"], len(files))
            for item in catalog["items"]:
                if "flux2" in item["name"]:
                    self.assertEqual(item["base"], "flux")

    def test_missing_model_folders(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(scan(tmp)["items"], [])
