import React, { useEffect, useMemo, useState, useRef } from "react";

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
  
  // ComfyUI launch
  const [comfyUrl, setComfyUrl] = useLocalStorage("cd.comfy.url", "http://127.0.0.1:8188");
  const [startingComfy, setStartingComfy] = useState(false);
  const [comfyRunning, setComfyRunning] = useState(false);

  // query/sort
  const [query, setQuery] = useLocalStorage("cd.query", "");
  const [sortBy, setSortBy] = useLocalStorage("cd.sort", "name"); // name|size|mtime
  const [sortDir, setSortDir] = useLocalStorage("cd.dir", "asc"); // asc|desc

  // API + Scan
  const [apiBase, setApiBase] = useLocalStorage("cd.api.base", "http://127.0.0.1:8001");
  const [scanRoot, setScanRoot] = useLocalStorage("cd.scan.root", "");
  const [scanOut, setScanOut]   = useLocalStorage("cd.scan.out", "");
  const [scanning, setScanning] = useState(false);
  const [condaEnv, setCondaEnv] = useLocalStorage("cd.conda.env", "");
  
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

  // Column width management
  const getDefaultWidths = (type) => {
    const defaults = {
      checkpoint: { _select: 40, file_name: 200, civitai_title: 400, base: 140, realistic: 100, drawing: 100, sampler: 140, steps: 100, cfg: 100, civitai_link: 120, fav: 50 },
      lora: { _select: 40, file_name: 200, civitai_title: 400, base: 140, trigger: 250, tags: 200, civitai_link: 120, fav: 50 },
      embedding: { _select: 40, file_name: 200, civitai_title: 400, base: 140, civitai_link: 120, fav: 50 }
    };
    return defaults[type] || {};
  };

  const [columnWidths, setColumnWidths] = useState(() => {
    const stored = localStorage.getItem('cd.columnWidths');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return {};
      }
    }
    return {};
  });

  const getColumnWidth = (type, key) => {
    return columnWidths[type]?.[key] || getDefaultWidths(type)[key] || 150;
  };

  const setColumnWidth = (type, key, width) => {
    const newWidths = {
      ...columnWidths,
      [type]: {
        ...(columnWidths[type] || {}),
        [key]: Math.max(50, width) // Minimum 50px
      }
    };
    setColumnWidths(newWidths);
    localStorage.setItem('cd.columnWidths', JSON.stringify(newWidths));
  };

  // Resizing state
  const [resizing, setResizing] = useState(null);

  // Mouse handlers for column resizing
  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (e) => {
      if (!resizing) return;
      const delta = e.clientX - resizing.startX;
      const newWidth = resizing.startWidth + delta;
      setColumnWidth(resizing.type, resizing.key, newWidth);
    };

    const handleMouseUp = () => {
      setResizing(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing]);

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
        const t = setTimeout(() => ctrl.abort(), 1500);
        const res = await fetch(`${host}:${p}/health`, { signal: ctrl.signal });
        clearTimeout(t);
        if (res.ok) { 
          setApiBase(`${host}:${p}`); 
          return true;
        }
      } catch {}
    }
    // Don't show alert on initial load - only when user clicks Detect API button
    return false;
  };

  // basic loaders
  const scanNow = async () => {
    if (!scanRoot) { alert("Please specify ComfyUI root!"); return; }
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

  const checkComfyStatus = async () => {
  try {
    const u = new URL(comfyUrl);
    const host = u.hostname || "127.0.0.1";
    const port = u.port ? parseInt(u.port, 10) : 8188;
    const res = await fetch(`${apiBase}/comfyui/status?host=${host}&port=${port}`, { cache: "no-store" });
    const j = await res.json();
    const running = res.ok && j.ok && !!j.running;
    setComfyRunning(running);
    return running;
  } catch {
    setComfyRunning(false);
    return false;
  }
};

const openComfyTab = () => {
  window.open(comfyUrl, "_blank", "noopener,noreferrer");
};

const startOrOpenComfy = async () => {
  if (!scanRoot) { alert("Please specify ComfyUI root first!"); return; }
  setStartingComfy(true);

  // 1) Already running?
  if (await checkComfyStatus()) { openComfyTab(); setStartingComfy(false); return; }

  // 2) Start ComfyUI
  try {
    const u = new URL(comfyUrl);
    const port = u.port ? parseInt(u.port, 10) : 8188;
    await fetch(`${apiBase}/comfyui/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root: scanRoot, port, conda_env: condaEnv || undefined }),
    });
  } catch (e) {
    alert("Failed to start ComfyUI: " + (e?.message || e));
    setStartingComfy(false);
    return;
  }

  // 3) Poll until reachable (max 120s)
  const t0 = Date.now();
  while (Date.now() - t0 < 120_000) {
    if (await checkComfyStatus()) { 
      setStartingComfy(false);
      // Don't auto-open - show button instead to avoid popup blocker
      return;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  setStartingComfy(false);
  alert("ComfyUI startup timeout - please check manually");
};

  
  // CivitAI enrichment
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState({ current: 0, total: 0, currentFile: '' });
  
  const enrichFromCivitAI = async () => {
    const selectedItems = items.filter(it => selectedIdsRef.current.has(it.id));
    if (selectedItems.length === 0) {
      alert("No items selected!");
      return;
    }
    
    if (!confirm(`Search ${selectedItems.length} items on CivitAI?\n\nWARNING: Found data from CivitAI will overwrite all manually entered data (title, link, trigger).\n\nThis may take several minutes.`)) {
      return;
    }
    
    setEnriching(true);
    setEnrichProgress({ current: 0, total: selectedItems.length });
    
    const results = [];
    
    for (let i = 0; i < selectedItems.length; i++) {
      const item = selectedItems[i];
      setEnrichProgress({ current: i + 1, total: selectedItems.length, currentFile: item.name });
      
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
    setEnrichProgress({ current: 0, total: 0, currentFile: '' });
    
    // Show summary
    const successCount = results.filter(r => r.success).length;
    alert(`Done!\n${successCount}/${selectedItems.length} items found on CivitAI.`);
    
    // Clear selection
    selectedIdsRef.current.clear();
    setSelectionCount(0);
  };

  useEffect(() => { 
    detectApi(); 
    // Check ComfyUI status on mount
    checkComfyStatus();
  }, []);

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
      // Get value from annotations if available, otherwise from item
      const getVal = (item, key) => {
        const ann = annotations[item.id] || {};
        if (key === 'civitai_title') return ann.civitai_title || item.name || "";
        if (key === 'base') return ann.base || item.base || "";
        if (key === 'trigger') return ann.trigger || item.trigger || "";
        return item[key] ?? "";
      };
      
      const A = getVal(a, sortBy);
      const B = getVal(b, sortBy);
      
      if (A === B) return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * dir;
      if (typeof A === "number" && typeof B === "number") return (A - B) * dir;
      // Case-insensitive string comparison
      return String(A).localeCompare(String(B), undefined, { sensitivity: 'base' }) * dir;
    });
    return list;
  }, [items, query, sortBy, sortDir, annotations]);

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

  // ----- per-type column defs -----
  const BASE_OPTIONS = ["sd15", "sdxl", "flux", "pony", "cascade"];

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
    { key: "file_name", label: "Path" },
    { key: "civitai_title", label: "Name", render: (it) => (
        <EditableLink id={it.id} fieldTitle="civitai_title" fieldLink="civitai_link" ann={annotations[it.id] || {}} onChange={(patch) => updateAnnotation(it.id, patch)} />
      ) },
    { key: "base", label: "Base-Model", render: (it) => (
        <SelectBase id={it.id} current={(annotations[it.id] || {}).base || it.base} onChange={(v)=> updateAnnotation(it.id, { base: v })} opts={BASE_OPTIONS} />
      ) },
    { key: "realistic", label: "📷 Realistic", render: (it) => { 
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
    { key: "drawing", label: "✏️ Drawing", render: (it) => { 
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
    { key: "sampler", label: "Sampler (Rec.)", render: (it) => presetsForCheckpoint(it.name).sampler },
    { key: "steps",   label: "Steps (Rec.)",          render: (it) => presetsForCheckpoint(it.name).steps },
    { key: "cfg",     label: "CFG (Rec.)",            render: (it) => presetsForCheckpoint(it.name).cfg },
    { key: "civitai_link", label: "CivitAI-Link", render: (it) => (
        <EditableUrl id={it.id} field="civitai_link" ann={annotations[it.id] || {}} onChange={(patch)=> updateAnnotation(it.id, patch)} />
      ) },
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
    { key: "file_name", label: "Path" },
    { key: "civitai_title", label: "Name", render: (it) => (
        <EditableLink id={it.id} fieldTitle="civitai_title" fieldLink="civitai_link" ann={annotations[it.id] || {}} onChange={(patch) => updateAnnotation(it.id, patch)} />
      ) },
    { key: "base", label: "Base-Model", render: (it) => (
        <SelectBase id={it.id} current={(annotations[it.id] || {}).base || it.base} onChange={(v)=> updateAnnotation(it.id, { base: v })} opts={BASE_OPTIONS} />
      ) },
    { key: "trigger", label: "Trigger", render: (it) => (
        <TriggerInput 
          id={it.id} 
          autoTrigger={it.trigger} 
          ann={annotations[it.id] || {}} 
          onChange={(patch) => updateAnnotation(it.id, patch)} 
        />
      ) },
    { key: "tags", label: "Tags", render: (it) => (
        <span className="text-xs text-gray-600" title={it.tags}>{it.tags ? (it.tags.length > 50 ? it.tags.substring(0, 50) + '…' : it.tags) : '–'}</span>
      ) },
    { key: "civitai_link", label: "CivitAI-Link", render: (it) => (
        <EditableUrl id={it.id} field="civitai_link" ann={annotations[it.id] || {}} onChange={(patch)=> updateAnnotation(it.id, patch)} />
      ) },
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
    { key: "file_name", label: "Path" },
    { key: "civitai_title", label: "Name", render: (it) => (
        <EditableLink id={it.id} fieldTitle="civitai_title" fieldLink="civitai_link" ann={annotations[it.id] || {}} onChange={(patch) => updateAnnotation(it.id, patch)} />
      ) },
    { key: "base", label: "Base-Model", render: (it) => (
        <SelectBase id={it.id} current={(annotations[it.id] || {}).base || it.base} onChange={(v)=> updateAnnotation(it.id, { base: v })} opts={BASE_OPTIONS} />
      ) },
    { key: "civitai_link", label: "CivitAI-Link", render: (it) => (
        <EditableUrl id={it.id} field="civitai_link" ann={annotations[it.id] || {}} onChange={(patch)=> updateAnnotation(it.id, patch)} />
      ) },
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
      <DebouncedInput value={apiBase} onChange={setApiBase} placeholder="API Base (e.g. http://127.0.0.1:8001)" className="w-80 px-3 py-1.5 rounded-lg border border-gray-300 text-sm" />
      <button onClick={async () => {
        const found = await detectApi();
        if (!found) {
          alert("No running API found (ports 8000–8019). Start mini_server.py?");
        }
      }} className="px-3 py-1.5 rounded-xl border-2 border-blue-500 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium">Detect API</button>

      {/* Scan */}
      <DebouncedInput value={scanRoot} onChange={setScanRoot} placeholder="ComfyUI root (e.g. F:\\AI\\ComfyUI)" className="w-72 px-3 py-1.5 rounded-lg border border-gray-300 text-sm" />
      <DebouncedInput value={scanOut} onChange={setScanOut} placeholder="optional: ...\\catalog.json" className="w-64 px-3 py-1.5 rounded-lg border border-gray-300 text-sm" />
      <DebouncedInput value={condaEnv} onChange={setCondaEnv} placeholder="optional: Conda Env (e.g. comfyui)" className="w-56 px-3 py-1.5 rounded-lg border border-gray-300 text-sm" />
      <button onClick={scanNow} disabled={scanning} className="px-3 py-1.5 rounded-xl border-2 border-blue-500 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">{scanning ? "Scanning..." : "Scan now"}</button>
      <button onClick={enrichFromCivitAI} disabled={selectionCount === 0 || enriching} className="px-3 py-1.5 rounded-xl border-2 border-green-500 bg-green-500 hover:bg-green-600 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
        {enriching ? `🔍 Searching... (${enrichProgress.current}/${enrichProgress.total})` : `🔍 Find selected on CivitAI (${selectionCount})`}
      </button>
      
      {/* Show either Start button OR Running button, not both */}
      {!comfyRunning && (
        <button onClick={startOrOpenComfy} disabled={startingComfy || !scanRoot} className="px-3 py-1.5 rounded-xl border-2 border-orange-500 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
          {startingComfy ? "🚀 Starting ComfyUI..." : "🚀 Open ComfyUI"}
        </button>
      )}
      
      {/* ComfyUI Running Status */}
      {comfyRunning && (
        <button onClick={openComfyTab} className="px-3 py-1.5 rounded-xl border-2 border-green-600 bg-green-600 hover:bg-green-700 text-white text-sm font-medium">
          ✅ ComfyUI is running - Click to open
        </button>
      )}

      {/* Search */}
      <DebouncedInput value={query} onChange={setQuery} placeholder="Search name/type/base/path" className="ml-auto w-72 px-3 py-1.5 rounded-lg border border-gray-300 text-sm" />
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
    
    const handleSort = (key) => {
      if (key === '_select' || key === 'fav') return; // Don't sort by these
      
      if (sortBy === key) {
        // Toggle direction if same column
        setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
      } else {
        // New column, default to ascending
        setSortBy(key);
        setSortDir('asc');
      }
    };
    
    const getSortIndicator = (key) => {
      if (sortBy !== key) return null;
      return sortDir === 'asc' ? ' ↑' : ' ↓';
    };

    const startResize = (key, e) => {
      e.preventDefault();
      e.stopPropagation();
      setResizing({
        type,
        key,
        startX: e.clientX,
        startWidth: getColumnWidth(type, key)
      });
    };
    
    return (
      <div className="bg-white rounded-2xl shadow-sm border p-0 overflow-hidden">
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
            <div className="px-4 py-3 text-gray-500 text-sm">No entries.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                <thead>
                  <tr className="text-left text-gray-500 border-t">
                    {(COLUMNS[type] || []).map((col, idx) => (
                      <th 
                        key={col.key} 
                        className={`px-4 py-2 relative ${col.key !== '_select' && col.key !== 'fav' ? 'cursor-pointer hover:bg-gray-100 select-none' : ''}`}
                        style={{ width: `${getColumnWidth(type, col.key)}px` }}
                        onClick={() => handleSort(col.key)}
                      >
                        {col.key === '_select' ? (
                          <input 
                            type="checkbox" 
                            checked={allSelected}
                            onChange={toggleSelectAll}
                            onClick={(e) => e.stopPropagation()}
                            className="cursor-pointer"
                            title="Select All"
                          />
                        ) : (
                          <span>{col.label}{getSortIndicator(col.key)}</span>
                        )}
                        {/* Resize handle */}
                        {idx < (COLUMNS[type] || []).length - 1 && (
                          <div
                            className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-400 group"
                            onMouseDown={(e) => startResize(col.key, e)}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="h-full w-1 group-hover:bg-blue-400" />
                          </div>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-t hover:bg-gray-50 align-top">
                      {(COLUMNS[type] || []).map(col => (
                        <td 
                          key={col.key} 
                          className="px-4 py-2 overflow-hidden"
                          style={{ width: `${getColumnWidth(type, col.key)}px` }}
                        >
                          {renderCell(col, it)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    );
  };

  const renderCell = (col, it) => {
    if (col.render) return col.render(it);
    if (col.key === "size") return prettyBytes(it.size);
    if (col.key === "path") return <span title={it.path} className="truncate inline-block max-w-full align-middle">{it.path}</span>;
    return it[col.key];
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* CivitAI Enrichment Progress Overlay */}
      {enriching && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-lg w-full mx-4">
            <h2 className="text-xl font-semibold mb-4">🔍 Searching on CivitAI...</h2>
            
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-2">
                <span>Progress: {enrichProgress.current} / {enrichProgress.total}</span>
                <span>{Math.round((enrichProgress.current / enrichProgress.total) * 100)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                <div 
                  className="bg-blue-500 h-full transition-all duration-300 ease-out"
                  style={{ width: `${(enrichProgress.current / enrichProgress.total) * 100}%` }}
                />
              </div>
            </div>
            
            <div className="text-sm text-gray-600 mt-4">
              <div className="font-medium mb-1">Current file:</div>
              <div className="bg-gray-50 rounded-lg p-3 text-xs break-all border">
                {enrichProgress.currentFile}
              </div>
            </div>
            
            <div className="mt-6 text-xs text-gray-500 text-center">
              Please wait... This may take several minutes.
            </div>
          </div>
        </div>
      )}

      <header className="sticky top-0 z-10 bg-gray-50 p-6 space-y-3 border-b border-gray-200 shadow-sm">
        <h1 className="text-2xl font-semibold">ComfyDash v2.0.2</h1>
        <Toolbar />
        <div className="text-xs text-gray-500">{meta.comfyui_root ? `Root: ${meta.comfyui_root}` : ""}</div>
        <div className="text-xs text-gray-500">Showing {filtered.length} of {items.length} items</div>
        <Summary />
      </header>

      <main className="p-6 space-y-5">
        {loading ? (
          <div className="text-gray-500">Loading...</div>
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
  return <span className={`inline-block text-xs px-2 py-0.5 rounded-full border ${value? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-500'}`}>{value? 'Yes' : '–'}</span>;
}

function Star({ active, onToggle }) {
  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onToggle();
  };
  return (
    <button onClick={handleClick} className={`text-base ${active? 'text-yellow-500' : 'text-gray-400'} hover:scale-110`} title={active? 'Remove from favorites' : 'Mark as favorite'}>★</button>
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

const EditableText = React.memo(function EditableText({ id, field, placeholder, ann, onChange }) {
  const [localValue, setLocalValue] = useState(ann?.[field] || "");
  const isEditingRef = useRef(false);
  
  useEffect(() => {
    // Only update if we're not currently editing
    if (!isEditingRef.current) {
      setLocalValue(ann?.[field] || "");
    }
  }, [ann?.[field]]);
  
  const handleFocus = () => {
    isEditingRef.current = true;
  };
  
  const handleBlur = () => {
    isEditingRef.current = false;
    if (localValue !== (ann?.[field] || "")) {
      onChange({ [field]: localValue });
    }
  };
  
  return (
    <input 
      value={localValue} 
      placeholder={placeholder} 
      onChange={(e) => setLocalValue(e.target.value)} 
      onFocus={handleFocus}
      onBlur={handleBlur}
      onClick={(e) => e.stopPropagation()} 
      className="w-full px-2 py-1 rounded-md border text-sm" 
    />
  );
});

const EditableUrl = React.memo(function EditableUrl({ id, field, ann, onChange }) {
  const [localValue, setLocalValue] = useState(ann?.[field] || "");
  const isEditingRef = useRef(false);
  
  useEffect(() => {
    if (!isEditingRef.current) {
      setLocalValue(ann?.[field] || "");
    }
  }, [ann?.[field]]);
  
  const handleFocus = () => {
    isEditingRef.current = true;
  };
  
  const handleBlur = () => {
    isEditingRef.current = false;
    if (localValue !== (ann?.[field] || "")) {
      onChange({ [field]: localValue });
    }
  };
  
  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <input 
        value={localValue} 
        onChange={(e) => setLocalValue(e.target.value)} 
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder="https://…" 
        className="w-full px-2 py-1 rounded-md border text-sm" 
      />
      {localValue ? <a href={localValue} target="_blank" className="text-blue-600 text-sm underline">Open</a> : null}
    </div>
  );
});

const EditableLink = React.memo(function EditableLink({ id, fieldTitle, fieldLink, ann, onChange }) {
  const [localValue, setLocalValue] = useState(ann?.[fieldTitle] || "");
  const isEditingRef = useRef(false);
  
  useEffect(() => {
    if (!isEditingRef.current) {
      setLocalValue(ann?.[fieldTitle] || "");
    }
  }, [ann?.[fieldTitle]]);
  
  const handleFocus = () => {
    isEditingRef.current = true;
  };
  
  const handleBlur = () => {
    isEditingRef.current = false;
    if (localValue !== (ann?.[fieldTitle] || "")) {
      onChange({ [fieldTitle]: localValue });
    }
  };
  
  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <input 
        value={localValue} 
        onChange={(e) => setLocalValue(e.target.value)} 
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder="Title..." 
        className="w-full px-2 py-1 rounded-md border text-sm" 
      />
    </div>
  );
});

const TriggerInput = React.memo(function TriggerInput({ id, autoTrigger, ann, onChange }) {
  const manualTrigger = ann?.trigger || "";
  const displayValue = manualTrigger || autoTrigger || "";
  const [localValue, setLocalValue] = useState(displayValue);
  const isEditingRef = useRef(false);
  
  useEffect(() => {
    if (!isEditingRef.current) {
      const newDisplayValue = (ann?.trigger || "") || autoTrigger || "";
      setLocalValue(newDisplayValue);
    }
  }, [ann?.trigger, autoTrigger]);
  
  const handleFocus = () => {
    isEditingRef.current = true;
  };
  
  const handleBlur = () => {
    isEditingRef.current = false;
    const currentManual = ann?.trigger || "";
    if (localValue !== currentManual && localValue !== autoTrigger) {
      onChange({ trigger: localValue });
    }
  };
  
  return (
    <input 
      value={localValue} 
      onChange={(e) => setLocalValue(e.target.value)} 
      onFocus={handleFocus}
      onBlur={handleBlur}
      onClick={(e) => e.stopPropagation()} 
      placeholder={autoTrigger ? `Auto: ${autoTrigger}` : "Trigger..."}
      className="w-full px-2 py-1 rounded-md border text-sm" 
    />
  );
});

function BaseBadge({ value }) {
  const v = (value || "").toLowerCase();
  const conf = {
    sd15:    { label: "SD 1.5",  cls: "bg-blue-50 text-blue-700 border-blue-200" },
    sdxl:    { label: "SDXL",    cls: "bg-purple-50 text-purple-700 border-purple-200" },
    flux:    { label: "FLUX",    cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    pony:    { label: "PONY",    cls: "bg-amber-50 text-amber-700 border-amber-200" },
    cascade: { label: "Cascade", cls: "bg-pink-50 text-pink-700 border-pink-200" },
  }[v] || { label: value || "?", cls: "bg-gray-50 text-gray-600 border-gray-200" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] leading-4 ${conf.cls}`}>
      {conf.label}
    </span>
  );
}

const DebouncedInput = React.memo(function DebouncedInput({ value, onChange, placeholder, className }) {
  const [localValue, setLocalValue] = useState(value);
  const isEditingRef = useRef(false);
  
  useEffect(() => {
    if (!isEditingRef.current) {
      setLocalValue(value);
    }
  }, [value]);
  
  const handleFocus = () => {
    isEditingRef.current = true;
  };
  
  const handleBlur = () => {
    isEditingRef.current = false;
    if (localValue !== value) {
      onChange(localValue);
    }
  };
  
  const handleChange = (e) => {
    setLocalValue(e.target.value);
  };
  
  return (
    <input
      value={localValue}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder}
      className={className}
    />
  );
});
