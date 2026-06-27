// Fabric renderer (spec §7) + canvas navigation (§7.1) + drag persist (§8.5).
// Browser-only (needs a DOM canvas). Dispatches by diagram type; system and gantt are
// implemented, other types draw a "not yet" placeholder so the bundle stays whole.

import { Canvas, Rect, Textbox, Line, Polygon, FabricText, Group as FabricGroup } from 'fabric';
import { layout } from './layout.js';
import { setPos, emit } from './kdl.js';

const THEME = {
  light: { bg: '#ffffff', stroke: '#44485a', fill: '#f4f6fb', text: '#1c2030',
           group: '#8a90a6', critical: '#d23b3b', accent: '#3b6fd2', muted: '#6b7185' },
};
const GROUP_DASH = { boundary: [], zone: [], process: [6, 4], cluster: [2, 4],
                     workflow: [8, 3, 2, 3], network: [4, 4] };

/**
 * render(container, model, opts) -> controller.
 * opts: { readOnly?:boolean, onPersist?:(kdlText)=>void }
 */
export function render(container, model, opts = {}) {
  const theme = THEME[model.theme] || THEME.light;
  container.innerHTML = '';
  container.style.overflow = 'auto';
  container.style.position = container.style.position || 'relative';

  const lo = layout(model);
  const contentW = Math.max(40, Math.ceil(lo.width || 800));
  const contentH = Math.max(40, Math.ceil(lo.height || 600));

  const canvasEl = document.createElement('canvas');
  container.appendChild(canvasEl);
  const canvas = new Canvas(canvasEl, { backgroundColor: theme.bg, selection: false,
    preserveObjectStacking: true });

  let zoom = 1;
  const applyZoom = (z) => {
    zoom = Math.min(4, Math.max(0.2, z));
    canvas.setZoom(zoom);
    canvas.setDimensions({ width: contentW * zoom, height: contentH * zoom });
  };

  if (lo.cycle) {
    drawPlaceholder(canvas, theme, `dependency cycle: ${lo.cycle.join(' → ')}`, contentW);
  } else if (lo.kind === 'gantt') {
    drawGantt(canvas, model, lo, theme);
  } else if (model.type === 'system') {
    drawGraph(canvas, model, lo, theme, opts);
  } else {
    drawGraph(canvas, model, lo, theme, opts); // generic box+edge fallback for class/state/pipeline
  }
  applyZoom(1);

  wireNavigation(container, canvas, applyZoom, () => zoom);
  if (!opts.readOnly && opts.onPersist && lo.kind === 'graph') {
    wirePersist(canvas, model, opts.onPersist);
  }
  canvas.requestRenderAll();
  return {
    canvas,
    zoomIn: () => applyZoom(zoom * 1.15),
    zoomOut: () => applyZoom(zoom / 1.15),
    reset: () => applyZoom(1),
    destroy: () => canvas.dispose(),
  };
}

// ---------- graph (system) ----------

function drawGraph(canvas, model, lo, theme, opts) {
  for (const id in lo.groups) {
    const g = lo.groups[id];
    canvas.add(new Rect({
      left: g.x, top: g.y, width: g.width, height: g.height, originX: 'center', originY: 'center',
      fill: 'rgba(0,0,0,0.015)', stroke: theme.group, strokeWidth: 1.2,
      strokeDashArray: GROUP_DASH[g.el.kind] || [], rx: 8, ry: 8, selectable: false, evented: false,
    }));
    if (g.el.label) canvas.add(new FabricText(g.el.label, {
      left: g.x - g.width / 2 + 8, top: g.y - g.height / 2 + 6, fontSize: 11,
      fill: theme.group, fontFamily: 'sans-serif', selectable: false, evented: false,
    }));
  }

  for (const e of lo.edges) drawEdge(canvas, e, lo, theme);

  for (const id in lo.nodes) {
    const n = lo.nodes[id];
    const el = n.el;
    const box = new Rect({
      width: n.width, height: n.height, originX: 'center', originY: 'center',
      fill: el.style?.fill || theme.fill, stroke: el.style?.stroke || theme.stroke,
      strokeWidth: 1.4, rx: 7, ry: 7,
    });
    const parts = [box];
    const title = el.label || el.id;
    parts.push(new Textbox(title, {
      width: n.width - 16, originX: 'center', originY: 'center', top: el.text?.slots?.subtitle ? -8 : 0,
      fontSize: 13, textAlign: 'center', fill: theme.text, fontFamily: 'sans-serif',
    }));
    const sub = el.text?.slots?.subtitle?.content;
    if (sub) parts.push(new Textbox(sub, { width: n.width - 16, originX: 'center', originY: 'center',
      top: 12, fontSize: 10, textAlign: 'center', fill: theme.muted, fontFamily: 'monospace' }));
    if (el.kindRef) parts.push(new FabricText(el.kindRef, { originX: 'left', originY: 'top',
      left: -n.width / 2 + 6, top: -n.height / 2 + 4, fontSize: 8, fill: theme.accent }));

    const fg = makeGroup(parts, { left: n.x, top: n.y, selectable: !opts.readOnly,
      hasControls: false, hasBorders: !opts.readOnly, lockScalingX: true, lockScalingY: true, lockRotation: true });
    fg.data = { id };
    canvas.add(fg);
  }
}

function drawEdge(canvas, e, lo, theme) {
  const a = lo.nodes[e.from], b = lo.nodes[e.to];
  if (!a || !b) return;
  const p = borderPoint(a, b), q = borderPoint(b, a);
  const dashed = e.el?.kind === 'dependency' || e.el?.line === 'dashed' || e.el?.rel === 'refs';
  canvas.add(new Line([p.x, p.y, q.x, q.y], {
    stroke: theme.stroke, strokeWidth: 1.3, strokeDashArray: dashed ? [5, 4] : [],
    selectable: false, evented: false,
  }));
  // arrowhead at target
  const ang = Math.atan2(q.y - p.y, q.x - p.x);
  const s = 8;
  canvas.add(new Polygon(
    [{ x: 0, y: 0 }, { x: -s, y: -s * 0.5 }, { x: -s, y: s * 0.5 }],
    { left: q.x, top: q.y, angle: (ang * 180) / Math.PI, originX: 'center', originY: 'center',
      fill: theme.stroke, selectable: false, evented: false }));
  if (e.el?.label) {
    canvas.add(new FabricText(e.el.label, { left: (p.x + q.x) / 2, top: (p.y + q.y) / 2 - 8,
      fontSize: 10, fill: theme.muted, backgroundColor: theme.bg, originX: 'center',
      selectable: false, evented: false }));
  }
}

function borderPoint(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const hw = from.width / 2, hh = from.height / 2;
  if (dx === 0 && dy === 0) return { x: from.x, y: from.y };
  const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(sx, sy);
  return { x: from.x + dx * t, y: from.y + dy * t };
}

// ---------- gantt ----------

function drawGantt(canvas, model, lo, theme) {
  // lane bands + labels
  lo.lanes.forEach((l, i) => {
    const y = lo.headerH + i * (lo.rowH + lo.laneGap);
    canvas.add(new Rect({ left: 0, top: y, width: lo.width, height: lo.rowH,
      fill: i % 2 ? '#f7f8fb' : '#ffffff', selectable: false, evented: false }));
    if (l.label) canvas.add(new FabricText(l.label, { left: 8, top: y + lo.rowH / 2,
      originY: 'center', fontSize: 12, fill: theme.muted, selectable: false, evented: false }));
  });
  // header line
  canvas.add(new Line([lo.gutter, 0, lo.gutter, lo.height], { stroke: '#e2e5ee', selectable: false, evented: false }));

  // day/date header (calendar) or order header (timeless)
  if (!lo.timeless) {
    for (let d = 0; d <= lo.total; d++) {
      const x = lo.gutter + d * lo.pxPerDay;
      canvas.add(new Line([x, lo.headerH, x, lo.height], { stroke: '#eef0f6', selectable: false, evented: false }));
      const label = lo.dates ? lo.dates(d).slice(5) : String(d);
      if (d % 1 === 0) canvas.add(new FabricText(label, { left: x + 2, top: 6, fontSize: 8,
        fill: theme.muted, selectable: false, evented: false }));
    }
  }

  // start star
  canvas.add(star(lo.gutter - 14, lo.headerH + 12, 9, theme.accent));

  for (const bar of lo.bars) {
    canvas.add(new Rect({ left: bar.x, top: bar.y, width: bar.width, height: bar.height,
      rx: 4, ry: 4, fill: bar.critical ? '#fbe3e3' : '#e6edfb',
      stroke: bar.critical ? theme.critical : theme.accent, strokeWidth: 1.3,
      selectable: false, evented: false }));
    const lbl = `${bar.task.title || bar.task.id}${bar.task.cost ? ` (${bar.task.cost}d)` : ''}`;
    canvas.add(new FabricText(lbl, { left: bar.x + 6, top: bar.y + bar.height / 2, originY: 'center',
      fontSize: 10, fill: theme.text, selectable: false, evented: false }));
  }
  canvas.add(new FabricText(`total: ${lo.total} working days`, { left: lo.gutter, top: lo.height - 12,
    fontSize: 10, fill: theme.muted, selectable: false, evented: false }));
}

function star(cx, cy, r, fill) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? r * 0.45 : r;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad });
  }
  return new Polygon(pts, { left: cx, top: cy, originX: 'center', originY: 'center', fill,
    selectable: false, evented: false });
}

function drawPlaceholder(canvas, theme, msg, w) {
  canvas.add(new FabricText(msg, { left: 20, top: 20, fontSize: 13, fill: theme.critical }));
}

// ---------- navigation + persist ----------

function wireNavigation(container, canvas, applyZoom, getZoom) {
  canvas.on('mouse:wheel', (opt) => {
    const delta = opt.e.deltaY;
    applyZoom(getZoom() * 0.999 ** delta);
    opt.e.preventDefault();
    opt.e.stopPropagation();
  });
  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey) return;
    if (e.key === 'ArrowUp') { applyZoom(getZoom() * 1.1); e.preventDefault(); }
    if (e.key === 'ArrowDown') { applyZoom(getZoom() / 1.1); e.preventDefault(); }
  });
  // background drag = pan via container scroll
  let panning = false, sx = 0, sy = 0, sl = 0, st = 0;
  canvas.on('mouse:down', (opt) => {
    if (opt.target) return;
    panning = true; sx = opt.e.clientX; sy = opt.e.clientY; sl = container.scrollLeft; st = container.scrollTop;
  });
  canvas.on('mouse:move', (opt) => {
    if (!panning) return;
    container.scrollLeft = sl - (opt.e.clientX - sx);
    container.scrollTop = st - (opt.e.clientY - sy);
  });
  canvas.on('mouse:up', () => { panning = false; });
}

function wirePersist(canvas, model, onPersist) {
  canvas.on('object:modified', (opt) => {
    const o = opt.target;
    if (!o?.data?.id) return;
    setPos(model.doc, o.data.id, Math.round(o.left), Math.round(o.top));
    onPersist(emit(model.doc));
  });
}

function makeGroup(objects, opts) {
  return new FabricGroup(objects, { subTargetCheck: false, ...opts, originX: 'center', originY: 'center' });
}
