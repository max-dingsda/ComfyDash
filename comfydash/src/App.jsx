import React, { useMemo, useState, useEffect, useRef } from "react";

// ComfyDash – Dashboard (React SPA)
// • Accordions per type (checkpoint, lora, embedding)
// • Per‑type columns, inline edits (annotations persisted in localStorage)
// • Responsive width toggle (Fit to window / Limit width)
// • Sticky table header + sticky first column
// • Pagination per section (10 rows/page)
// Tailwind v3 compatible

// ---------- Utils ----------
const prettyBytes = (num) => {
  if (typeof num !== "number" || !isFinite(num)) return "–";
  const units = ["B","KB","MB","GB","TB"]; let i = 0; let n = num;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${units[i]}`;
};

const timeAgo = (iso) => {
  if (!iso) return "–";
  const d = new Date(iso);
  if (isNaN(d)) return "–";
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return d.toLocaleString();
};

function normalizeItem(raw) {
  const get = (...keys) => keys.find((k) => k in raw);
  const absPathKey = get("abs_path","absolute_path","path","file","full_path");
  const relPathKey = get("rel_path","relative_path","relative","rel");
  const nameKey = get("name","filename","file_name","basename");
  const typeKey = get("type","ttype","kind","category");
  const sizeKey = get("size","size_bytes","filesize");
  const mtimeKey = get("modified_at","mtime_iso","mtime","last_modified");
  const idKey = get("id","hash","stable_id");

  const abs_path = absPathKey ? raw[absPathKey] : undefined;
  const rel_path = relPathKey ? raw[relPathKey] : undefined;
  const name = nameKey ? raw[nameKey] : (abs_path?.split(/\\|\//).pop() ?? rel_path?.split(/\\|\//).pop());
  const type = (typeKey ? String(raw[typeKey]) : "unknown").toLowerCase();
  const size = sizeKey ? Number(raw[sizeKey]) : undefined;
  const modified_at = mtimeKey ? raw[mtimeKey] : undefined;
  const id = idKey ? String(raw[idKey]) : undefined;

  return { id, type, name, rel_path, abs_path, size, modified_at, _raw: raw };
}

const useLocalStorage = (key, initial) => {
  const [val, setVal] = useState(() => {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : initial; } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }, [key, val]);
  return [val, setVal];
};

// Annotations in localStorage (MVP)
const useAnnotations = () => {
  const [ann, setAnn] = useLocalStorage("cd.annotations", {});
  const get = (id) => (id && ann[id]) || {};
  const set = (id, patch) => setAnn((prev) => ({ ...prev, [id]: { ...(prev[id]||{}), ...patch } }));
  return { get, set };
};

const ensureUrl = (s) => {
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) return s;
  return "https://" + s;
};

// Heuristics for suitability (📷 / ✏️)
function inferSuitabilityFromText(it){
  const text = `${it.name||''} ${it.base_model||''} ${it.arch||''} ${it.triggers||''} ${it.civitai_title||''}`.toLowerCase();
  const drawRe  = /(pony|illustrious|anime|illustration|drawing|comic|cartoon|manga)/;
  const photoRe = /(realistic|photoreal|revanimated|dreamshaper|juggernaut)/;
  const baseRe  = /(sdxl base|refiner|lcm)/;

  let photo = photoRe.test(text);
  let draw  = drawRe.test(text);
  let confPhoto = photo ? 1 : 0;
  let confDraw  = draw  ? 1 : 0;

  if (baseRe.test(text)) {
    photo = true; draw = true;
    confPhoto = Math.max(confPhoto, 0.6);
    confDraw  = Math.max(confDraw, 0.6);
  }
  return { photo, draw, confPhoto, confDraw };
}

// Small UI bits
const BaseBadge = ({ model, conf }) => {
  const label = (model||"unclear").toUpperCase();
  const dot = typeof conf === 'number' ? (conf>=0.75?'●':conf>=0.4?'◐':'○') : '○';
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs">
      <span>{label}</span>
      <span className="opacity-70">{dot}</span>
    </span>
  );
};

const Star = ({ on, onToggle }) => (
  <button title={on?"Unfavorite":"Favorite"} onClick={onToggle} className={`text-lg ${on?"text-yellow-500":"text-gray-400"}`}>★</button>
);

const SortIcon = ({ dir }) => (
  <span className="inline-block ml-1 opacity-60 select-none">{dir === "asc" ? "▲" : "▼"}</span>
);

function SuitIcon({ kind, value, conf = 0, onToggle }){
  // kind: 'photo' | 'draw'
  const icon = kind==='photo' ? '📷' : '✏️';
  const on = !!value;
  const ring = on ? (conf>=0.9? 'ring-2 ring-green-600' : 'ring ring-green-400') : 'ring ring-gray-300';
  const mark = on ? '✓' : '✕';
  const markColor = on ? 'text-green-600' : 'text-gray-400';
  return (
    <button onClick={onToggle} className={`inline-flex items-center gap-2 px-2 py-1 rounded border ${on? 'border-green-500 bg-green-50':'border-gray-300 bg-white'} ${ring}`} title={on? 'geeignet' : 'nicht primär geeignet'}>
      <span>{icon}</span>
      <span className={`text-xs ${markColor}`}>{mark}</span>
    </button>
  );
}

// ---------- App ----------
export default function App() {
  const [raw, setRaw] = useState(null);
  const [items, setItems] = useState([]);
  const [query, setQuery] = useLocalStorage("cd.query", "");
  const [types, setTypes] = useState([]);
  const [url, setUrl] = useLocalStorage("cd.url", "");
  const [wideMode, setWideMode] = useLocalStorage("cd.wide", false);
  const fileRef = useRef(null);

  const ingest = (data) => {
    setRaw(data);
    const arr = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
    const n = arr.map(normalizeItem);
    setItems(n);
    const typeSet = [...new Set(n.map((x) => x.type || "unknown"))];
    setTypes(typeSet);
  };

  const fetchUrl = async () => {
    if (!url) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      ingest(data);
    } catch (e) {
      alert("Fetch failed: " + e.message);
    }
  };

  const onFile = async (file) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      ingest(data);
    } catch (e) {
      alert("Invalid JSON: " + e.message);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let result = items;
    if (q) {
      result = result.filter((it) =>
        [it.name, it.type, it.rel_path, it.abs_path, it.id]
          .filter(Boolean)
          .join("\n")
          .toLowerCase()
          .includes(q)
      );
    }
    return result;
  }, [items, query]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="mx-auto px-4 py-3 flex items-center gap-3">
          <div className="text-xl font-semibold tracking-tight">ComfyDash</div>
          <div className="ml-auto flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="px-3 py-1.5 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 shadow-sm text-sm"
            >
              Open catalog.json
            </button>
            <div className="flex items-center gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:8000/catalog.json"
                className="w-80 px-3 py-1.5 rounded-lg border border-gray-300 text-sm"
              />
              <button
                onClick={fetchUrl}
                className="px-3 py-1.5 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 shadow-sm text-sm"
              >
                Fetch
              </button>
            </div>
            <button
              onClick={() => setWideMode(!wideMode)}
              className="px-3 py-1.5 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 shadow-sm text-sm"
              title="Volle Fensterbreite umschalten"
            >
              {wideMode ? 'Limit width' : 'Fit to window'}
            </button>
          </div>
        </div>
      </header>

      <main className={`${wideMode ? "max-w-none 2xl:max-w-none" : "max-w-7xl xl:max-w-screen-2xl"} mx-auto px-4 py-6`}>
        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <SummaryCard label="Items" value={items.length} hint={raw ? "loaded" : "no data"} />
          <SummaryCard label="Types" value={types.length} hint={types.join(", ") || "–"} />
          <SummaryCard label="Filtered" value={filtered.length} />
          <SummaryCard label="Search" value={query ? 'on' : 'off'} hint={query || '—'} />
        </div>

        {/* Search */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); }}
            placeholder="Search name / path / id"
            className="flex-1 min-w-[260px] px-3 py-2 rounded-xl border border-gray-300"
          />
          <button onClick={() => setQuery("")} className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 text-sm">Reset</button>
        </div>

        {/* Accordions */}
        <div className="space-y-3">
          {['checkpoint','lora','embedding'].filter(t => types.includes(t)).map((t) => (
            <TypeSection key={t} type={t} items={filtered.filter(it => it.type === t)} />
          ))}
          {types.filter(t => !['checkpoint','lora','embedding'].includes(t)).map((t) => (
            <TypeSection key={t} type={t} items={filtered.filter(it => it.type === t)} />
          ))}
        </div>
      </main>

      <footer className="py-8 text-center text-xs text-gray-500">ComfyDash • client-side viewer • no data leaves your machine</footer>
    </div>
  );
}

// ---------- UI bits ----------
function SummaryCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border bg-white shadow-sm p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {hint && <div className="text-xs text-gray-500 mt-1 truncate" title={hint}>{hint}</div>}
    </div>
  );
}

function TypeSection({ type, items }) {
  // initially CLOSED
  const [open, setOpen] = useLocalStorage(`cd.accordion.${type}`, false);
  const count = items.length;
  const ann = useAnnotations();

  // Pagination (per type)
  const PAGE_SIZE = 10;
  const [page, setPage] = useLocalStorage(`cd.page.${type}`, 1);

  const cols = useMemo(() => {
    if (type === 'lora') {
      return [
        { key: 'name', label: 'Name' },
        { key: 'civitai_title', label: 'CivitAI-Titel 🔗', editable: true },
        { key: 'base_model', label: 'Base-Model', editable: true },
        { key: 'triggers', label: 'Trigger / Tags', editable: true },
        { key: 'civitai_link', label: 'CivitAI-Link', editable: true },
        { key: 'provenance', label: 'Provenienz' },
        { key: 'favorite', label: '★', kind: 'star' },
      ];
    }
    if (type === 'embedding') {
      return [
        { key: 'name', label: 'Name' },
        { key: 'civitai_title', label: 'CivitAI-Titel 🔗', editable: true },
        { key: 'base_model', label: 'Base-Model', editable: true },
        { key: 'civitai_link', label: 'CivitAI-Link', editable: true },
        { key: 'provenance', label: 'Provenienz' },
        { key: 'favorite', label: '★', kind: 'star' },
      ];
    }
    if (type === 'checkpoint') {
      return [
        { key: 'name', label: 'Name' },
        { key: 'civitai_title', label: 'CivitAI-Titel 🔗', editable: true },
        { key: 'base_model', label: 'Base-Model', editable: true },
        { key: 'arch', label: 'Architektur / Typ' },
        { key: 'suit_photo', label: '📷 Realistisch', editable: true },
        { key: 'suit_drawing', label: '✏️ Zeichnung', editable: true },
        { key: 'preset_sampler', label: 'Sampler (Empf.)' },
        { key: 'preset_steps', label: 'Steps' },
        { key: 'preset_cfg', label: 'CFG' },
        { key: 'civitai_link', label: 'CivitAI-Link', editable: true },
        { key: 'provenance', label: 'Provenienz' },
        { key: 'favorite', label: '★', kind: 'star' },
      ];
    }
    return [ { key: 'name', label: 'Name' }, { key: 'id', label: 'ID' }, { key: 'rel_path', label: 'Path' } ];
  }, [type]);

  const merged = useMemo(() => items.map((it) => {
    const a = ann.get(it.id);
    const raw = it._raw || {};
    return {
      ...it,
      civitai_title: a.civitai_title ?? raw.civitai_title ?? '',
      civitai_link: a.civitai_link ?? raw.civitai_link ?? '',
      base_model: a.base_model ?? raw.base_model ?? 'unclear',
      confidence: a.confidence ?? raw.confidence ?? null,
      triggers: a.triggers ?? raw.triggers ?? '',
      provenance: raw.provenance === 'man' || a.manuallyEdited ? 'Manuell' : 'Auto',
      arch: raw.arch || raw.architecture || '–',
      suit_photo: a.suit_photo ?? raw?.presets?.suitability?.photo ?? false,
      suit_drawing: a.suit_drawing ?? raw?.presets?.suitability?.drawing ?? false,
      preset_sampler: raw?.presets?.sampler || '–',
      preset_steps: raw?.presets?.steps ?? '–',
      preset_cfg: raw?.presets?.cfg ?? '–',
      favorite: !!a.favorite,
    };
  }), [items]);

  // clamp page when data changes
  const pageCount = Math.max(1, Math.ceil(merged.length / PAGE_SIZE));
  const pageSafe = Math.min(Math.max(1, page), pageCount);
  const pageSlice = useMemo(() => {
    const start = (pageSafe - 1) * PAGE_SIZE;
    return merged.slice(start, start + PAGE_SIZE);
  }, [merged, pageSafe]);

  useEffect(() => {
    if (page !== pageSafe) setPage(pageSafe);
  }, [pageSafe, page, setPage]);

  return (
    <section className="border rounded-2xl bg-white shadow-sm">
      <div className="w-full flex items-center gap-2 px-4 py-3">
        <button onClick={() => setOpen(!open)} className="text-left font-semibold text-lg capitalize">
          {open ? '–' : '+'} {type}
        </button>
        <span className="ml-2 text-xs text-gray-500">{count} item{count!==1?'s':''}</span>
        {open && (
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-gray-500">Page {pageSafe}/{pageCount}</span>
            <button disabled={pageSafe<=1} onClick={()=>setPage(1)} className="px-2 py-1 rounded border bg-white disabled:opacity-50">«</button>
            <button disabled={pageSafe<=1} onClick={()=>setPage(p=>p-1)} className="px-2 py-1 rounded border bg-white disabled:opacity-50">‹</button>
            <button disabled={pageSafe>=pageCount} onClick={()=>setPage(p=>p+1)} className="px-2 py-1 rounded border bg-white disabled:opacity-50">›</button>
            <button disabled={pageSafe>=pageCount} onClick={()=>setPage(pageCount)} className="px-2 py-1 rounded border bg-white disabled:opacity-50">»</button>
          </div>
        )}
      </div>
      {open && (
        <div className="overflow-x-auto border-t">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-gray-700 sticky top-0 z-20">
              <tr>
                {cols.map((c, i) => (
                  <th
                    key={c.key}
                    className={`px-4 py-2 text-left ${c.right?'text-right':''} ${i===0 ? 'sticky left-0 z-30 bg-gray-100' : ''}`}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageSlice.map((it) => (
                <tr key={(it.id||'')+(it.abs_path||it.rel_path||it.name)} className="border-t hover:bg-gray-50">
                  {cols.map((c, i) => (
                    <td
                      key={c.key}
                      className={`px-4 py-2 align-top ${c.right?'text-right tabular-nums':''} ${i===0 ? 'sticky left-0 z-10 bg-white' : ''}`}
                    >
                      {renderCellAdvanced(type, c, it, ann)}
                    </td>
                  ))}
                </tr>
              ))}
              {!pageSlice.length && (
                <tr><td colSpan={cols.length} className="px-4 py-6 text-center text-gray-500">No items.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function renderCellAdvanced(type, col, it, ann){
  const save = (patch) => ann.set(it.id, { ...patch, manuallyEdited: true });
  switch(col.key){
    case 'name':
      return <span className="font-medium">{it.name || '(unnamed)'}</span>;
    case 'civitai_title':
      return (
        <div className="flex items-center gap-2">
          <input
            className="px-2 py-1 border rounded w-56"
            value={it.civitai_title}
            placeholder="– kein Titel –"
            onChange={(e)=>save({ civitai_title: e.target.value })}
          />
          {it.civitai_link && <a className="text-blue-600" href={ensureUrl(it.civitai_link)} target="_blank" rel="noreferrer">🔗</a>}
        </div>
      );
    case 'base_model': {
      const options = ['sd1.5','sdxl','pony','flux','unclear'];
      return (
        <div className="flex items-center gap-2">
          <BaseBadge model={it.base_model} conf={it.confidence} />
          <select className="px-2 py-1 border rounded" value={it.base_model} onChange={(e)=>save({ base_model: e.target.value })}>
            {options.map(o=> <option key={o} value={o}>{o.toUpperCase()}</option>)}
          </select>
        </div>
      );
    }
    case 'triggers':
      return (
        <input
          className="px-2 py-1 border rounded w-72"
          value={it.triggers}
          placeholder="e.g. portrait, realistic"
          onChange={(e)=>save({ triggers: e.target.value })}
        />
      );
    case 'civitai_link':
      return (
        <input
          className="px-2 py-1 border rounded w-64"
          value={it.civitai_link}
          placeholder="https://..."
          onChange={(e)=>save({ civitai_link: e.target.value })}
          onBlur={(e)=>save({ civitai_link: ensureUrl(e.target.value) })}
        />
      );
    case 'provenance':
      return <span className="text-xs px-2 py-0.5 rounded-full border">{it.provenance||'Auto'}</span>;
    case 'favorite':
      return <Star on={!!it.favorite} onToggle={()=>save({ favorite: !it.favorite })} />;
    case 'arch':
      return it.arch || '–';
    case 'suit_photo':{
      const a = ann.get(it.id);
      const explicit = Object.prototype.hasOwnProperty.call(a,'suit_photo') || (it._raw?.presets?.suitability && Object.prototype.hasOwnProperty.call(it._raw.presets.suitability,'photo'));
      const inf = inferSuitabilityFromText(it);
      const val = explicit ? !!it.suit_photo : (it.suit_photo || inf.photo);
      const conf = explicit ? 1 : inf.confPhoto;
      return <SuitIcon kind="photo" value={val} conf={conf} onToggle={()=>save({suit_photo: !val})} />;
    }
    case 'suit_drawing':{
      const a = ann.get(it.id);
      const explicit = Object.prototype.hasOwnProperty.call(a,'suit_drawing') || (it._raw?.presets?.suitability && Object.prototype.hasOwnProperty.call(it._raw.presets.suitability,'drawing'));
      const inf = inferSuitabilityFromText(it);
      const val = explicit ? !!it.suit_drawing : (it.suit_drawing || inf.draw);
      const conf = explicit ? 1 : inf.confDraw;
      return <SuitIcon kind="draw" value={val} conf={conf} onToggle={()=>save({suit_drawing: !val})} />;
    }
    case 'preset_sampler':
      return it.preset_sampler || '–';
    case 'preset_steps':
      return it.preset_steps ?? '–';
    case 'preset_cfg':
      return it.preset_cfg ?? '–';
    case 'id':
      return <span className="font-mono text-xs">{it.id || '–'}</span>;
    case 'rel_path':
      return <span className="font-mono text-xs">{it.rel_path || it.abs_path || '–'}</span>;
    default:
      return it[col.key] || '–';
  }
}
