import { useEffect, useMemo, useState, useRef } from "react";

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
  set(id, patch) { 
    const a = this.load(); 
    // Only mark as manual if changing content fields (not favorite or base)
    const isContentChange = Object.keys(patch).some(k => !['favorite', 'base'].includes(k));
    a[id] = { ...(a[id]||{}), ...patch };
    if (isContentChange) a[id]._manual = true;
    this.save(); 
  },
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
    // New metadata fields from scanner
    trigger: raw.trigger || "",
    tags: raw.tags || "",
    civitai_url: raw.civitai_url || "",
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
  
  // Selection for CivitAI enrichment
  const selectedIdsRef = useRef(new Set());
  const [selectionCount, setSelectionCount] = useState(0);
  
  const toggleSelection = (id) => {
    if (selectedIdsRef.current.has(id)) {
      selectedIdsRef.current.delete(id);
    } else {
      selectedIdsRef.current.add(id);
    }
    setSelectionCount(selectedIdsRef.current.size);
  };
  
  // Accordion state (manual control)
  const [accordionOpen, setAccordionOpen] = useState({
    checkpoint: false,
    lora: false,
    embedding: false
  });

  // force rerender helper
  const [annotations, setAnnotations] = useState(() => annStore.load());
  const updateAnnotation = (id, patch) => {
    annStore.set(id, patch);
    setAnnotations({ ...annStore.load() });
  };

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
  
  // CivitAI enrichment
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState({ current: 0, total: 0 });
  
  const enrichFromCivitAI = async () => {
    const selectedItems = items.filter(it => selectedIdsRef.current.has(it.id));
    if (selectedItems.length === 0) {
      alert("Keine Items ausgewählt!");
      return;
    }
    
    if (!confirm(`${selectedItems.length} Items bei CivitAI suchen?\n\nWARNUNG: Gefundene Daten von CivitAI überschreiben alle manuell erfassten Daten (Titel, Link, Trigger).\n\nDies kann einige Minuten dauern.`)) {
      return;
    }
    
    setEnriching(true);
    setEnrichProgress({ current: 0, total: selectedItems.length });
    
    const results = [];
    
    for (let i = 0; i < selectedItems.length; i++) {
      const item = selectedItems[i];
      setEnrichProgress({ current: i + 1, total: selectedItems.length });
      
      try {
        const res = await fetch(`${apiBase}/enrich-civitai`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: item.path }),
        });
        
        const payload = await res.json();
        
        if (res.ok && payload.data?.found) {
          const data = payload.data;
          // Update item with CivitAI data and reset manual flag
          const updates = {
            civitai_link: data.url,
            civitai_title: data.model_name,
            trigger: data.trained_words?.join(', ') || item.trigger,
          };
          // Store in annStore directly and remove _manual flag
          const a = annStore.load();
          a[item.id] = { ...(a[item.id] || {}), ...updates };
          delete a[item.id]._manual; // Force back to Auto
          annStore.save();
          setAnnotations({ ...annStore.load() });
          
          results.push({ success: true, item: item.name, data });
        } else {
          results.push({ success: false, item: item.name, error: payload.data?.error || 'Unknown error' });
        }
        
        // Rate limiting: 500ms delay between requests
        if (i < selectedItems.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (e) {
        results.push({ success: false, item: item.name, error: e.message });
      }
    }
    
    setEnriching(false);
    setEnrichProgress({ current: 0, total: 0 });
    
    // Show summary
    const successCount = results.filter(r => r.success).length;
    alert(`Fertig!\n${successCount}/${selectedItems.length} Items gefunden auf CivitAI.`);
    
    // Clear selection
    selectedIdsRef.current.clear();
    setSelectionCount(0);
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
    { key: "_select", label: "", render: (it) => (
        <input 
          type="checkbox" 
          defaultChecked={selectedIdsRef.current.has(it.id)} 
          onChange={() => toggleSelection(it.id)}
          onClick={(e) => e.stopPropagation()}
          className="cursor-pointer"
        />
      ) },
    { key: "file_name", label: "Name" },
    { key: "civitai_title", label: "CivitAI‑Titel 🔗", render: (it) => (
        <EditableLink id={it.id} fieldTitle="civitai_title" fieldLink="civitai_link" ann={annotations[it.id] || {}} onChange={(patch) => updateAnnotation(it.id, patch)} />
      ) },
    { key: "base", label: "Base‑Model", render: (it) => (
        <SelectBase id={it.id} current={(annotations[it.id] || {}).base || it.base} onChange={(v)=> updateAnnotation(it.id, { base: v })} opts={BASE_OPTIONS} />
      ) },
    { key: "realistic", label: "📷 Realistisch", render: (it) => { 
        const manualRealistic = (annotations[it.id] || {}).realistic;
        const autoRealistic = inferSuitabilityCheckpoint(it.name).realistic;
        const isChecked = manualRealistic !== undefined ? manualRealistic : autoRealistic;
        return (
          <input 
            type="checkbox" 
            checked={isChecked}
            onChange={(e) => updateAnnotation(it.id, { realistic: e.target.checked })}
            onClick={(e) => e.stopPropagation()}
            className="cursor-pointer"
          />
        );
      } },
    { key: "drawing", label: "✏️ Zeichnung", render: (it) => { 
        const manualDrawing = (annotations[it.id] || {}).drawing;
        const autoDrawing = inferSuitabilityCheckpoint(it.name).drawing;
        const isChecked = manualDrawing !== undefined ? manualDrawing : autoDrawing;
        return (
          <input 
            type="checkbox" 
            checked={isChecked}
            onChange={(e) => updateAnnotation(it.id, { drawing: e.target.checked })}
            onClick={(e) => e.stopPropagation()}
            className="cursor-pointer"
          />
        );
      } },
    { key: "sampler", label: "Sampler (Empf.)", render: (it) => presetsForCheckpoint(it.name).sampler },
    { key: "steps",   label: "Steps (Empf.)",          render: (it) => presetsForCheckpoint(it.name).steps },
    { key: "cfg",     label: "CFG (Empf.)",            render: (it) => presetsForCheckpoint(it.name).cfg },
    { key: "civitai_link", label: "CivitAI‑Link", render: (it) => (
        <EditableUrl id={it.id} field="civitai_link" ann={annotations[it.id] || {}} onChange={(patch)=> updateAnnotation(it.id, patch)} />
      ) },
    { key: "prov", label: "Provenienz", render: (it) => annStore.isManual(it.id)? "Manuell" : "Auto" },
    { key: "fav",  label: "★", render: (it) => <Star id={it.id} onToggle={()=> updateAnnotation(it.id, { favorite: !(annotations[it.id] || {}).favorite })} active={!!(annotations[it.id] || {}).favorite} /> },
  ];

  const LORA_COLUMNS = [
    { key: "_select", label: "", render: (it) => (
        <input 
          type="checkbox" 
          defaultChecked={selectedIdsRef.current.has(it.id)} 
          onChange={() => toggleSelection(it.id)}
          onClick={(e) => e.stopPropagation()}
          className="cursor-pointer"
        />
      ) },
    { key: "file_name", label: "Name" },
    { key: "civitai_title", label: "CivitAI‑Titel 🔗", render: (it) => (
        <EditableLink id={it.id} fieldTitle="civitai_title" fieldLink="civitai_link" ann={annotations[it.id] || {}} onChange={(patch) => updateAnnotation(it.id, patch)} />
      ) },
    { key: "base", label: "Base‑Model", render: (it) => (
        <SelectBase id={it.id} current={(annotations[it.id] || {}).base || it.base} onChange={(v)=> updateAnnotation(it.id, { base: v })} opts={BASE_OPTIONS} />
      ) },
    { key: "trigger", label: "Trigger", render: (it) => {
        const manualTrigger = (annotations[it.id] || {}).trigger;
        const autoTrigger = it.trigger;
        const displayTrigger = manualTrigger || autoTrigger || '';
        return (
          <input 
            value={displayTrigger} 
            onChange={(e)=> updateAnnotation(it.id, { trigger: e.target.value })} 
            onClick={(e) => e.stopPropagation()} 
            placeholder={autoTrigger ? `Auto: ${autoTrigger}` : "Trigger…"}
            className="w-full px-2 py-1 rounded-md border text-sm" 
          />
        );
      } },
    { key: "tags", label: "Tags", render: (it) => (
        <span className="text-xs text-gray-600" title={it.tags}>{it.tags ? (it.tags.length > 50 ? it.tags.substring(0, 50) + '…' : it.tags) : '–'}</span>
      ) },
    { key: "civitai_link", label: "CivitAI‑Link", render: (it) => (
        <EditableUrl id={it.id} field="civitai_link" ann={annotations[it.id] || {}} onChange={(patch)=> updateAnnotation(it.id, patch)} />
      ) },
    { key: "prov", label: "Provenienz", render: (it) => annStore.isManual(it.id)? "Manuell" : "Auto" },
    { key: "fav",  label: "★", render: (it) => <Star id={it.id} onToggle={()=> updateAnnotation(it.id, { favorite: !(annotations[it.id] || {}).favorite })} active={!!(annotations[it.id] || {}).favorite} /> },
  ];

  const EMB_COLUMNS = [
    { key: "_select", label: "", render: (it) => (
        <input 
          type="checkbox" 
          defaultChecked={selectedIdsRef.current.has(it.id)} 
          onChange={() => toggleSelection(it.id)}
          onClick={(e) => e.stopPropagation()}
          className="cursor-pointer"
        />
      ) },
    { key: "file_name", label: "Name" },
    { key: "civitai_title", label: "CivitAI‑Titel 🔗", render: (it) => (
        <EditableLink id={it.id} fieldTitle="civitai_title" fieldLink="civitai_link" ann={annotations[it.id] || {}} onChange={(patch) => updateAnnotation(it.id, patch)} />
      ) },
    { key: "base", label: "Base‑Model", render: (it) => (
        <SelectBase id={it.id} current={(annotations[it.id] || {}).base || it.base} onChange={(v)=> updateAnnotation(it.id, { base: v })} opts={BASE_OPTIONS} />
      ) },
    { key: "civitai_link", label: "CivitAI‑Link", render: (it) => (
        <EditableUrl id={it.id} field="civitai_link" ann={annotations[it.id] || {}} onChange={(patch)=> updateAnnotation(it.id, patch)} />
      ) },
    { key: "prov", label: "Provenienz", render: (it) => annStore.isManual(it.id)? "Manuell" : "Auto" },
    { key: "fav",  label: "★", render: (it) => <Star id={it.id} onToggle={()=> updateAnnotation(it.id, { favorite: !(annotations[it.id] || {}).favorite })} active={!!(annotations[it.id] || {}).favorite} /> },
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
      <button onClick={detectApi} className="px-3 py-1.5 rounded-xl border-2 border-blue-500 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium">Detect API</button>

      {/* Scan */}
      <input value={scanRoot} onChange={(e) => setScanRoot(e.target.value)} placeholder="ComfyUI root (z. B. F:\\AI\\ComfyUI)" className="w-72 px-3 py-1.5 rounded-lg border border-gray-300 text-sm" />
      <input value={scanOut}  onChange={(e) => setScanOut(e.target.value)}  placeholder="optional: …\\catalog.json" className="w-64 px-3 py-1.5 rounded-lg border border-gray-300 text-sm" />
      <button onClick={scanNow} disabled={scanning} className="px-3 py-1.5 rounded-xl border-2 border-blue-500 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">{scanning ? "Scanning…" : "Scan now"}</button>
      <button onClick={enrichFromCivitAI} disabled={selectionCount === 0 || enriching} className="px-3 py-1.5 rounded-xl border-2 border-green-500 bg-green-500 hover:bg-green-600 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
        {enriching ? `🔍 Searching... (${enrichProgress.current}/${enrichProgress.total})` : `🔍 Find selected on CivitAI (${selectionCount})`}
      </button>

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

  const Section = ({ title, type, items }) => {
    const allIds = items.map(it => it.id);
    const allSelected = allIds.length > 0 && allIds.every(id => selectedIdsRef.current.has(id));
    
    const toggleSelectAll = () => {
      if (allSelected) {
        // Deselect all
        allIds.forEach(id => selectedIdsRef.current.delete(id));
      } else {
        // Select all
        allIds.forEach(id => selectedIdsRef.current.add(id));
      }
      setSelectionCount(selectedIdsRef.current.size);
    };
    
    return (
      <div className="bg-white rounded-2xl shadow-sm border p-0">
        <div 
          onClick={() => setAccordionOpen(prev => ({ ...prev, [type]: !prev[type] }))}
          className="select-none cursor-pointer px-4 py-2 text-sm font-medium flex items-center gap-2 hover:bg-gray-50"
        >
          <span>{accordionOpen[type] ? '▼' : '▶'}</span>
          <span>{title}</span>
          <span className="inline-flex items-center justify-center text-xs bg-gray-100 border rounded-full px-2 py-0.5">{items.length}</span>
        </div>
        {accordionOpen[type] && (
          items.length === 0 ? (
            <div className="px-4 py-3 text-gray-500 text-sm">Keine Einträge.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-t">
                  {(COLUMNS[type] || []).map(col => (
                    <th key={col.key} className="px-4 py-2">
                      {col.key === '_select' ? (
                        <input 
                          type="checkbox" 
                          checked={allSelected}
                          onChange={toggleSelectAll}
                          onClick={(e) => e.stopPropagation()}
                          className="cursor-pointer"
                          title="Select All"
                        />
                      ) : col.label}
                    </th>
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
          )
        )}
      </div>
    );
  };

  const renderCell = (col, it) => {
    if (col.render) return col.render(it);
    if (col.key === "size") return prettyBytes(it.size);
    if (col.key === "path") return <span title={it.path} className="truncate inline-block max-w-[48ch] align-middle">{it.path}</span>;
    return it[col.key];
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 bg-gray-50 p-6 space-y-3 border-b border-gray-200 shadow-sm">
        <h1 className="text-2xl font-semibold">ComfyDash v1.2</h1>
        <Toolbar />
        <div className="text-xs text-gray-500">{meta.comfyui_root ? `Root: ${meta.comfyui_root}` : ""}</div>
        <div className="text-xs text-gray-500">Showing {filtered.length} of {items.length} items</div>
        <Summary />
      </header>

      <main className="p-6 space-y-5">
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
  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onToggle();
  };
  return (
    <button onClick={handleClick} className={`text-base ${active? 'text-yellow-500' : 'text-gray-400'} hover:scale-110`} title={active? 'Favorit entfernen' : 'Als Favorit markieren'}>★</button>
  );
}

function SelectBase({ id, current, onChange, opts }) {
  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
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
    <input value={val} placeholder={placeholder} onChange={(e)=> onChange({ [field]: e.target.value })} onClick={(e) => e.stopPropagation()} className="w-full px-2 py-1 rounded-md border text-sm" />
  );
}

function EditableUrl({ id, field, ann, onChange }) {
  const v = ann?.[field] || "";
  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <input value={v} onChange={(e)=> onChange({ [field]: e.target.value })} placeholder="https://…" className="w-full px-2 py-1 rounded-md border text-sm" />
      {v ? <a href={v} target="_blank" className="text-blue-600 text-sm underline">Open</a> : null}
    </div>
  );
}

function EditableLink({ id, fieldTitle, fieldLink, ann, onChange }) {
  const title = ann?.[fieldTitle] || "";
  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <input value={title} onChange={(e)=> onChange({ [fieldTitle]: e.target.value })} placeholder="Titel…" className="w-full px-2 py-1 rounded-md border text-sm" />
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
