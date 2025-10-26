# ComfyDash – Local Model Catalog Dashboard

ComfyDash helps you make sense of all your downloaded checkpoints, LoRAs, and embeddings by scanning your ComfyUI directories and presenting them in a clear, searchable dashboard. It’s a lightweight local catalog and management tool for ComfyUI model data.

Do you know the issue? You download checkpoints, LoRAs, and embeddings, use them for a while, and later wonder what they actually do. ComfyDash was created to solve exactly that — giving you a clear overview of everything stored in your local ComfyUI setup.

ComfyDash is a lightweight, client‑side dashboard for browsing and managing local **ComfyUI model data**. It combines a Python‑based scanner that generates a structured `catalog.json` file with a modern React frontend built using **Vite** and **TailwindCSS**.

---

## 🚀 Features (MVP 1.0)

### 🧩 Scanner (Python CLI)

* Scans any ComfyUI model directory (Checkpoints, LoRAs, Embeddings)
* Generates a unified `catalog.json` file
* Captures file size, modification date, type, and stable ID
* Automatically skips missing or invalid files

### 🖥️ Dashboard (React + Tailwind)

* **Accordions** per model type (Checkpoint / LoRA / Embedding)
* **Search & filter** (client‑side, no backend required)
* **Inline editing** for CivitAI title, link, trigger tags, base model, provenance, etc.
* **Local persistence** of all edits via `localStorage`
* **Heuristic suitability detection** (📷 Realistic / ✏️ Drawing)
* **Favorites system** and provenance toggle (Auto / Manual)
* **Pagination** (10 items per accordion)
* **Responsive layout** with a “Fit to window / Limit width” toggle
* **Sticky header** and **sticky first column** for improved readability

---

## 🧰 Installation

### Requirements

* **Node.js** ≥ 18.x (includes npm)
* **Python 3.12+** (for the scanner)

### Setup

```bash
# Clone repository
git clone https://github.com/max-dingsda/ComfyDash
cd ComfyDash

# Initialize frontend
cd comfydash
npm install
npm run dev
```

Then open the dashboard locally at:

```
http://localhost:5173
```

---

## 🧪 Usage

1. Run the Python scanner:

   ```bash
   python main.py --root "<path_to_your_ComfyUI_folder>" --output "<your_ComfyDash_path>/catalog.json"

   ```
2. In the dashboard, click **“Open catalog.json”** to load the file.
3. Filter, sort, edit, and annotate your models.
4. All changes are saved automatically in the browser (`localStorage`).

---

## 🧭 Roadmap

| Version | Focus       | Planned Enhancements                                              |
| ------- | ----------- | ----------------------------------------------------------------- |
| **1.0** | MVP Release | Stable, local version with all core functionality                 |
| **1.1** | Usability   | run scanner from the UI                                           |
| **1.2** | Scanner+    | Extract metadata from Safetensors (CivitAI title, triggers, etc.) |
| **1.3** | Automation  | Integration of CivitAI api for automatic information retrieval    |

---

## 🧑‍💻 Contributing

Pull requests and issues are welcome, especially for:

* UI improvements (sticky headers, filters, icons)
* Python scanner enhancements (metadata extraction, performance)

---

## 📄 License

MIT License © 2025 Michel Goumet
