# 🧩 ComfyDash – Local Model Catalog Dashboard

ComfyDash helps you make sense of all your downloaded checkpoints, LoRAs, and embeddings by scanning your ComfyUI directories and presenting them in a clear, searchable dashboard. It's a lightweight local catalog and management tool for ComfyUI model data.

Do you know the issue? You download checkpoints, LoRAs, and embeddings, use them for a while, and later wonder what they actually do. ComfyDash was created to solve exactly that — giving you a clear overview of everything stored in your local ComfyUI setup.

ComfyDash combines a ⚙️ Python‑based scanner that generates a structured **catalog.json** file with a modern 💻 React frontend built using Vite and TailwindCSS.

---

## 🚀 Features

### 🧩 Scanner (Python CLI)

* 🔍 Scans any ComfyUI model directory (Checkpoints, LoRAs, Embeddings)
* 🧾 Generates a unified **catalog.json** file
* 📏 Captures file size, modification date, type, and stable ID
* 🚫 Automatically skips missing or invalid files
* 🔐 Extracts metadata from Safetensors files (triggers, tags, CivitAI URLs)
* 🎯 **NEW in v1.3:** Improved architecture detection for SDXL, Pony, Illustrious, and Cascade models

### 🖥️ Dashboard (React + Tailwind)

* 🗂️ Accordions per model type (Checkpoint / LoRA / Embedding) with "Select All" functionality
* 🔎 Search & filter (client‑side, no backend required)
* ✏️ Inline editing for model name, CivitAI link, trigger tags, architecture, etc.
* 💾 Local persistence of all edits via `localStorage`
* 🧠 Heuristic suitability detection (📷 Realistic / ✏️ Drawing) with manual override
* ⭐ Favorites system
* 📌 Sticky header for improved navigation
* 🤖 Automatic metadata extraction from Safetensors (trigger words, tags)
* 🌐 CivitAI integration - search selected models on CivitAI and auto-fill metadata
* 📊 **NEW in v2.0.1:** Visual progress overlay during CivitAI searches with file-by-file status
* 📏 **NEW in v2.0.1:** Resizable columns - drag column borders to adjust widths, settings saved per model type
* 🎨 **NEW in v1.3:** Optimized column layout - wider model names, compact file paths
* 🖱️ **NEW in v1.3:** Click column headers to sort - visual indicators show sort direction
* 🏗️ **NEW in v1.3:** Pony/Illustrious workflow template included
* 🚀 **NEW in v2.0:** Launch ComfyUI directly from the dashboard with one click
* 🐍 **NEW in v2.0:** Conda environment support for ComfyUI startup
* ✅ **NEW in v2.0:** Real-time ComfyUI status detection and smart button switching

---

## 🧰 Installation

### 🧾 Requirements

* 🧩 Node.js ≥ 18.x (includes npm)
* 🐍 Python 3.12+

### 🪟 Quick Start (Windows)

ComfyDash can now be launched with a single double‑click.

#### 1️⃣ Clone and setup

```bash
git clone https://github.com/max-dingsda/ComfyDash
cd ComfyDash
cd comfydash
npm install
```

💡 *Note:* Newer npm versions may report that the install script of `esbuild` (used by Vite) was not run. The build works without it. If you run into problems on another machine, allow it with:

```bash
npm install-scripts approve esbuild
```

⚠️ Always run npm commands inside `comfydash/`, not in the project root.

#### 2️⃣ Start ComfyDash

Run the PowerShell script in the project root:

```bash
start_comfydash.ps1
```

This will:

* 🧠 start the local Python API (`mini_server.py`)
* 🧰 start the Vite dev server (`npm run dev`)
* 🌐 open your browser at **[http://localhost:5173](http://localhost:5173)**

💡 *Alternative:* run `start_comfydash.bat` for an even quicker double‑click start.

---

## 🧪 Usage

### Basic Workflow

The **Checkpoints** section combines models from `models/checkpoints`, `models/diffusion_models`, and `models/diffusion models`, including subfolders. Supported formats are `.ckpt`, `.safetensors`, `.pt`, `.bin`, and `.gguf`. Click **Scan now** to refresh the list after adding models.

1. 🌍 Open the dashboard in your browser
2. 🔍 Click **"Detect API"** to find the running backend
3. 📂 Enter your ComfyUI root path (e.g., `F:\AI\ComfyUI`)
4. ⚡ Click **"Scan now"** to scan your models
5. 🔎 Browse, search, and organize your models
6. 💾 All edits are automatically saved in your browser

### CivitAI Integration (v1.2)

1. ✅ Select models using the checkboxes
2. 🔍 Click **"Find selected on CivitAI"**
3. ⏳ Wait for the search to complete (rate-limited to ~2 models/second)
4. 🎉 Metadata (title, URL, triggers) is automatically filled in

> **Note:** CivitAI search uses file hashes and may take several minutes for many models. Manual data will be overwritten by CivitAI data.

### ComfyUI Launch (v2.0)

1. 📂 Enter your ComfyUI root path
2. 🐍 (Optional) Specify a Conda environment name (e.g., "comfyui")
3. 🚀 Click **"Open ComfyUI"** to start ComfyUI
4. ⏳ Wait ~10-30 seconds for startup
5. ✅ Green button appears when ready - click to open ComfyUI in new tab

> **Note:** If you use a Conda environment for ComfyUI, enter the environment name. Leave empty to use system Python. ComfyUI will launch in a visible console window so you can monitor startup and errors.

### 🐍 Running the scanner manually

```bash
python scanner/main.py --root "<path_to_your_ComfyUI_folder>" --output "catalog.json"
```

### 🌐 Mini API (for integration)

The local API `mini_server.py` allows the dashboard to run the scanner directly:

```bash
python mini_server.py --host 127.0.0.1 --port 8000
```

#### Endpoints

* 🩺 **GET /health** → `{ ok: true }`
* 🧭 **POST /scan** → `{ root: "F:\\AI\\ComfyUI", output: "optional\\catalog.json" }`
* 🌐 **POST /enrich-civitai** → `{ path: "path/to/model.safetensors" }`
* 🔍 **GET /comfyui/status** → `{ ok: true, running: true/false }`
* 🚀 **POST /comfyui/start** → `{ root: "F:\\AI\\ComfyUI", port: 8188, conda_env: "optional" }`

---

## 🧭 Roadmap

| Version | Focus | Enhancements |
|:--------|:-------|:--------------|
| **1.0 ✅** | MVP Release | Stable local version with all core functionality |
| **1.1 ✅** | Usability | Run scanner from UI, API auto-detect, local annotations, base-model badges (SD 1.5 / SDXL / FLUX / PONY) |
| **1.2 ✅** | Metadata | Extract Safetensors metadata, CivitAI API integration, manual override for suitability flags, sticky header, "Select All" |
| **1.3 ✅** | UX & Polish | Improved architecture detection, sortable columns, optimized layout, workflow templates (prep for v2.0) |
| **2.0 ✅** | Workflows | Launch ComfyUI directly from dashboard, conda environment support, real-time status detection |
| **2.0.1 ✅** | Bug Fixes & UX | Fixed CivitAI API integration (missing `/enrich-civitai` endpoint), added progress overlay for CivitAI searches, resizable columns with per-type persistence |
| **2.0.2 ✅** | Bug Fixes | Fixed input field focus loss during typing, fixed sorting to check manual annotations and use case-insensitive comparison |
| **2.1** | Workflows | 🔜 Launch ComfyUI with preconfigured workflow templates |

---

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

---

## 📜 License

MIT License - see LICENSE file for details.

---

## 🙏 Acknowledgments

Built with ❤️ for the ComfyUI community.
