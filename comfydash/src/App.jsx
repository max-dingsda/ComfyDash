import { useEffect, useMemo, useState } from "react";

/*
  ComfyDash v1.1 – Full UI + Scan + Annotations
  ---------------------------------------------
  - Summary cards, Suche/Sort
  - Pro‑Typ Spalten (Checkpoint/LoRA/Embedding unterschiedlich)
  - Lokale Annotationen (civitai_title, link, favorite, triggers, base override)
  - Heuristik für Base‑Model, Suitability, Presets (nur Checkpoints)
  - Scan via Mini‑Server (Detect API, Port 8000–8019)
*/

// ---------- small utils ----------
const prettyBytes = (num = 0) => {
  if (!Number.isFinite(num)) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"]; let i = 0;
  while (num >= 1024 && i < units.length - 1) { num /= 1024; i++; }
  return `${num.toFixed(num < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
};

const useLocalStorage = (key, initial) => {
  const [v, setV] = useState(() => {
    const s = localStorage.getItem(key);
    return s !== null ? s : initial;
  });
  useEffect(() => { localStorage.setItem(key, v ?? ""); }, [key, v]);
  return [v, setV];
};

// ---------- annotations (localStorage) ----------
const ANN_KEY = "cd.annotations";
const annStore = {
  _cache: null,
  load() { if (this._cache) return this._cache; try { this._cache = JSON.parse(localStorage.getItem(ANN_KEY) || "{}"); } catch { this._cache = {}; } return this._cache; },
  save() { localStorage.setItem(ANN_KEY, JSON.stringify(this._cache || {})); },
  get(id) { return this.load()[id] || {}; },
  set(id, patch) { const a = this.load(); a[id] = { ...(a[id]||{}), ...patch, _manual: true }; this.save(); },
  isManual(id) { const a = this.get(id); return !!a._manual; },
};

// ---------- inference helpers ----------
const inferBaseModel = (name, existing) => {
  if (existing && existing !== "") return existing;
  const n = (name||"").toLowerCase();
  if (n.includes("flux")) return "flux";
  if (n.includes("pony") || n.includes("illustrious")) return "pony";
  if ((n.includes("sdxl") || n.includes("juggernautxl") || n.includes("xl") || n.includes("refiner")) && !n.includes("1.5")) return "sdxl";
  return "sd15";
};

const inferSuitabilityCheckpoint = (name) => {
  const n = (name||"").toLowerCase();
  const real = /(real|photo|photoreal|portrait|cinema|film)/.test(n);
  const draw = /(anim|anime|toon|comic|illustr|cartoon|manga)/.test(n);
  // default heuristics: if neither detected, be neutral (both false)
  return { realistic: !!real, drawing: !!draw };
};

const presetsForCheckpoint = (name) => {
  const n = (name||"").toLowerCase();
  if (n.includes("flux")) return { sampler: "euler_a", steps: 15, cfg: 3.5 };
  if (n.includes("sdxl")) return { sampler: "dpmpp_2m", steps: 30, cfg: 5.5 };
  if (n.includes("pony") || n.includes("illustrious")) return { sampler: "euler_a", steps: 22, cfg: 4.5 };
  return { sampler: "euler_a", steps: 20, cfg: 7 };
};

// ---------- normalization ----------
const normalizeItem = (raw) => {
  const id = raw.id ?? `${raw.type}:${raw.name}`;
  const name = raw.name ?? "(no name)";
  const path = raw.path ?? "";
  const file_name = path ? (path.split(/\\\\|\//).pop() || name) : name;
  const base = inferBaseModel(name, raw.base);
  return {
    id,
    type: raw.type ?? "unknown",
    name,
    file_name,
    base,
    size: raw.size ?? 0,
    path,
    mtime: raw.mtime ?? 0,
    arch: raw.arch || "–",
  };
};

// ---------- main component ----------
export default function App() {
  // data
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ comfyui_root: "", count: 0 });
  const [loading, setLoading] = useState(false);

  // query/sort
  const [query, setQuery] = useLocalStorage("cd.query", "");
  const [sortBy, setSortBy] = useLocalStorage("cd.sort", "name"); // name|size|mtime
  const [sortDir, setSortDir] = useLocalStorage("cd.dir", "asc"); // asc|desc

  // API + Scan
  const [apiBase, setApiBase] = useLocalStorage("cd.api.base", "http://127.0.0.1:8001");
  const [scanRoot, setScanRoot] = useLocalStorage("cd.scan.root", "");
  const [scanOut, setScanOut]   = useLocalStorage("cd.scan.out", "");
  const [scanning, setScanning] = useState(false);

  // force rerender helper
  const [, setTick] = useState(0);
  const bump = () => setTick(t => t + 1);

  // ingest
  const ingest = (json) => {
    if (!json) return;
    const data = json.items ? json : (json.data && json.data.items ? json.data : Array.isArray(json) ? { items: json } : { items: [] });
    const normalized = (data.items || []).map(normalizeItem);
    setItems(normalized);
    setMeta({ comfyui_root: data.comfyui_root || "", count: normalized.length });
  };

  // detect API
  const detectApi = async () => {
    const host = "http://127.0.0.1";
    for (let p = 8000; p < 8020; p++) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 600);
        const res = await fetch(`${host}:${p}/health`, { signal: ctrl.signal });
        clearTimeout(t);
        if (res.ok) { setApiBase(`${host}:${p}`); return; }
      } catch {}
    }
    alert("Keine laufende API gefunden (Ports 8000–8019). Starte mini_server.py?");
  };

  // basic loaders
  const scanNow = async () => {
    if (!scanRoot) { alert("Bitte ComfyUI-Root angeben!"); return; }
    try {
      setScanning(true);
      const res = await fetch(`${apiBase}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: scanRoot, output: scanOut || undefined }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
      ingest(payload.data || payload);
    } catch (e) {
      alert("Scan failed: " + e.message);
    } finally { setScanning(false); }
  };

  useEffect(() => { detectApi(); }, []);

  // derived
  const filtered = useMemo(() => {
    const sanitize = (s) => (s || "").trim().replace(/^["']+|["']+$/g, "");
    const q = sanitize(query).toLowerCase();
    let list = !q ? items : items.filter(it => (
      it.name.toLowerCase().includes(q) ||
      it.type.toLowerCase().includes(q) ||
      (it.base || "").toLowerCase().includes(q) ||
      (it.path || "").toLowerCase().includes(q)
    ));
    const dir = sortDir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      const A = a[sortBy] ?? "", B = b[sortBy] ?? "";
      if (A === B) return a.name.localeCompare(b.name) * dir;
      if (typeof A === "number" && typeof B === "number") return (A - B) * dir;
      return String(A).localeCompare(String(B)) * dir;
    });
    return list;
  }, [items, query, sortBy, sortDir]);

  const groups = useMemo(() => {
    const byType = { checkpoint: [], lora: [], embedding: [], other: [] };
    for (const it of filtered) (byType[it.type] || byType.other).push(it);
    return byType;
  }, [filtered]);

  const counts = useMemo(() => ({
    all: items.length,
    checkpoint: items.filter(i => i.type === "checkpoint").length,
    lora: items.filter(i => i.type === "lora").length,
    embedding: items.filter(i => i.type === "embedding").length,
  }), [items]);

  // ----- per‑type column defs -----
  const BASE_OPTIONS = ["sd15", "sdxl", "flux", "pony"];

  const CHECKPOINT_COLUMNS = [
    { key: "file_name", label: "Name" },
    { key: "civitai_title", label: "CivitAI‑Titel 🔗", render: (it) => (
        <EditableLink id={it.id} fieldTitle="civitai_title" fieldLink="civitai_link" ann={annStore.get(it.id)} onChange={() => { annStore.set(it.id, {}); bump(); }} />
      ) },
    { key: "base", label: "Base‑Model", render: (it) => (
        <SelectBase id={it.id} current={annStore.get(it.id).base || it.base} onChange={(v)=>{ annStore.set(it.id, { base: v }); bump(); }} opts={BASE_OPTIONS} />
      ) },
    { key: "arch", label: "Architektur / Typ" },
    { key: "realistic", label: "📷 Realistisch", render: (it) => { const s = inferSuitabilityCheckpoint(it.name); return <Flag value={s.realistic} />; } },
    { key: "drawing", label: "✏️ Zeichnung", render: (it) => { const s = inferSuitabilityCheckpoint(it.name); return <Flag value={s.drawing} />; } },
    { key: "sampler", label: "Sampler (Empf.)", render: (it) => presetsForCheckpoint(it.name).sampler },
    { key: "steps",   label: "Steps",          render: (it) => presetsForCheckpoint(it.name).steps },
    { key: "cfg",     label: "CFG",            render: (it) => presetsForCheckpoint(it.name).cfg },
    { key: "civitai_link", label: "CivitAI‑Link", render: (it) => (
        <EditableUrl id={it.id} field="civitai_link" ann={annStore.get(it.id)} onChange={()=>{ annStore.set(it.id, {}); bump(); }} />
      ) },
    { key: "prov", label: "Provenienz", render: (it) => annStore.isManual(it.id)? "Manuell" : "Auto" },
    { key: "fav",  label: "★", render: (it) => <Star id={it.id} onToggle={()=>{ const a=annStore.get(it.id); annStore.set(it.id,{ favorite: !a.favorite }); bump(); }} active={!!annStore.get(it.id).favorite} /> },
  ];

  const LORA_COLUMNS = [
    { key: "file_name", label: "Name" },
    { key: "civitai_title", label: "CivitAI‑Titel 🔗", render: (it) => (
        <EditableLink id={it.id} fieldTitle="civitai_title" fieldLink="civitai_link" ann={annStore.get(it.id)} onChange={() => { annStore.set(it.id, {}); bump(); }} />
      ) },
    { key: "base", label: "Base‑Model", render: (it) => (
        <SelectBase id={it.id} current={annStore.get(it.id).base || it.base} onChange={(v)=>{ annStore.set(it.id, { base: v }); bump(); }} opts={BASE_OPTIONS} />
      ) },
    { key: "triggers", label: "Trigger / Tags", render: (it) => (
        <EditableText id={it.id} field="triggers" placeholder="Trigger, tags…" ann={annStore.get(it.id)} onChange={()=>{ annStore.set(it.id, {}); bump(); }} />
      ) },
    { key: "civitai_link", label: "CivitAI‑Link", render: (it) => (
        <EditableUrl id={it.id} field="civitai_link" ann={annStore.get(it.id)} onChange={()=>{ annStore.set(it.id, {}); bump(); }} />
      ) },
    { key: "prov", label: "Provenienz", render: (it) => annStore.isManual(it.id)? "Manuell" : "Auto" },
    { key: "fav",  label: "★", render: (it) => <Star id={it.id} onToggle={()=>{ const a=annStore.get(it.id); annStore.set(it.id,{ favorite: !a.favorite }); bump(); }} active={!!annStore.get(it.id).favorite} /> },
  ];

  const EMB_COLUMNS = [
    { key: "file_name", label: "Name" },
    { key: "civitai_title", label: "CivitAI‑Titel 🔗", render: (it) => (
        <EditableLink id={it.id} fieldTitle="civitai_title" fieldLink="civitai_link" ann={annStore.get(it.id)} onChange={() => { annStore.set(it.id, {}); bump(); }} />
      ) },
    { key: "base", label: "Base‑Model", render: (it) => (
        <SelectBase id={it.id} current={annStore.get(it.id).base || it.base} onChange={(v)=>{ annStore.set(it.id, { base: v }); bump(); }} opts={BASE_OPTIONS} />
      ) },
    { key: "civitai_link", label: "CivitAI‑Link", render: (it) => (
        <EditableUrl id={it.id} field="civitai_link" ann={annStore.get(it.id)} onChange={()=>{ annStore.set(it.id, {}); bump(); }} />
      ) },
    { key: "prov", label: "Provenienz", render: (it) => annStore.isManual(it.id)? "Manuell" : "Auto" },
    { key: "fav",  label: "★", render: (it) => <Star id={it.id} onToggle={()=>{ const a=annStore.get(it.id); annStore.set(it.id,{ favorite: !a.favorite }); bump(); }} active={!!annStore.get(it.id).favorite} /> },
  ];

  const COLUMNS = { checkpoint: CHECKPOINT_COLUMNS, lora: LORA_COLUMNS, embedding: EMB_COLUMNS };

  // ---------- components ----------
  const Summary = () => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card title="Total" value={counts.all} />
      <Card title="Checkpoints" value={counts.checkpoint} />
      <Card title="LoRAs" value={counts.lora} />
      <Card title="Embeddings" value={counts.embedding} />
    </div>
  );

  const Toolbar = () => (
    <div className="flex flex-wrap items-center gap-2">
      {/* API */}
      <input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="API Base (z. B. http://127.0.0.1:8001)" className="w-80 px-3 py-1.5 rounded-lg border border-gray-300 text-sm" />
      <button onClick={detectApi} className="px-3 py-1.5 rounded-xl border bg-white hover:bg-gray-50 text-sm">Detect API</button>

      {/* Scan */}
      <input value={scanRoot} onChange={(e) => setScanRoot(e.target.value)} placeholder="ComfyUI root (z. B. F:\\AI\\ComfyUI)" className="w-72 px-3 py-1.5 rounded-lg border border-gray-300 text-sm" />
      <input value={scanOut}  onChange={(e) => setScanOut(e.target.value)}  placeholder="optional: …\\catalog.json" className="w-64 px-3 py-1.5 rounded-lg border border-gray-300 text-sm" />
      <button onClick={scanNow} disabled={scanning} className="px-3 py-1.5 rounded-xl border bg-white hover:bg-gray-50 text-sm disabled:opacity-50">{scanning ? "Scanning…" : "Scan now"}</button>

      {/* Search + Sort */}
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name/type/base/path" className="ml-auto w-72 px-3 py-1.5 rounded-lg border border-gray-300 text-sm" />
      <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-300 text-sm">
        <option value="name">Sort: Name</option>
        <option value="size">Sort: Size</option>
        <option value="mtime">Sort: Modified</option>
      </select>
      <select value={sortDir} onChange={(e) => setSortDir(e.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-300 text-sm">
        <option value="asc">Asc</option>
        <option value="desc">Desc</option>
      </select>
    </div>
  );

  const Section = ({ title, type, items }) => (
    <details open className="bg-white rounded-2xl shadow-sm border p-0">
      <summary className="select-none cursor-pointer px-4 py-2 text-sm font-medium flex items-center gap-2">
        <span>{title}</span>
        <span className="inline-flex items-center justify-center text-xs bg-gray-100 border rounded-full px-2 py-0.5">{items.length}</span>
      </summary>
      {items.length === 0 ? (
        <div className="px-4 py-3 text-gray-500 text-sm">Keine Einträge.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-t">
              {(COLUMNS[type] || []).map(col => (
                <th key={col.key} className="px-4 py-2">{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t hover:bg-gray-50 align-top">
                {(COLUMNS[type] || []).map(col => (
                  <td key={col.key} className="px-4 py-2">
                    {renderCell(col, it)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );

  const renderCell = (col, it) => {
    if (col.render) return col.render(it);
    if (col.key === "size") return prettyBytes(it.size);
    if (col.key === "path") return <span title={it.path} className="truncate inline-block max-w-[48ch] align-middle">{it.path}</span>;
    return it[col.key];
  };

  return (
    <div className="p-6 space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold">ComfyDash v1.1</h1>
        <Toolbar />
        <div className="text-xs text-gray-500">{meta.comfyui_root ? `Root: ${meta.comfyui_root}` : ""}</div>
        <div className="text-xs text-gray-500">Showing {filtered.length} of {items.length} items</div>
        <Summary />
      </header>

      <main className="space-y-5">
        {loading ? (
          <div className="text-gray-500">Lädt …</div>
        ) : (
          <>
            <Section title="Checkpoints" type="checkpoint" items={groups.checkpoint} />
            <Section title="LoRAs" type="lora" items={groups.lora} />
            <Section title="Embeddings" type="embedding" items={groups.embedding} />
          </>
        )}
      </main>
    </div>
  );
}

// ---------- small UI bits ----------
function Card({ title, value }) {
  return (
    <div className="rounded-2xl border bg-white shadow-sm p-4">
      <div className="text-xs text-gray-500">{title}</div>
      <div className="text-2xl font-semibold leading-tight">{value}</div>
    </div>
  );
}

function Flag({ value }) {
  return <span className={`inline-block text-xs px-2 py-0.5 rounded-full border ${value? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-500'}`}>{value? 'Ja' : '–'}</span>;
}

function Star({ active, onToggle }) {
  return (
    <button onClick={onToggle} className={`text-base ${active? 'text-yellow-500' : 'text-gray-400'} hover:scale-110`} title={active? 'Favorit entfernen' : 'Als Favorit markieren'}>★</button>
  );
}

function SelectBase({ id, current, onChange, opts }) {
  return (
    <div className="flex items-center gap-2">
      <select
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1 rounded-md border text-sm"
      >
        {opts.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <BaseBadge value={current} />
    </div>
  );
}

function EditableText({ id, field, placeholder, ann, onChange }) {
  const val = ann?.[field] || "";
  return (
    <input value={val} placeholder={placeholder} onChange={(e)=>{ annStore.set(id, { [field]: e.target.value }); onChange?.(); }} className="w-full px-2 py-1 rounded-md border text-sm" />
  );
}

function EditableUrl({ id, field, ann, onChange }) {
  const v = ann?.[field] || "";
  return (
    <div className="flex items-center gap-2">
      <input value={v} onChange={(e)=>{ annStore.set(id, { [field]: e.target.value }); onChange?.(); }} placeholder="https://…" className="w-full px-2 py-1 rounded-md border text-sm" />
      {v ? <a href={v} target="_blank" className="text-blue-600 text-sm underline">Open</a> : null}
    </div>
  );
}

function EditableLink({ id, fieldTitle, fieldLink, ann, onChange }) {
  const title = ann?.[fieldTitle] || "";
  const link  = ann?.[fieldLink]  || "";
  return (
    <div className="flex items-center gap-2">
      <input value={title} onChange={(e)=>{ annStore.set(id, { [fieldTitle]: e.target.value }); onChange?.(); }} placeholder="Titel…" className="w-full px-2 py-1 rounded-md border text-sm" />
      {link ? <a href={link} target="_blank" className="text-blue-600 text-sm underline">Open</a> : null}
    </div>
  );
}

function BaseBadge({ value }) {
  const v = (value || "").toLowerCase();
  const conf = {
    sd15:  { label: "SD 1.5", cls: "bg-blue-50 text-blue-700 border-blue-200" },
    sdxl:  { label: "SDXL",   cls: "bg-purple-50 text-purple-700 border-purple-200" },
    flux:  { label: "FLUX",    cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    pony:  { label: "PONY",    cls: "bg-amber-50 text-amber-700 border-amber-200" },
  }[v] || { label: value || "?", cls: "bg-gray-50 text-gray-600 border-gray-200" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] leading-4 ${conf.cls}`}>
      {conf.label}
    </span>
  );
}
