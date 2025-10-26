ComfyDash – Local Model Catalog Dashboard

Do you know the issue? You have downloaded checkpoints, Loras and embeddings and used them...they remain on your local drive and after some time, you are wondering what all those files do? If you are like me, you know what I'm talking about and thats why I created ComfyDash. To get an overview of the files on my local drive stored within my ComfyUI installation.



ComfyDash is a lightweight, client‑side dashboard for browsing and managing local ComfyUI model data. It combines a Python‑based scanner that generates a structured catalog.json file with a modern React frontend built using Vite and TailwindCSS.

🚀 Features (MVP 1.0)

🧩 Scanner (Python CLI)

Scans any ComfyUI model directory (Checkpoints, LoRAs, Embeddings)

Generates a unified catalog.json file

Captures file size, modification date, type, and stable ID

Automatically skips missing or invalid files

🖥️ Dashboard (React + Tailwind)

Accordions per model type (Checkpoint / LoRA / Embedding)

Search & filter (client‑side, no backend required)

Inline editing for CivitAI title, link, trigger tags, base model, provenance, etc.

Local persistence of all edits via localStorage

Heuristic suitability detection (📷 Realistic / ✏️ Drawing)

Favorites system and provenance toggle (Auto / Manual)

Pagination (10 items per accordion)

Responsive layout with a “Fit to window / Limit width” toggle

Sticky header and sticky first column for improved readability

🧰 Installation

Requirements

Node.js ≥ 18.x (includes npm)

Python 3.12+ (for the scanner)

Setup

# Clone repository
git clone https://github.com/max-dingsda/ComfyDash

# Initialize frontend
cd comfydash
npm install
npm run dev

Then open the dashboard locally at:

http://localhost:5173

🧪 Usage

Run the Python scanner:

python main.py --root "F:\\AI\\ComfyUI" --output "F:\\ComfyDash\\catalog.json"

In the dashboard, click “Open catalog.json” to load the file.

Filter, sort, edit, and annotate your models.

All changes are saved automatically in the browser (localStorage).

🧭 Roadmap

Version

Focus

Planned Enhancements

1.0

MVP Release

Stable, local version with all core functionality

1.1

Usability

run scanner from the UI

1.2

Scanner+

Extract metadata from Safetensors (CivitAI title, triggers, etc.)

1.3

Automation

Integration of CivitAI api

🧑‍💻 Contributing

Pull requests and issues are welcome, especially for:

UI improvements (sticky headers, filters, icons)

Python scanner enhancements (metadata extraction, performance)

📄 License

MIT License © 2025 Michel Goumet

