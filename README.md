# 🧩 ComfyDash – Local Model Catalog Dashboard

ComfyDash helps you make sense of all your downloaded checkpoints, LoRAs, and embeddings by scanning your ComfyUI directories and presenting them in a clear, searchable dashboard. It’s a lightweight local catalog and management tool for ComfyUI model data.

Do you know the issue? You download checkpoints, LoRAs, and embeddings, use them for a while, and later wonder what they actually do. ComfyDash was created to solve exactly that — giving you a clear overview of everything stored in your local ComfyUI setup.

ComfyDash combines a ⚙️ Python‑based scanner that generates a structured **catalog.json** file with a modern 💻 React frontend built using Vite and TailwindCSS.

---

## 🚀 Features (MVP 1.0)

### 🧩 Scanner (Python CLI)

* 🔍 Scans any ComfyUI model directory (Checkpoints, LoRAs, Embeddings)
* 🧾 Generates a unified **catalog.json** file
* 📏 Captures file size, modification date, type, and stable ID
* 🚫 Automatically skips missing or invalid files

### 🖥️ Dashboard (React + Tailwind)

* 🗂️ Accordions per model type (Checkpoint / LoRA / Embedding)
* 🔎 Search & filter (client‑side, no backend required)
* ✏️ Inline editing for CivitAI title, link, trigger tags, base model, provenance, etc.
* 💾 Local persistence of all edits via `localStorage`
* 🧠 Heuristic suitability detection (📷 Realistic / ✏️ Drawing)
* ⭐ Favorites system and provenance toggle (Auto / Manual)
* 📄 Pagination (10 items per accordion)
* 🧍‍♂️ Responsive layout with “Fit to window / Limit width” toggle
* 📌 Sticky header and sticky first column for improved readability

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

* 🌍 Open the dashboard in your browser.
* 📂 Click **“Open catalog.json”** or **“Fetch”** to load a generated file.
* 🔍 Use Search, Filters, and Accordions to explore your models.
* 💾 All edits (titles, tags, links) are stored locally in your browser.

### 🐍 Running the scanner manually

```bash
python main.py --root "<path_to_your_ComfyUI_folder>" --output "<your_ComfyDash_path>/catalog.json"
```

### 🌐 Mini API (for integration)

The local API `mini_server.py` allows the dashboard to run the scanner directly:

```bash
python mini_server.py --host 127.0.0.1 --port 8000
```

#### Endpoints

* 🩺 **GET /health** → `{ ok: true }`
* 🧭 **POST /scan** → `{ root: "F:\\AI\\ComfyUI", output: "optional\\catalog.json" }`

---

## 🧭 Roadmap

| Version   | 🔍 Focus    | 🧩 Planned Enhancements                                                                                                                 |
| --------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **1.0 ✅** | MVP Release | ✅ Stable, local version with all core functionality                                                                                     |
| **1.1 ✅** | Usability   | 🧠 Run scanner from the UI (via “Scan now” button), API auto‑detect, local annotations, base model badges (SD 1.5 / SDXL / FLUX / PONY) |
| **1.2**   | Scanner+    | 📦 Extract metadata from Safetensors (CivitAI title, triggers, etc.)                                                                    |
| **1.3**   | Automation  | 🤖 Integration of CivitAI API for automatic information retrieval                                                                       |
