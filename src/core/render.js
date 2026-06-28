// Fabric renderer (spec §7) + canvas navigation (§7.1) + drag persist (§8.5).
// Browser-only (needs a DOM canvas). Dispatches by diagram type; system and gantt are
// implemented, other types draw a "not yet" placeholder so the bundle stays whole.

import { Canvas, Rect, Ellipse, Circle, Textbox, Line, Polygon, Path, FabricText, Group as FabricGroup } from 'fabric';
import { layout, memberLine } from './layout.js';
import { setPos, emit } from './kdl.js';

const THEME = {
  light: { bg: '#ffffff', stroke: '#44485a', fill: '#f4f6fb', text: '#1c2030',
           group: '#8a90a6', critical: '#d23b3b', accent: '#3b6fd2', muted: '#6b7185' },
};
const GROUP_DASH = { boundary: [], zone: [], process: [6, 4], cluster: [2, 4],
                     workflow: [8, 3, 2, 3], network: [4, 4] };

// base kind -> shape family (spec §5.4)
const FAMILY = {};
for (const k of ['service', 'component', 'actor', 'external', 'gateway', 'function', 'container', 'vm']) FAMILY[k] = 'compute';
for (const k of ['sql', 'kv', 'blob', 'cache', 'timeseries', 'graph', 'search']) FAMILY[k] = 'storage';
for (const k of ['queue', 'topic']) FAMILY[k] = 'messaging';
for (const k of ['lb', 'cdn', 'dns', 'firewall', 'waf', 'proxy', 'vpn', 'nat', 'router', 'mesh', 'endpoint']) FAMILY[k] = 'network';
const familyOf = (base) => FAMILY[base] || 'compute';

/** Shape parts (centered at origin) for a node family — boxes/cylinders/pills/channels. */
function shapeParts(family, w, h, fill, stroke) {
  const common = { fill, stroke, strokeWidth: 1.4, originX: 'center', originY: 'center' };
  if (family === 'storage') {
    // cylinder. Body is an OPEN path (sides + curved bottom, NO top edge), so nothing is
    // stroked across the top; the OPAQUE cap ellipse is drawn over it to form the rim.
    const rx = w / 2, ry = Math.min(10, h * 0.18);
    const cyTop = -h / 2 + ry, cyBot = h / 2 - ry;
    const body = `M ${rx} ${cyTop} L ${rx} ${cyBot} A ${rx} ${ry} 0 0 1 ${-rx} ${cyBot} L ${-rx} ${cyTop}`;
    return [
      new Path(body, { ...common, fill, left: 0, top: ry / 2 }), // top:ry/2 aligns the bbox-centered path
      new Ellipse({ ...common, fill, rx, ry, top: cyTop }),       // opaque cap (fill + stroke), drawn over
    ];
  }
  if (family === 'network') return [new Rect({ ...common, width: w, height: h, rx: h / 2, ry: h / 2 })];
  if (family === 'messaging') {
    // parallelogram (reads as flow/stream); topic vs queue differ by icon. No overlay.
    const sk = Math.min(h * 0.4, 14);
    return [new Polygon([
      { x: -w / 2 + sk, y: -h / 2 }, { x: w / 2, y: -h / 2 },
      { x: w / 2 - sk, y: h / 2 }, { x: -w / 2, y: h / 2 },
    ], common)];
  }
  return [new Rect({ ...common, width: w, height: h, rx: 7, ry: 7 })];
}

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
  } else if (lo.kind === 'sequence') {
    drawSequence(canvas, model, lo, theme);
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
    const build = model.type === 'state' ? stateParts
      : (el.attrs || el.methods) ? classParts : nodeParts;
    const parts = build(el, n, theme);

    const fg = makeGroup(parts, { left: n.x, top: n.y, selectable: !opts.readOnly,
      hasControls: false, hasBorders: !opts.readOnly, lockScalingX: true, lockScalingY: true, lockRotation: true });
    fg.data = { id };
    canvas.add(fg);
  }
}

// Resolve ends/line/glyph from kind presets + rel shorthand + explicit overrides (§5.6).
function resolveEnds(el) {
  let fromEnd = 'none', toEnd = 'open', dashed = false, glyph = el?.glyph;
  switch (el?.kind) {
    case 'dependency': dashed = true; toEnd = 'open'; break;
    case 'dataflow': case 'sync': case 'flow': case 'onsuccess': toEnd = 'arrow'; break;
    case 'async': dashed = true; toEnd = 'open'; glyph = glyph || 'clock'; break;
    case 'publishes': toEnd = 'arrow'; glyph = glyph || 'bolt'; break;
    case 'subscribes': toEnd = 'open'; break;
    case 'onfailure': toEnd = 'arrow'; dashed = true; break;
    case 'manual': toEnd = 'open'; dashed = true; glyph = glyph || 'manual'; break;
    default: break;
  }
  if (el?.rel === 'owns') { fromEnd = 'filled-diamond'; toEnd = 'open'; }
  else if (el?.rel === 'aggregates') { fromEnd = 'diamond'; toEnd = 'open'; }
  else if (el?.rel === 'refs') { toEnd = 'open'; dashed = true; }
  if (el?.line) dashed = el.line !== 'solid';
  if (el?.fromEnd) fromEnd = el.fromEnd;
  if (el?.toEnd) toEnd = el.toEnd;
  return { fromEnd, toEnd, dashed, glyph };
}

function makeEnd(kind, color, s = 8) {
  const tri = [{ x: 0, y: 0 }, { x: -s, y: -s * 0.55 }, { x: -s, y: s * 0.55 }];
  const dia = [{ x: 0, y: 0 }, { x: -s, y: -s * 0.6 }, { x: -2 * s, y: 0 }, { x: -s, y: s * 0.6 }];
  const base = { originX: 'center', originY: 'center', selectable: false, evented: false };
  switch (kind) {
    case 'arrow': return new Polygon(tri, { ...base, fill: color });
    case 'open': return new Polygon(tri, { ...base, fill: 'transparent', stroke: color, strokeWidth: 1.4 });
    case 'diamond': return new Polygon(dia, { ...base, fill: '#fff', stroke: color, strokeWidth: 1.4 });
    case 'filled-diamond': return new Polygon(dia, { ...base, fill: color });
    case 'dot': return new Circle({ ...base, radius: s * 0.5, fill: color });
    case 'o-dot': return new Circle({ ...base, radius: s * 0.5, fill: '#fff', stroke: color, strokeWidth: 1.4 });
    case 'cross': return new FabricText('✕', { ...base, fontSize: s * 1.6, fill: color });
    default: return null;
  }
}

const GLYPH_CHAR = { lock: '🔒', bolt: '⚡', clock: '⏱', manual: '✋' };
function glyphText(g) {
  if (!g) return null;
  if (g.startsWith('num:')) return g.slice(4);
  return GLYPH_CHAR[g] || g[0].toUpperCase();
}

function placeEnd(canvas, obj, x, y, angleDeg) {
  if (!obj) return;
  obj.set({ left: x, top: y, angle: angleDeg });
  canvas.add(obj);
}

/** Family-shaped node with title + optional subtitle slot + vendor badge. */
function nodeParts(el, n, theme) {
  const fill = el.style?.fill || theme.fill;
  const stroke = el.style?.stroke || theme.stroke;
  const fam = familyOf(el.base);
  const parts = shapeParts(fam, n.width, n.height, fill, stroke);
  const sub = el.text?.slots?.subtitle?.content;
  // cylinders carry a top cap, so center the label in the body below it (drop by ~cap depth).
  const yOff = fam === 'storage' ? Math.min(10, n.height * 0.18) : 0;
  parts.push(new Textbox(el.label || el.id, {
    width: n.width - 16, originX: 'center', originY: 'center', top: (sub ? -8 : 0) + yOff,
    fontSize: 13, textAlign: 'center', fill: theme.text, fontFamily: 'sans-serif',
  }));
  if (sub) parts.push(new Textbox(sub, { width: n.width - 16, originX: 'center', originY: 'center',
    top: 12 + yOff, fontSize: 10, textAlign: 'center', fill: theme.muted, fontFamily: 'monospace' }));
  if (el.kindRef) parts.push(new FabricText(el.kindRef, { originX: 'left', originY: 'top',
    left: -n.width / 2 + 6, top: -n.height / 2 + 4, fontSize: 8, fill: theme.accent }));
  return parts;
}

/** State-machine node: state/composite (rounded), initial/final dots, choice diamond. */
function stateParts(el, n, theme) {
  const w = n.width, h = n.height;
  const base = { originX: 'center', originY: 'center', fill: el.style?.fill || theme.fill,
    stroke: el.style?.stroke || theme.stroke, strokeWidth: 1.4 };
  if (el.kind === 'initial') return [new Circle({ ...base, radius: 9, fill: theme.stroke })];
  if (el.kind === 'final') return [
    new Circle({ ...base, radius: 11, fill: 'transparent' }),
    new Circle({ ...base, radius: 6, fill: theme.stroke }),
  ];
  if (el.kind === 'choice') return [new Polygon(
    [{ x: 0, y: -h / 2 }, { x: w / 2, y: 0 }, { x: 0, y: h / 2 }, { x: -w / 2, y: 0 }], base)];
  const parts = [new Rect({ ...base, width: w, height: h, rx: 12, ry: 12 })];
  if (el.kind === 'composite') parts.push(new Rect({ ...base, width: w - 6, height: h - 6, rx: 10, ry: 10, fill: 'transparent' }));
  parts.push(new FabricText(el.label || el.id, { left: 0, top: 0, originX: 'center', originY: 'center',
    fontSize: 12, fill: theme.text }));
  return parts;
}

/** UML class node: 3 compartments (name[/stereotype] · attributes · methods). */
function classParts(el, n, theme) {
  const w = n.width, h = n.height, hw = w / 2, hh = h / 2;
  const STEREO = { interface: '«interface»', enum: '«enumeration»' };
  const stereo = el.stereotype ? `«${el.stereotype}»` : STEREO[el.kind];
  const parts = [new Rect({ width: w, height: h, originX: 'center', originY: 'center',
    fill: el.style?.fill || theme.fill, stroke: el.style?.stroke || theme.stroke, strokeWidth: 1.4, rx: 3, ry: 3 })];

  const headH = 26;
  let y = -hh + 6;
  if (stereo) { parts.push(new FabricText(stereo, { left: 0, top: y, originX: 'center', fontSize: 9, fill: theme.muted })); y += 11; }
  parts.push(new FabricText(el.label || el.id, { left: 0, top: y, originX: 'center', fontSize: 13,
    fontWeight: el.kind === 'abstract' ? 'normal' : 'bold', fontStyle: el.kind === 'abstract' ? 'italic' : 'normal', fill: theme.text }));

  let dy = -hh + headH;
  const divider = () => parts.push(new Line([-hw, dy, hw, dy], { stroke: theme.stroke, strokeWidth: 1, originX: 'center', originY: 'center' }));
  const rows = (list, kind) => { for (const m of list || []) {
    dy += 16;
    parts.push(new FabricText(memberLine(m, kind), { left: -hw + 8, top: dy - 8, originX: 'left', fontSize: 11, fontFamily: 'monospace', fill: theme.text }));
  } };
  divider(); rows(el.attrs, 'attr');
  dy += 6; divider(); rows(el.methods, 'method');
  return parts;
}

function drawEdge(canvas, e, lo, theme) {
  const a = lo.nodes[e.from], b = lo.nodes[e.to];
  if (!a || !b) return;
  const p = borderPoint(a, b), q = borderPoint(b, a);
  const { fromEnd, toEnd, dashed, glyph } = resolveEnds(e.el);
  canvas.add(new Line([p.x, p.y, q.x, q.y], {
    stroke: theme.stroke, strokeWidth: 1.3, strokeDashArray: dashed ? [5, 4] : [],
    selectable: false, evented: false,
  }));
  const deg = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
  placeEnd(canvas, makeEnd(toEnd, theme.stroke), q.x, q.y, deg);
  placeEnd(canvas, makeEnd(fromEnd, theme.stroke), p.x, p.y, deg + 180);

  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
  const label = e.el?.label || transitionLabel(e.el);
  if (label) canvas.add(new FabricText(label, { left: mx, top: my - 9,
    fontSize: 10, fill: theme.muted, backgroundColor: theme.bg, originX: 'center',
    selectable: false, evented: false }));
  const gt = glyphText(glyph);
  if (gt) {
    canvas.add(new Circle({ left: mx, top: my, radius: 8, fill: theme.bg, stroke: theme.muted,
      strokeWidth: 1, originX: 'center', originY: 'center', selectable: false, evented: false }));
    canvas.add(new FabricText(gt, { left: mx, top: my, fontSize: 9, fill: theme.text,
      originX: 'center', originY: 'center', selectable: false, evented: false }));
  }
  // cardinality near the ends
  if (e.el?.fromCard) canvas.add(cardLabel(e.el.fromCard, p, q, theme));
  if (e.el?.toCard) canvas.add(cardLabel(e.el.toCard, q, p, theme));
}

/** `trigger [guard] / action` (spec §5.3). */
function transitionLabel(el) {
  if (!el?.trigger && !el?.guard && !el?.action) return null;
  return [el.trigger || '', el.guard ? `[${el.guard}]` : '', el.action ? `/ ${el.action}` : '']
    .filter(Boolean).join(' ');
}

function cardLabel(text, at, toward, theme) {
  const dx = toward.x - at.x, dy = toward.y - at.y, len = Math.hypot(dx, dy) || 1;
  return new FabricText(String(text), {
    left: at.x + (dx / len) * 16, top: at.y + (dy / len) * 16 - 6,
    fontSize: 9, fill: theme.muted, originX: 'center', selectable: false, evented: false,
  });
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

  // time header: a tick per unit; a stronger gridline + date label at each day boundary.
  if (!lo.timeless) {
    const dayStep = lo.unit === 'hour' ? lo.hoursPerDay : 1;
    for (let u = 0; u <= lo.total + 1e-6; u++) {
      const x = lo.gutter + u * lo.pxPerUnit;
      const dayBoundary = u % dayStep === 0;
      canvas.add(new Line([x, lo.headerH, x, lo.height],
        { stroke: dayBoundary ? '#e2e5ee' : '#f2f4f9', selectable: false, evented: false }));
      if (dayBoundary) canvas.add(new FabricText(lo.dates ? lo.dates(u).slice(5) : String(u),
        { left: x + 2, top: 6, fontSize: 8, fill: theme.muted, selectable: false, evented: false }));
    }
  }

  // start star (the do-nothing root every dependency chain bottoms out at)
  const starX = lo.gutter - 14, starY = lo.headerH + 12;
  canvas.add(star(starX, starY, 9, theme.accent));

  const unitLetter = lo.unit === 'hour' ? 'h' : 'd';
  for (const bar of lo.bars) {
    const stripW = bar.depColors && bar.depColors.length ? 12 : 0;
    canvas.add(new Rect({ left: bar.x, top: bar.y, width: bar.width, height: bar.height,
      rx: 4, ry: 4, fill: bar.color || '#e6edfb',
      stroke: bar.critical ? theme.critical : 'rgba(0,0,0,0.35)', strokeWidth: bar.critical ? 2 : 1,
      selectable: false, evented: false }));
    // recessed dependency swatch(es): the body color of each task this one depends on
    if (stripW) {
      const sh = (bar.height - 4) / bar.depColors.length;
      bar.depColors.forEach((c, i) => {
        const sx = bar.x + 2, sy = bar.y + 2 + i * sh;
        canvas.add(new Rect({ left: sx, top: sy, width: 8, height: sh - 1, rx: 1, ry: 1, fill: c,
          stroke: 'rgba(0,0,0,0.45)', strokeWidth: 0.75, selectable: false, evented: false }));
        canvas.add(new Line([sx + 8, sy, sx + 8, sy + sh - 1], // light inner edge -> recessed look
          { stroke: 'rgba(255,255,255,0.65)', strokeWidth: 0.75, selectable: false, evented: false }));
      });
    }
    const lbl = `${bar.task.title || bar.task.id}${bar.task.cost ? ` (${bar.task.cost}${unitLetter})` : ''}`;
    canvas.add(new FabricText(lbl, { left: bar.x + stripW + 6, top: bar.y + bar.height / 2, originY: 'center',
      fontSize: 10, fill: '#1c2030', selectable: false, evented: false }));
  }

  // Non-calendar (timeless) shows dependency arrows; calendar uses the color swatches instead.
  if (lo.timeless) {
    const startId = model.start ? model.start.id : 'start';
    const byId = {};
    lo.bars.forEach((b) => { byId[b.task.id] = b; });
    const startTarget = { x: starX, width: 0, y: starY - 9, height: 18 };
    for (const bar of lo.bars) {
      for (const dep of bar.task.deps || []) {
        const prereq = dep === startId ? startTarget : byId[dep];
        if (prereq) drawDepArrow(canvas, bar, prereq, theme); // task -> what it depends on
      }
    }
  }

  canvas.add(new FabricText(`total: ${lo.total} working ${(lo.unit || 'day')}s`, { left: lo.gutter, top: lo.height - 12,
    fontSize: 10, fill: theme.muted, selectable: false, evented: false }));
}

// Arrow points FROM the task TO its dependency (the prerequisite, earlier/left).
function drawDepArrow(canvas, task, dep, theme) {
  const sx = task.x, sy = task.y + task.height / 2;          // task left edge (tail)
  const tx = dep.x + dep.width, ty = dep.y + dep.height / 2; // dependency right edge (head)
  const mx = sx - 8;
  for (const p of [[sx, sy, mx, sy], [mx, sy, mx, ty], [mx, ty, tx, ty]]) {
    canvas.add(new Line(p, { stroke: theme.muted, strokeWidth: 1, selectable: false, evented: false }));
  }
  placeEnd(canvas, makeEnd('arrow', theme.muted, 6), tx, ty, 180); // head points left, into the dependency
}

// ---------- sequence ----------

function drawSequence(canvas, model, lo, theme) {
  for (const p of lo.participants) {
    canvas.add(new Line([p.x, lo.lifelineTop, p.x, lo.lifelineBottom],
      { stroke: '#c5c9d6', strokeDashArray: [4, 4], selectable: false, evented: false }));
    canvas.add(new Rect({ left: p.x, top: lo.lifelineTop - 17, width: 120, height: 30,
      originX: 'center', originY: 'center', rx: 5, ry: 5, fill: theme.fill, stroke: theme.stroke,
      strokeWidth: 1.3, selectable: false, evented: false }));
    canvas.add(new FabricText(p.label || p.id, { left: p.x, top: lo.lifelineTop - 17,
      originX: 'center', originY: 'center', fontSize: 12, fill: theme.text, selectable: false, evented: false }));
  }

  for (const fr of lo.fragments) {
    canvas.add(new Rect({ left: fr.x, top: fr.y, width: fr.w, height: fr.h,
      fill: 'rgba(60,80,160,0.03)', stroke: theme.accent, strokeWidth: 1, rx: 3, ry: 3,
      selectable: false, evented: false }));
    canvas.add(new FabricText(`${fr.kind}${fr.label ? ` [${fr.label}]` : ''}`,
      { left: fr.x + 5, top: fr.y + 2, fontSize: 9, fill: theme.accent, selectable: false, evented: false }));
    fr.branches.forEach((b, i) => {
      if (i > 0) canvas.add(new Line([fr.x, b.y, fr.x + fr.w, b.y],
        { stroke: theme.accent, strokeDashArray: [4, 3], selectable: false, evented: false }));
      if (b.label) canvas.add(new FabricText(b.label, { left: fr.x + fr.w / 2, top: b.y + 2,
        originX: 'center', fontSize: 9, fill: theme.muted, selectable: false, evented: false }));
    });
  }

  for (const msg of lo.messages) {
    const ret = msg.kind === 'return';
    if (msg.self) {
      const x = msg.x1, y = msg.y;
      [[x, y, x + 30, y], [x + 30, y, x + 30, y + 12], [x + 30, y + 12, x, y + 12]].forEach((pts) =>
        canvas.add(new Line(pts, { stroke: theme.stroke, selectable: false, evented: false })));
      placeEnd(canvas, makeEnd('open', theme.stroke), x, y + 12, 180);
      if (msg.label) canvas.add(new FabricText(msg.label, { left: x + 34, top: y - 2, fontSize: 10,
        fill: theme.text, selectable: false, evented: false }));
    } else {
      canvas.add(new Line([msg.x1, msg.y, msg.x2, msg.y], { stroke: theme.stroke, strokeWidth: 1.2,
        strokeDashArray: ret ? [5, 4] : [], selectable: false, evented: false }));
      placeEnd(canvas, makeEnd(msg.kind === 'async' || ret ? 'open' : 'arrow', theme.stroke),
        msg.x2, msg.y, msg.x2 >= msg.x1 ? 0 : 180);
      if (msg.label) canvas.add(new FabricText(msg.label, { left: (msg.x1 + msg.x2) / 2, top: msg.y - 12,
        originX: 'center', fontSize: 10, fill: theme.text, backgroundColor: theme.bg,
        selectable: false, evented: false }));
    }
  }
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
