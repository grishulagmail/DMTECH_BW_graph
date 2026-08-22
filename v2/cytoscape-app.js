/* global cytoscape, cytoscapeFcose */
cytoscape.use(cytoscapeFcose);

const PREFIX_COLORS = {
  ZMM: "#d4813b", ZSD: "#c45c4a", ZRB: "#5b7c8d", ZFI: "#c9a227",
  ZRS: "#6b7f4a", ZSS: "#8fa86a", ZPRM: "#e07a5f", ZPUR: "#81b29a",
  ZEWM: "#5c4033", "ZSB+ZIM+ZBE": "#9b6b9b", ZSB: "#9b6b9b",
  ZIM: "#9b6b9b", ZIMA: "#9b6b9b", ZBE: "#9b6b9b", POSDW: "#3d5a68"
};
const MUTED = "#5a6570";
const FROZEN_CYAN = "#7dd3f0";
const STORAGE = new Set(["odso", "adso"]);
const PROVIDERS = new Set(["odso", "adso", "cube"]);
const ENDS = new Set(["odso", "adso", "cube", "vtable"]);
const FLOW_ENDS = new Set([...ENDS, "datasource", "hcpr", "calcview"]);
const HIDDEN_HOPS = new Set(["dtp", "trfn", "clas", "abap_routine", "hcpr", "calcview"]);
const LOAD_EDGES = new Set(["loads_via_dtp", "maps_via_trfn"]);
const LOAD_CUTOFF = "20251110";
const DEFAULT_OFF = new Set([
  "infoobject", "calcview", "query", "workbook", "trfn", "dtp",
  "abap_routine", "clas", "hcpr", "table", "datasource", "trcs", "psa",
  "ad", "iobja", "iobjt", "mpro"
]);

function yyyymmdd(v) {
  const s = String(v || "").replace(/[-./]/g, "");
  return /^\d{8}/.test(s) ? s.slice(0, 8) : "";
}
function fmtDate(v) {
  const s = yyyymmdd(v);
  return s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : "—";
}
function bwLookupKeys(name) {
  const n = String(name || "").trim();
  if (!n) return [];
  const keys = [n];
  const slash = n.lastIndexOf("/");
  if (slash >= 0) keys.push(n.slice(slash + 1));
  keys.push(
    n.replace(/^_SYS_BIC[:.]/i, "")
      .replace(/^SAPPBI\./i, "")
      .replace(/^system-local\.bw\.bw2hana[^/]*\//i, "")
      .replace(/^0BW:BIA:/i, "")
      .replace(/\.U1$/i, "")
  );
  return [...new Set(keys.filter(Boolean))];
}
function bwText(n) {
  const texts = window.BW_TEXTS || {};
  if (!n) return "";
  if (n.txtlg) return n.txtlg;
  for (const key of bwLookupKeys(n.name || n.label || n)) {
    if (texts[key]) return texts[key];
  }
  return "";
}
function esc(s) {
  return String(s || "").replace(/</g, "");
}
function displayPrefix(p) {
  const s = String(p || "");
  if (/^ZMM\d*$/i.test(s)) return "ZMM";
  if (/^ZSS\d*$/i.test(s)) return "ZSS";
  if (/^ZRS\d*$/i.test(s)) return "ZRS";
  if (/^(ZSB|ZIMA?|ZBE)$/i.test(s)) return "ZSB+ZIM+ZBE";
  if (/^ZRBSS$/i.test(s)) return "ZRB";
  if (/POSDW/i.test(s)) return "POSDW";
  return s;
}
function isColdProvider(n) {
  if (!n || !PROVIDERS.has(n.type)) return false;
  return n.cooling === "FROZEN" || n.cooling === "EMPTY" ||
    (yyyymmdd(n.last_data) && yyyymmdd(n.last_data) < LOAD_CUTOFF);
}
function isEmptyObject(n) {
  if (!n || !STORAGE.has(n.type)) return false;
  if (n.cooling === "EMPTY" || n.load_class === "EMPTY") return true;
  const gb = Number(n.disk_gb);
  if (Number.isFinite(gb)) return gb < 0.01;
  return n.disk_gb == null || n.disk_gb === "";
}
function loadsIntoFrozenData(source, target, type) {
  if (!LOAD_EDGES.has(type) || isColdProvider(target)) return !!isColdProvider(target);
  const stale = yyyymmdd(source && source.props && source.props.last_load);
  return (source.type === "dtp" || source.type === "trfn") &&
    !!stale && stale < LOAD_CUTOFF && target && PROVIDERS.has(target.type);
}
function nodeColor(n) {
  if (n.type === "vtable") return "#c5cdd4";
  if (STORAGE.has(n.type)) return PREFIX_COLORS[displayPrefix(n.prefix)] || "#7a8490";
  return MUTED;
}
function nodeSize(n) {
  if (n.type === "vtable") return 16;
  const gb = Number(n.disk_gb);
  if (Number.isFinite(gb) && gb > 0) {
    // Circle area is approximately proportional to physical volume. A small
    // base keeps sub-10 GB objects selectable without flattening TB objects.
    return Math.min(78, 12 + 1.65 * Math.sqrt(gb));
  }
  if (STORAGE.has(n.type) || n.type === "table" || n.type === "cube") return 18;
  return 14;
}
function loadGraph() {
  if (window.LINEAGE_GRAPH && window.LINEAGE_GRAPH.nodes) return Promise.resolve(window.LINEAGE_GRAPH);
  return fetch("../graph/canonical.json").then((r) => r.ok ? r.json() : Promise.reject())
    .catch(() => ({ meta: { counts: {} }, nodes: [], edges: [] }));
}

function collapseBw2hanaShadows(graph) {
  const prefer = ["odso", "adso", "cube", "hcpr"];
  const byId = Object.fromEntries((graph.nodes || []).map((n) => [n.id, n]));
  const alias = new Map();
  const isShadow = (s) => /system-local\.bw\.bw2hana/i.test(s) || /0BW:BIA:/i.test(s);
  const canon = (name) => String(name || "")
    .replace(/^_SYS_BIC[:.]/i, "")
    .replace(/^SAPPBI\./i, "")
    .replace(/^system-local\.bw\.bw2hana[^/]*\//i, "")
    .replace(/^0BW:BIA:/i, "")
    .replace(/\.U1$/i, "");
  for (const n of graph.nodes || []) {
    if (!isShadow(n.name) && !isShadow(n.id)) continue;
    const c = canon(n.name);
    if (!c) continue;
    let target = null;
    for (const t of prefer) {
      const id = `${t}:${c}`;
      if (byId[id] && id !== n.id) { target = id; break; }
    }
    if (!target) {
      const same = `${n.type}:${c}`;
      if (byId[same] && same !== n.id) target = same;
    }
    if (target) alias.set(n.id, target);
  }
  if (!alias.size) return graph;
  graph.nodes = graph.nodes.filter((n) => !alias.has(n.id));
  const seen = new Set();
  graph.edges = (graph.edges || []).filter((e) => {
    const s = alias.get(e.source) || e.source;
    const t = alias.get(e.target) || e.target;
    if (s === t) return false;
    const nid = `${e.type}|${s}|${t}`;
    if (seen.has(nid)) return false;
    seen.add(nid);
    e.source = s;
    e.target = t;
    e.id = nid;
    return true;
  });
  return graph;
}

loadGraph().then((g) => {
  collapseBw2hanaShadows(g);
  const nodeById = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  g.nodes.forEach((n) => { n.txtlg = n.txtlg || bwText(n); });
  const outAdj = new Map();
  const inAdj = new Map();
  const addAdj = (map, id, edge) => {
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(edge);
  };
  g.edges.forEach((edge) => {
    addAdj(outAdj, edge.source, edge);
    addAdj(inAdj, edge.target, edge);
  });
  function pairName(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }
  function lastOkForPair(srcName, tgtName) {
    const map = window.DTP_LAST_OK || {};
    return yyyymmdd(map[`${pairName(srcName)}|${pairName(tgtName)}`]);
  }
  function lastDataForPair(srcName, tgtName) {
    const map = window.DTP_LAST_DATA || {};
    return yyyymmdd(map[`${pairName(srcName)}|${pairName(tgtName)}`]);
  }
  function laterDate(a, b) {
    if (a && b) return a >= b ? a : b;
    return a || b || "";
  }
  function lastLiveForPair(srcName, tgtName) {
    return laterDate(lastOkForPair(srcName, tgtName), lastDataForPair(srcName, tgtName));
  }
  function parseDtpEnds(node) {
    const m = String((node && node.name) || "").match(/^(.+)>(.+):([A-Z])$/);
    if (!m) return null;
    return { src: pairName(m[1]), tgt: pairName(m[2]) };
  }
  function pairKeyFromIds(sourceId, targetId) {
    const src = nodeById[sourceId];
    const tgt = nodeById[targetId];
    if (!src || !tgt) return "";
    return `${pairName(src.name)}|${pairName(tgt.name)}`;
  }
  const neverDtpPairs = new Set();
  const knownDtpPairs = new Set();
  for (const n of g.nodes) {
    if (n.type !== "dtp") continue;
    const ends = parseDtpEnds(n);
    if (!ends) continue;
    const key = `${ends.src}|${ends.tgt}`;
    knownDtpPairs.add(key);
    if (!lastLiveForPair(ends.src, ends.tgt)) neverDtpPairs.add(key);
  }
  function lastLiveOnDtpPath(path, sourceId, targetId) {
    const src = nodeById[sourceId];
    const tgt = nodeById[targetId];
    let last = lastLiveForPair(src && src.name, tgt && tgt.name);
    for (const id of path || []) {
      const hop = nodeById[id];
      if (!hop || hop.type !== "dtp") continue;
      const ends = parseDtpEnds(hop);
      const d = ends
        ? lastLiveForPair(ends.src, ends.tgt)
        : laterDate(yyyymmdd(hop.last_ok), yyyymmdd(hop.last_data));
      if (d && (!last || d > last)) last = d;
    }
    return last;
  }
  function lastOkOnDtpPath(path, sourceId, targetId) {
    return lastLiveOnDtpPath(path, sourceId, targetId);
  }
  function pathHasDtp(path) {
    return (path || []).some((id) => nodeById[id] && nodeById[id].type === "dtp");
  }
  function dtpNodeLastOk(node) {
    if (!node || node.type !== "dtp") return "";
    const ends = parseDtpEnds(node);
    return ends
      ? lastLiveForPair(ends.src, ends.tgt)
      : laterDate(yyyymmdd(node.last_ok), yyyymmdd(node.last_data));
  }
  function isNeverDtp(node) {
    return !!(node && node.type === "dtp" && !dtpNodeLastOk(node));
  }
  function isNeverLoadEdge(edge) {
    if (!LOAD_EDGES.has(edge.type)) return false;
    const src = nodeById[edge.source];
    const tgt = nodeById[edge.target];
    return isNeverDtp(src) || isNeverDtp(tgt);
  }
  function isNeverDtpPath(path, sourceId, targetId) {
    const key = pairKeyFromIds(sourceId, targetId);
    if (key && neverDtpPairs.has(key)) return true;
    if (!pathHasDtp(path)) return false;
    return !lastOkOnDtpPath(path, sourceId, targetId);
  }
  function isStaleDtpPath(path, sourceId, targetId) {
    if (isNeverDtpPath(path, sourceId, targetId)) return false;
    const last = lastOkOnDtpPath(path, sourceId, targetId);
    if (last && last < LOAD_CUTOFF) return true;
    const key = pairKeyFromIds(sourceId, targetId);
    if (key && knownDtpPairs.has(key) && last && last < LOAD_CUTOFF) return true;
    return false;
  }
  function isStaleLoadEdge(edge) {
    if (!LOAD_EDGES.has(edge.type)) return false;
    const src = nodeById[edge.source];
    const tgt = nodeById[edge.target];
    const dtp = src && src.type === "dtp" ? src : tgt && tgt.type === "dtp" ? tgt : null;
    if (!dtp) return false;
    const last = dtpNodeLastOk(dtp);
    return !!last && last < LOAD_CUTOFF;
  }
  function skipNeverHop(edge, hideNeverDtp) {
    if (!hideNeverDtp) return false;
    return isNeverLoadEdge(edge) || isNeverDtp(nodeById[edge.source]) || isNeverDtp(nodeById[edge.target]);
  }

  const types = [...new Set(g.nodes.map((n) => n.type))].sort();
  const prefixes = [...new Set(g.nodes.map((n) => n.prefix).filter(Boolean))].sort();
  const typeBox = document.getElementById("types");
  const prefSel = document.getElementById("prefix");
  const qEl = document.getElementById("q");
  const enabled = new Set(types.filter((type) => !DEFAULT_OFF.has(type)));
  types.forEach((type) => {
    typeBox.insertAdjacentHTML("beforeend",
      `<label class="chk"><input type="checkbox" id="t_${type}" ${enabled.has(type) ? "checked" : ""}/>${type}</label>`);
  });
  prefixes.forEach((prefix) => prefSel.insertAdjacentHTML("beforeend", `<option value="${prefix}">${prefix}</option>`));
  const names = document.getElementById("provNames");
  g.nodes.filter((n) => FLOW_ENDS.has(n.type)).sort((a, b) => a.name.localeCompare(b.name))
    .forEach((n) => names.insertAdjacentHTML("beforeend", `<option value="${String(n.label || n.name).replace(/"/g, "")}"></option>`));
  document.getElementById("legend").innerHTML = Object.keys(PREFIX_COLORS).map((p) =>
    `<label class="chk"><span class="dot" style="background:${PREFIX_COLORS[p]}"></span>${p}</label>`).join("") +
    `<label class="chk"><span class="dot" style="background:${MUTED}"></span>тех / куб / без префикса</label>`;
  document.getElementById("legendShape").innerHTML =
    `<label class="chk">● ODSO / ADSO — цвет префикса, площадь ≈ GB</label>` +
    `<label class="chk">● светлый — virtual table (SDA)</label>` +
    `<label class="chk">→ обычная стрелка — прямая связь</label>` +
    `<label class="chk">⇢ золотой пунктир — живая загрузка через скрытые объекты</label>` +
    `<label class="chk">⇢ голубой прозрачный — stale, DTP когда-то грузился, давно</label>` +
    `<label class="chk">⇢ серый прозрачный — never, DTP ни разу не грузился</label>` +
    `<label class="chk">○ полупрозрачный узел — пустой объект (нет объёма)</label>`;

  const cy = cytoscape({
    container: document.getElementById("graph"),
    boxSelectionEnabled: false,
    autoungrabify: false,
    minZoom: 0.05,
    maxZoom: 4,
    wheelSensitivity: 0.35,
    style: [
      {
        selector: "node",
        style: {
          "background-color": "data(color)",
          "width": "data(size)",
          "height": "data(size)",
          "label": "data(label)",
          "font-family": "Segoe UI, system-ui, sans-serif",
          "font-size": 12,
          "font-weight": 600,
          "color": "#e8e4dc",
          "text-outline-color": "#1c2228",
          "text-outline-width": 2,
          "text-valign": "center",
          "text-halign": "right",
          "text-margin-x": 8,
          "border-width": 2,
          "border-color": "#1a2228"
        }
      },
      {
        selector: "node.focus",
        style: { "border-color": "#d4813b", "border-width": 4 }
      },
      {
        selector: "node.frozen",
        style: {
          "border-color": "#38e8ff",
          "border-width": 3
        }
      },
      {
        selector: "node.empty",
        style: {
          "opacity": 0.32,
          "border-width": 1,
          "border-color": "#8a969e"
        }
      },
      {
        selector: "edge",
        style: {
          "width": 0.8,
          "line-color": "#6a7680",
          "target-arrow-color": "#88949d",
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
          "arrow-scale": 0.55,
          "opacity": 0.92
        }
      },
      {
        selector: "edge.via",
        style: {
          "width": 1.3,
          "line-color": "#c4a574",
          "target-arrow-color": "#c4a574",
          "line-style": "dashed",
          "line-dash-pattern": [8, 5],
          "arrow-scale": 0.6,
          "z-index": 2
        }
      },
      {
        selector: "edge.stale",
        style: {
          "line-color": FROZEN_CYAN,
          "target-arrow-color": FROZEN_CYAN,
          "opacity": 0.32,
          "z-index": 0
        }
      },
      {
        selector: "edge.via.stale",
        style: {
          "width": 1.15,
          "line-color": FROZEN_CYAN,
          "target-arrow-color": FROZEN_CYAN,
          "opacity": 0.35,
          "line-dash-pattern": [4, 8],
          "z-index": 0
        }
      },
      {
        selector: "edge.never",
        style: {
          "line-color": "#8a969e",
          "target-arrow-color": "#8a969e",
          "opacity": 0.28,
          "z-index": 0
        }
      },
      {
        selector: "edge.via.never",
        style: {
          "width": 1.1,
          "line-color": "#8a969e",
          "target-arrow-color": "#8a969e",
          "opacity": 0.3,
          "line-dash-pattern": [3, 9],
          "z-index": 0
        }
      },
      { selector: ":selected", style: { "overlay-opacity": 0, "border-color": "#f0c870" } }
    ]
  });

  function visibleTypes() {
    return new Set(types.filter((type) => document.getElementById(`t_${type}`).checked));
  }
  function prefixOk(n, prefix) {
    return !prefix || n.prefix === prefix || displayPrefix(n.prefix) === prefix;
  }
  function wanted(n, visibleTypesSet, prefix) {
    return visibleTypesSet.has(n.type) && prefixOk(n, prefix);
  }
  const calcViewHasConsumer = new Map();
  function cvHasConsumer(id, trail = new Set()) {
    if (calcViewHasConsumer.has(id)) return calcViewHasConsumer.get(id);
    if (trail.has(id)) return false;
    trail.add(id);
    for (const edge of outAdj.get(id) || []) {
      const target = nodeById[edge.target];
      if (!target) continue;
      if (target.type === "calcview" && cvHasConsumer(target, trail)) {
        calcViewHasConsumer.set(id, true);
        return true;
      }
      if (target.type !== "table" && target.type !== "infoobject" && target.type !== "calcview") {
        calcViewHasConsumer.set(id, true);
        return true;
      }
    }
    calcViewHasConsumer.set(id, false);
    return false;
  }
  function matchSeeds(query, allowed) {
    const exact = [];
    const loose = [];
    g.nodes.forEach((n) => {
      if (!allowed.has(n.id)) return;
      const name = String(n.name || "").toLowerCase();
      const label = String(n.label || "").toLowerCase();
      const q = query.toLowerCase();
      if (name === q || label === q || n.id.toLowerCase() === q) exact.push(n.id);
      else if (name.includes(q) || label.includes(q) || n.id.toLowerCase().includes(q)) loose.push(n.id);
    });
    return exact.length ? exact : loose;
  }
  function traverse(seeds, maxDepth, parents, children, allowed, showFrozenLoads, hideNeverDtp) {
    const keep = new Set(seeds);
    function walk(seed, direction) {
      const seen = new Set([seed]);
      const queue = [{ id: seed, depth: 0 }];
      while (queue.length) {
        const cur = queue.shift();
        const edges = direction === "in" ? (inAdj.get(cur.id) || []) : (outAdj.get(cur.id) || []);
        for (const edge of edges) {
          if (!showFrozenLoads && loadsIntoFrozenData(nodeById[edge.source], nodeById[edge.target], edge.type)) continue;
          if (skipNeverHop(edge, hideNeverDtp)) continue;
          const next = direction === "in" ? edge.source : edge.target;
          if (seen.has(next)) continue;
          seen.add(next);
          const nextNode = nodeById[next];
          if (!nextNode) continue;
          const isVisibleEnd = FLOW_ENDS.has(nextNode.type) && allowed.has(next);
          if (isVisibleEnd) {
            if (cur.depth < maxDepth) {
              keep.add(next);
              queue.push({ id: next, depth: cur.depth + 1 });
            }
          } else if (HIDDEN_HOPS.has(nextNode.type) || FLOW_ENDS.has(nextNode.type)) {
            queue.push({ id: next, depth: cur.depth });
          }
        }
      }
    }
    seeds.forEach((seed) => {
      if (parents) walk(seed, "in");
      if (children) walk(seed, "out");
    });
    return keep;
  }
  function collapsedVias(visible, showFrozenLoads, hideNeverDtp) {
    const found = [];
    const seen = new Set();
    function walk(start, direction) {
      const queue = [{ id: start, hops: 0, path: [start] }];
      const visited = new Set([start]);
      while (queue.length) {
        const cur = queue.shift();
        if (cur.hops >= 8) continue;
        const edges = direction === "in" ? (inAdj.get(cur.id) || []) : (outAdj.get(cur.id) || []);
        for (const edge of edges) {
          if (!showFrozenLoads && loadsIntoFrozenData(nodeById[edge.source], nodeById[edge.target], edge.type)) continue;
          if (skipNeverHop(edge, hideNeverDtp)) continue;
          const next = direction === "in" ? edge.source : edge.target;
          if (visited.has(next)) continue;
          const nextNode = nodeById[next];
          if (!nextNode || /\/proc|tabletype|VAR_OUT/i.test(nextNode.name || "")) continue;
          if (visible.has(next) && next !== start && FLOW_ENDS.has(nextNode.type) && cur.hops > 0) {
            const source = direction === "in" ? next : start;
            const target = direction === "in" ? start : next;
            const key = `${source}|${target}`;
            const path = direction === "in" ? [next, ...cur.path] : [...cur.path, next];
            if (isNeverDtpPath(path, source, target) && hideNeverDtp) continue;
            if (!seen.has(key)) {
              seen.add(key);
              found.push({ source, target, path });
            }
            continue;
          }
          if (!HIDDEN_HOPS.has(nextNode.type)) continue;
          if (isNeverDtp(nextNode) && hideNeverDtp) continue;
          visited.add(next);
          queue.push({ id: next, hops: cur.hops + 1, path: direction === "in" ? [next, ...cur.path] : [...cur.path, next] });
        }
      }
    }
    visible.forEach((id) => {
      walk(id, "in");
      walk(id, "out");
    });
    return found;
  }
  function pruneIsolates(visible, edges, vias, focus) {
    const linked = new Set();
    [...edges, ...vias].forEach((edge) => {
      linked.add(edge.source);
      linked.add(edge.target);
    });
    let removed = 0;
    for (const id of [...visible]) {
      if (!focus.has(id) && !linked.has(id)) {
        visible.delete(id);
        removed++;
      }
    }
    return removed;
  }
  function neighborLabel(node) {
    if (!node) return "";
    const txt = bwText(node);
    return txt ? `${esc(node.name)} — ${esc(txt)}` : esc(node.name);
  }
  function showNode(id) {
    const n = nodeById[id];
    if (!n) return;
    const detail = document.getElementById("detailBody");
    const txt = bwText(n);
    const lines = [...(outAdj.get(id) || []), ...(inAdj.get(id) || [])]
      .slice(0, 28)
      .map((edge) => {
        const other = nodeById[edge.source === id ? edge.target : edge.source];
        const line = `${edge.type || ""} ${edge.source === id ? "→" : "←"} ${neighborLabel(other)}`;
        if (isNeverLoadEdge(edge)) return `<span class="never-ink">${line}</span>`;
        return isStaleLoadEdge(edge) ? `<span class="stale-ink">${line}</span>` : line;
      });
    detail.classList.remove("stale-ink", "never-ink");
    detail.innerHTML =
      `<p><b>${esc(n.name)}</b><br/><span class="meta">${n.type} · ${displayPrefix(n.prefix) || "—"} · ${n.cooling || (isEmptyObject(n) ? "EMPTY" : "")}</span></p>` +
      (txt ? `<p class="txtlg">${esc(txt)}</p>` : `<p class="meta">наименование BW не найдено</p>`) +
      (isEmptyObject(n) ? `<p class="meta">пустой объект — нет объёма данных</p>` : "") +
      (n.disk_gb != null ? `<p>${n.disk_gb} GB</p>` : "") +
      (n.last_ok || n.last_data ? `<p>последняя загрузка: ${fmtDate(n.last_ok)}<br/><span class="meta">данные до: ${fmtDate(n.last_data)}</span></p>` : "") +
      `<p class="meta">Рёбра:<br/>${lines.join("<br/>")}</p>`;
  }
  function fillVisibleList(visible) {
    const ul = document.getElementById("visibleList");
    const items = [...visible]
      .map((id) => nodeById[id])
      .filter(Boolean)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (items.length > 80) {
      ul.innerHTML = `<li class="meta">на экране ${items.length} узлов — введите имя слева, чтобы увидеть наименования пучка</li>`;
      return;
    }
    ul.innerHTML = items.map((n) => {
      const txt = bwText(n);
      return `<li data-id="${esc(n.id)}"><div class="tech">${esc(n.label || n.name)}</div>${
        txt ? `<div class="txtlg">${esc(txt)}</div>` : ""
      }</li>`;
    }).join("");
    ul.querySelectorAll("li[data-id]").forEach((li) => {
      li.onclick = () => {
        const id = li.getAttribute("data-id");
        showNode(id);
        const el = cy.getElementById(id);
        if (el && el.length) {
          cy.nodes().unselect();
          el.select();
        }
      };
    });
  }
  function providerIdByName(name) {
    const n = pairName(name);
    for (const t of ["adso", "odso", "cube", "hcpr", "datasource"]) {
      const id = `${t}:${n}`;
      if (nodeById[id]) return id;
    }
    return "";
  }
  function allStaleDtpPairs() {
    const seen = new Set();
    const rows = [];
    for (const n of g.nodes) {
      if (n.type !== "dtp") continue;
      const ends = parseDtpEnds(n);
      if (!ends) continue;
      const last = lastLiveForPair(ends.src, ends.tgt);
      if (!last || last >= LOAD_CUTOFF) continue;
      const key = `${ends.src}|${ends.tgt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sid = providerIdByName(ends.src);
      const tid = providerIdByName(ends.tgt);
      if (!sid || !tid) continue;
      rows.push({ src: ends.src, tgt: ends.tgt, sid, tid, last: last || "" });
    }
    rows.sort((a, b) => String(a.last).localeCompare(String(b.last)) || a.src.localeCompare(b.src));
    return rows;
  }
  const stalePairs = allStaleDtpPairs();
  function runLayout(fit) {
    if (!cy.elements().length) return;
    cy.layout({
      name: "fcose",
      quality: "default",
      randomize: true,
      animate: false,
      fit,
      padding: 54,
      nodeRepulsion: 9000,
      idealEdgeLength: 130,
      edgeElasticity: 0.15,
      gravity: 0.18,
      numIter: 1200,
      tile: true
    }).run();
  }
  function rebuild() {
    const typeSet = visibleTypes();
    const prefix = prefSel.value;
    const query = qEl.value.trim();
    const showFrozenLoads = document.getElementById("showFrozenLoads").checked;
    const showAllCv = document.getElementById("showAllCv").checked;
    const hideLiveDtp = document.getElementById("hideLiveDtp").checked;
    const hideNeverDtp = document.getElementById("hideNeverDtp").checked;
    const allowed = new Set(g.nodes
      .filter((n) => wanted(n, typeSet, prefix))
      .filter((n) => showAllCv || n.type !== "calcview" || cvHasConsumer(n.id))
      .filter((n) => !hideNeverDtp || n.type !== "dtp" || !isNeverDtp(n))
      .map((n) => n.id));
    const focus = query ? new Set(matchSeeds(query, allowed)) : new Set();
    let visible = new Set(allowed);
    if (query) {
      const maxDepth = Number(document.getElementById("egoDepth").value || 2);
      const parents = document.getElementById("egoParents").checked;
      const children = document.getElementById("egoChildren").checked;
      visible = traverse([...focus], maxDepth, parents, children, allowed, showFrozenLoads, hideNeverDtp);
      // This second intersection is deliberate: unchecked types can be traversal hops, never nodes.
      visible = new Set([...visible].filter((id) => allowed.has(id)));
    }
    if (hideLiveDtp && !query) {
      visible = new Set();
      for (const row of stalePairs) {
        if (allowed.has(row.sid)) visible.add(row.sid);
        if (allowed.has(row.tid)) visible.add(row.tid);
      }
    }
    let edges = g.edges.filter((edge) =>
      visible.has(edge.source) && visible.has(edge.target) &&
      (showFrozenLoads || !loadsIntoFrozenData(nodeById[edge.source], nodeById[edge.target], edge.type)) &&
      (!hideNeverDtp || !isNeverLoadEdge(edge)));
    let vias = collapsedVias(visible, showFrozenLoads, hideNeverDtp);
    if (hideNeverDtp) {
      vias = vias.filter((edge) => !isNeverDtpPath(edge.path, edge.source, edge.target));
    }
    if (hideLiveDtp) {
      vias = vias.filter((edge) => isStaleDtpPath(edge.path, edge.source, edge.target));
      edges = edges.filter((edge) => isStaleLoadEdge(edge));
    }
    const isolated = pruneIsolates(visible, edges, vias, focus);
    edges = edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target));
    vias = vias.filter((edge) => visible.has(edge.source) && visible.has(edge.target));

    const elements = [];
    visible.forEach((id) => {
      const n = nodeById[id];
      elements.push({
        group: "nodes",
        data: { id, label: n.label || n.name, color: nodeColor(n), size: nodeSize(n) },
        classes: `${focus.has(id) ? "focus " : ""}${n.cooling === "FROZEN" ? "frozen " : ""}${isEmptyObject(n) ? "empty" : ""}`.trim()
      });
    });
    edges.forEach((edge) => elements.push({
      group: "edges",
      data: { id: `edge:${edge.id}`, source: edge.source, target: edge.target, type: edge.type },
      classes: isNeverLoadEdge(edge) ? "never" : (isStaleLoadEdge(edge) ? "stale" : "")
    }));
    vias.forEach((edge, index) => {
      const lastOk = lastOkOnDtpPath(edge.path, edge.source, edge.target);
      const never = isNeverDtpPath(edge.path, edge.source, edge.target);
      const stale = !never && isStaleDtpPath(edge.path, edge.source, edge.target);
      elements.push({
        group: "edges",
        data: {
          id: `via:${edge.source}:${edge.target}:${index}`, source: edge.source, target: edge.target,
          lastOk, stale: stale ? "stale" : "", never: never ? "never" : "",
          viaPath: edge.path.map((id) => {
            const node = nodeById[id];
            if (!node) return id;
            const txt = bwText(node);
            return txt ? `${node.name} (${txt})` : node.name;
          }).join(" → ")
        },
        classes: never ? "via never" : (stale ? "via stale" : "via")
      });
    });
    cy.elements().remove();
    cy.add(elements);
    runLayout(true);
    fillVisibleList(visible);
    const counts = (g.meta && g.meta.counts) || {};
    document.getElementById("hdrMeta").textContent =
      `${visible.size} на экране · via ${vias.length} · stale ${vias.filter((v) => isStaleDtpPath(v.path, v.source, v.target)).length}${isolated ? ` · скрыто изолир. ${isolated}` : ""} · всего ${counts.nodes || 0} узлов / ${counts.edges || 0} рёбер`;
  }

  cy.on("tap", "node", (event) => showNode(event.target.id()));
  function focusNodeFromDoubleClick(event) {
    const node = nodeById[event.target.id()];
    if (!node) return;
    qEl.value = node.name;
    rebuild();
  }
  cy.on("dbltap", "node", focusNodeFromDoubleClick);
  cy.on("dblclick", "node", focusNodeFromDoubleClick);
  cy.on("tap", "edge", (event) => {
    const edge = event.target;
    const stale = edge.hasClass("stale");
    const never = edge.hasClass("never");
    const detail = document.getElementById("detailBody");
    detail.classList.toggle("stale-ink", stale);
    detail.classList.toggle("never-ink", never && !stale);
    const title = never ? "never — DTP ни разу не грузился" : (stale ? "stale — давно не грузился" : (edge.hasClass("via") ? "Связь через скрытые объекты" : "Ребро"));
    const path = String(edge.data("viaPath") || edge.data("type") || "").replace(/</g, "");
    detail.innerHTML =
      `<p><b>${title}</b></p>` +
      `<p class="meta">последняя живая DTP (строки или зелёный): ${fmtDate(edge.data("lastOk"))}</p>` +
      (path ? `<p class="meta">${path}</p>` : "");
  });
  let timer = 0;
  types.forEach((type) => document.getElementById(`t_${type}`).addEventListener("change", rebuild));
  [prefSel, document.getElementById("egoDepth"), document.getElementById("egoParents"),
    document.getElementById("egoChildren"), document.getElementById("showFrozenLoads"),
    document.getElementById("showAllCv"), document.getElementById("hideLiveDtp"),
    document.getElementById("hideNeverDtp")].forEach((el) => el.addEventListener("change", rebuild));
  qEl.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 220);
  });
  document.getElementById("fitBtn").onclick = () => { cy.resize(); cy.fit(cy.elements(), 54); };
  document.getElementById("relayout").onclick = () => { cy.resize(); runLayout(true); };
  let resizeFit;
  const syncGraphSize = (fit) => {
    cy.resize();
    if (fit && cy.elements().length) cy.fit(cy.elements(), 54);
  };
  const wrap = document.getElementById("graphWrap");
  if (typeof ResizeObserver !== "undefined" && wrap) {
    new ResizeObserver(() => {
      cy.resize();
      clearTimeout(resizeFit);
      resizeFit = setTimeout(() => syncGraphSize(true), 120);
    }).observe(wrap);
  }
  window.addEventListener("resize", () => {
    cy.resize();
    clearTimeout(resizeFit);
    resizeFit = setTimeout(() => syncGraphSize(true), 120);
  });
  rebuild();
});
