// Fabric renderer (spec §7) + canvas navigation (§7.1) + drag persist (§8.5).
// Browser-only (needs a DOM canvas). Dispatches by diagram type; system and gantt are
// implemented, other types draw a "not yet" placeholder so the bundle stays whole.

import { Canvas, Rect, Ellipse, Circle, Textbox, Line, Polygon, Polyline, Path, FabricText, Group as FabricGroup } from 'fabric';
import { layout, memberLine } from './layout.js';
import { setPos, emit } from './kdl.js';

const THEME = {
  light: { bg: '#ffffff', stroke: '#44485a', fill: '#f4f6fb', text: '#1c2030',
           group: '#8a90a6', critical: '#d23b3b', accent: '#3b6fd2', muted: '#6b7185' },
};
const GROUP_DASH = { boundary: [], zone: [], process: [6, 4], cluster: [2, 4],
                     workflow: [8, 3, 2, 3], network: [4, 4] };
// vendor brand colors for the corner badge
const VENDOR_COLOR = { aws: '#ff9900', gcp: '#4285f4', azure: '#0078d4', cf: '#f38020', ci: '#5b6470' };

// service name -> category, so a vendor badge can show a category glyph without loading packs.
const SERVICE_CATEGORY = {
  lambda: 'function', cloudfunctions: 'function', functions: 'function', workers: 'function',
  ec2: 'vm', gce: 'vm', vm: 'vm',
  fargate: 'container', ecs: 'container', eks: 'container', cloudrun: 'container', aks: 'container', gke: 'container', containerinstances: 'container', containerapps: 'container',
  s3: 'blob', ebs: 'blob', efs: 'blob', gcs: 'blob', blobstorage: 'blob', r2: 'blob',
  dynamodb: 'kv', firestore: 'kv', datastore: 'kv', bigtable: 'kv', cosmosdb: 'kv', tablestorage: 'kv', durableobjects: 'kv',
  rds: 'sql', aurora: 'sql', redshift: 'sql', cloudsql: 'sql', spanner: 'sql', bigquery: 'sql', sqldatabase: 'sql', synapse: 'sql', d1: 'sql',
  elasticache: 'cache', memorydb: 'cache', memorystore: 'cache', cacheforredis: 'cache', hyperdrive: 'cache',
  sqs: 'queue', cloudtasks: 'queue', queuestorage: 'queue', queues: 'queue', mq: 'queue',
  sns: 'topic', kinesis: 'topic', eventbridge: 'topic', pubsub: 'topic', eventhubs: 'topic', eventgrid: 'topic', servicebus: 'topic', msk: 'topic',
  cloudfront: 'cdn', cloudcdn: 'cdn', frontdoor: 'cdn',
  route53: 'dns', clouddns: 'dns',
  alb: 'lb', nlb: 'lb', cloudloadbalancing: 'lb', loadbalancer: 'lb', loadbalancing: 'lb', applicationgateway: 'lb',
};

/** Original, simple category glyph (NOT a vendor logo), centered at (cx,cy), in `color`. */
function iconGlyph(cat, cx, cy, color, s) {
  const o = { selectable: false, evented: false, originX: 'center', originY: 'center' };
  const at = (dx, dy, x) => ({ ...o, left: cx + dx, top: cy + dy, ...x });
  const bolt = [{ x: 0.5 * s, y: -s }, { x: -0.7 * s, y: 0.1 * s }, { x: -0.05 * s, y: 0.1 * s }, { x: -0.5 * s, y: s }, { x: 0.7 * s, y: -0.1 * s }, { x: 0.05 * s, y: -0.1 * s }];
  switch (cat) {
    case 'function': case 'cache': return [new Polygon(bolt, at(0, 0, { fill: color }))];
    case 'queue': return [-1, 0, 1].map((i) => new Rect(at(i * s * 0.72, 0, { width: s * 0.36, height: s * 1.8, fill: color })));
    case 'sql': case 'kv': return [
      new Ellipse(at(0, -s * 0.62, { rx: s * 0.9, ry: s * 0.32, fill: color })),
      new Rect(at(0, 0, { width: s * 1.8, height: s * 1.1, fill: color })),
      new Ellipse(at(0, s * 0.55, { rx: s * 0.9, ry: s * 0.32, fill: color })),
    ];
    case 'blob': return [new Polygon([{ x: -s, y: -0.7 * s }, { x: s, y: -0.7 * s }, { x: 0.7 * s, y: 0.8 * s }, { x: -0.7 * s, y: 0.8 * s }], at(0, 0, { fill: color }))];
    case 'topic': case 'cdn': return [new Polygon([{ x: 0, y: -s }, { x: s, y: 0.6 * s }, { x: -s, y: 0.6 * s }], at(0, 0, { fill: color }))];
    case 'container': return [new Rect(at(0, -s * 0.5, { width: s * 1.7, height: s * 0.7, fill: color })), new Rect(at(0, s * 0.5, { width: s * 1.7, height: s * 0.7, fill: color }))];
    case 'lb': return [new Polygon([{ x: 0, y: -s }, { x: s, y: 0 }, { x: 0, y: s }, { x: -s, y: 0 }], at(0, 0, { fill: color }))];
    default: return [new Rect(at(0, 0, { width: s * 1.6, height: s * 1.6, rx: 1, fill: color }))]; // compute/vm/service chip
  }
}

// base kind -> shape family (spec §5.4)
const FAMILY = {};
for (const k of ['service', 'component', 'actor', 'external', 'gateway', 'function', 'container', 'vm']) FAMILY[k] = 'compute';
for (const k of ['sql', 'kv', 'blob', 'cache', 'timeseries', 'graph', 'search']) FAMILY[k] = 'storage';
for (const k of ['queue', 'topic']) FAMILY[k] = 'messaging';
for (const k of ['lb', 'cdn', 'dns', 'firewall', 'waf', 'proxy', 'vpn', 'nat', 'router', 'mesh', 'endpoint']) FAMILY[k] = 'network';
const familyOf = (base) => FAMILY[base] || 'compute';

/** Shape parts (centered at origin) for a node family — boxes/cylinders/pills/channels. */
function shapeParts(family, base, w, h, fill, stroke) {
  const common = { fill, stroke, strokeWidth: 0.75, originX: 'center', originY: 'center' };
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
  if (family === 'network') return networkShape(base, w, h, common, fill, stroke);
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

/** Per-kind geometric shapes for the network family (industry-conventional). */
function networkShape(base, w, h, common, fill, stroke) {
  const ln = (pts) => new Line(pts, { stroke, strokeWidth: 0.6, originX: 'center', originY: 'center', selectable: false, evented: false });
  switch (base) {
    case 'lb': // load balancer — diamond (distributes traffic)
      return [new Polygon([{ x: 0, y: -h / 2 }, { x: w / 2, y: 0 }, { x: 0, y: h / 2 }, { x: -w / 2, y: 0 }], common)];
    case 'firewall': { // brick wall
      const parts = [new Rect({ ...common, width: w, height: h, rx: 2, ry: 2 })];
      const rows = 3, rh = h / rows;
      for (let i = 1; i < rows; i++) parts.push(ln([-w / 2, -h / 2 + i * rh, w / 2, -h / 2 + i * rh]));
      for (let r = 0; r < rows; r++) {
        const off = (r % 2) ? w / 4 : w / 2;
        for (let x = -w / 2 + off; x < w / 2 - 1; x += w / 2) parts.push(ln([x, -h / 2 + r * rh, x, -h / 2 + (r + 1) * rh]));
      }
      return parts;
    }
    case 'waf': { // shield
      const sw = w * 0.6, t = -h / 2 + 1, b = h / 2 - 1;
      return [new Path(`M ${-sw / 2} ${t} L ${sw / 2} ${t} L ${sw / 2} ${t + h * 0.4} Q ${sw / 2} ${b} 0 ${b} Q ${-sw / 2} ${b} ${-sw / 2} ${t + h * 0.4} Z`, { ...common })];
    }
    case 'cdn': { // globe — outline + two latitude lines, center kept clear for the label
      const rx = w / 2, ry = h / 2;
      return [
        new Ellipse({ ...common, rx, ry }),
        ln([-rx * 0.78, -ry * 0.5, rx * 0.78, -ry * 0.5]),
        ln([-rx * 0.78, ry * 0.5, rx * 0.78, ry * 0.5]),
      ];
    }
    case 'dns':
    case 'mesh':
    case 'proxy': // hexagon
      return [new Polygon([
        { x: -w / 2 + w * 0.16, y: -h / 2 }, { x: w / 2 - w * 0.16, y: -h / 2 }, { x: w / 2, y: 0 },
        { x: w / 2 - w * 0.16, y: h / 2 }, { x: -w / 2 + w * 0.16, y: h / 2 }, { x: -w / 2, y: 0 },
      ], common)];
    case 'router':
    case 'nat': // round
      return [new Ellipse({ ...common, rx: w / 2, ry: h / 2 })];
    default: // pill (vpn, endpoint, …)
      return [new Rect({ ...common, width: w, height: h, rx: h / 2, ry: h / 2 })];
  }
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
  } else if (lo.kind === 'iso') {
    drawSystemIso(canvas, model, lo, theme);
  } else if (lo.kind === 'gantt-graph') {
    drawGanttGraph(canvas, model, lo, theme);
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

// ---------- isometric (line-art 2.5D) ----------

const isoP = (cx, cy, dx, dy, dz, S = 0.62, Z = 0.8) => ({ x: cx + (dx - dy) * S, y: cy + (dx + dy) * 0.5 * S - dz * Z });
const isoFace = (pts, fill, stroke) => new Polygon(pts, { fill, stroke, strokeWidth: 1, strokeLineJoin: 'round', selectable: false, evented: false });

/** Line-art iso box centered on ground point (cx,cy); footprint 2a×2b, height h. Top + 2 front faces. */
function isoBox(cx, cy, a, b, h, fill, topFill, stroke) {
  const P = (dx, dy, dz) => isoP(cx, cy, dx, dy, dz);
  const bff = P(a, b, 0), bfr = P(a, -b, 0), bbl = P(-a, b, 0);
  const tff = P(a, b, h), tfr = P(a, -b, h), tbl = P(-a, b, h), tbb = P(-a, -b, h);
  return { P, parts: [
    isoFace([tff, tfr, tbb, tbl], topFill, stroke), // top
    isoFace([bbl, bff, tff, tbl], fill, stroke),    // left front face (y = +b)
    isoFace([bfr, bff, tff, tfr], fill, stroke),    // right front face (x = +a)
  ] };
}

const ISO = { stroke: '#3a4256', fill: '#ffffff', top: '#eef1f8', accent: '#e07b39' };

/** Line-art iso drum (stacked-disc database/cache), centered on ground point (cx,cy). */
function isoDrum(cx, cy, r, h, segs, stroke, accent) {
  const S = 0.62, Z = 0.8, erx = r * S, ery = r * S * 0.5, th = h * Z, topY = cy - th;
  const arc = (y) => new Path(`M ${cx - erx} ${y} Q ${cx} ${y + ery} ${cx + erx} ${y}`, { fill: '', stroke, strokeWidth: 0.7, selectable: false, evented: false });
  const p = [
    new Rect({ left: cx, top: cy - th / 2, width: erx * 2, height: th, originX: 'center', originY: 'center', fill: ISO.fill, selectable: false, evented: false }),
    new Line([cx - erx, topY, cx - erx, cy], { stroke, strokeWidth: 1, selectable: false, evented: false }),
    new Line([cx + erx, topY, cx + erx, cy], { stroke, strokeWidth: 1, selectable: false, evented: false }),
    arc(cy),
  ];
  for (let i = 1; i < segs; i++) p.push(arc(topY + th * i / segs));
  p.push(new Ellipse({ left: cx, top: topY, rx: erx, ry: ery, originX: 'center', originY: 'center', fill: accent ? '#fceadd' : ISO.top, stroke, strokeWidth: 1, selectable: false, evented: false }));
  return p;
}

/** Original line-art person (actor/user). */
function isoPerson(cx, cy, stroke) {
  return [
    new Line([cx - 3, cy, cx - 3, cy - 12], { stroke, strokeWidth: 1.4, selectable: false, evented: false }),
    new Line([cx + 3, cy, cx + 3, cy - 12], { stroke, strokeWidth: 1.4, selectable: false, evented: false }),
    new Polygon([{ x: cx - 7, y: cy - 26 }, { x: cx + 7, y: cy - 26 }, { x: cx + 5, y: cy - 12 }, { x: cx - 5, y: cy - 12 }],
      { fill: ISO.fill, stroke, strokeWidth: 1, selectable: false, evented: false }),
    new Circle({ left: cx, top: cy - 20, radius: 1.8, fill: ISO.accent, originX: 'center', originY: 'center', selectable: false, evented: false }),
    new Circle({ left: cx, top: cy - 32, radius: 6, fill: ISO.fill, stroke, strokeWidth: 1, originX: 'center', originY: 'center', selectable: false, evented: false }),
  ];
}

/** Original line-art monitor/dashboard (external app/client device) with accent chart bars. */
function isoMonitor(cx, cy, stroke) {
  const sw = 24, sh = 16, top = cy - 8 - sh, p = [
    new Line([cx, cy, cx, cy - 8], { stroke, strokeWidth: 1.4, selectable: false, evented: false }),
    new Line([cx - 6, cy, cx + 6, cy], { stroke, strokeWidth: 1.4, selectable: false, evented: false }),
    new Polygon([{ x: cx - sw / 2, y: top + 3 }, { x: cx + sw / 2, y: top - 3 }, { x: cx + sw / 2, y: top + sh - 3 }, { x: cx - sw / 2, y: top + sh + 3 }],
      { fill: ISO.fill, stroke, strokeWidth: 1, selectable: false, evented: false }),
  ];
  for (let i = 0; i < 3; i++) {
    const bx = cx - 6 + i * 6, baseY = top + sh - 2 - i * 1, bh = 4 + i * 3;
    p.push(new Line([bx, baseY, bx, baseY - bh], { stroke: ISO.accent, strokeWidth: 2, selectable: false, evented: false }));
  }
  return p;
}

/** Original "person at a desk": back panel + counter with a figure peeking over.
 *  cap=true → police cap (guard / cop); else a receptionist / maître d'. */
function isoDeskFigure(cx, cy, stroke, cap) {
  const fill = ISO.fill;
  const panel = isoBox(cx, cy - 7, 22, 3, 26, fill, ISO.top, stroke);
  const counter = isoBox(cx, cy, 24, 16, 11, fill, ISO.top, stroke);
  const rx = cx - 5, ry = cy - 5, hy = ry - 20;
  const person = [
    new Polygon([{ x: rx - 5, y: ry - 16 }, { x: rx + 5, y: ry - 16 }, { x: rx + 4, y: ry - 9 }, { x: rx - 4, y: ry - 9 }], { fill, stroke, strokeWidth: 1, selectable: false, evented: false }), // shoulders
    new Circle({ left: rx, top: hy, radius: 4.5, fill, stroke, strokeWidth: 1, originX: 'center', originY: 'center', selectable: false, evented: false }), // head
    new Circle({ left: rx, top: ry - 13, radius: 1.2, fill: ISO.accent, originX: 'center', originY: 'center', selectable: false, evented: false }), // badge/tie
  ];
  if (cap) { // police cap
    person.push(new Polygon([{ x: rx - 5, y: hy - 3 }, { x: rx + 5, y: hy - 3 }, { x: rx + 4, y: hy - 7 }, { x: rx - 4, y: hy - 7 }], { fill, stroke, strokeWidth: 1, selectable: false, evented: false }));
    person.push(new Line([rx - 6, hy - 2, rx + 6, hy - 2], { stroke, strokeWidth: 1.2, selectable: false, evented: false }));
    person.push(new Circle({ left: rx, top: hy - 5, radius: 1, fill: ISO.accent, originX: 'center', originY: 'center', selectable: false, evented: false }));
  }
  return [...panel.parts, ...person, ...counter.parts]; // counter last → figure peeks over it
}

/** Original line-art iso sprite per component (no copyrighted artwork). */
function isoSprite(base, cx, cy, stroke) {
  const fill = '#ffffff', top = '#eef1f8';
  const seg = (p1, p2) => new Line([p1.x, p1.y, p2.x, p2.y], { stroke, strokeWidth: 0.7, selectable: false, evented: false });
  const fam = familyOf(base);
  if (base === 'actor') return isoPerson(cx, cy, stroke);
  if (base === 'external') return isoMonitor(cx, cy, stroke);
  if (base === 'waf') return isoDeskFigure(cx, cy, stroke, true); // guard/cop at a checkpoint desk
  if (base === 'firewall') { // brick wall
    const a = 30, b = 5, h = 28, box = isoBox(cx, cy, a, b, h, fill, top, stroke), p = box.parts, rows = 4;
    for (let r = 1; r < rows; r++) p.push(seg(box.P(-a, b, h * r / rows), box.P(a, b, h * r / rows)));
    for (let r = 0; r < rows; r++) { const off = (r % 2) ? a / 2 : 0; for (let x = -a + off; x < a; x += a) p.push(seg(box.P(x, b, h * r / rows), box.P(x, b, h * (r + 1) / rows))); }
    return p;
  }
  if (base === 'gateway') return isoDeskFigure(cx, cy, stroke, false); // receptionist / maître d' at the desk
  if (base === 'lb') { // splitter — low hub with diverging lanes on top
    const a = 20, b = 14, h = 9, box = isoBox(cx, cy, a, b, h, fill, top, stroke), p = box.parts, c = box.P(0, 0, h);
    p.push(seg(c, box.P(a, b, h)), seg(c, box.P(a, -b, h)), seg(c, box.P(-a, 0, h)));
    return p;
  }
  if (fam === 'storage') {
    if (base === 'blob') { // warehouse shelves
      const a = 22, b = 16, h = 26, box = isoBox(cx, cy, a, b, h, fill, top, stroke), p = box.parts;
      for (let i = 1; i < 3; i++) p.push(seg(box.P(-a, b, h * i / 3), box.P(a, b, h * i / 3)));
      for (let j = 1; j < 3; j++) { const x = -a + 2 * a * j / 3; p.push(seg(box.P(x, b, 0), box.P(x, b, h))); }
      return p;
    }
    return isoDrum(cx, cy, 17, 30, base === 'cache' ? 2 : 3, stroke, base === 'cache'); // db / cache / kv = stacked drum
  }
  if (fam === 'compute') { // server / rack — taller (with slots) for containers; accent LED per slot
    const tall = base === 'container', a = 18, b = 13, h = tall ? 40 : 20;
    const box = isoBox(cx, cy, a, b, h, fill, top, stroke), p = box.parts, slots = tall ? 5 : 2;
    for (let i = 1; i <= slots; i++) {
      const z = h * i / (slots + 1);
      p.push(seg(box.P(-a, b, z), box.P(a, b, z)));
      const d = box.P(a * 0.72, b, z + h * 0.05);
      p.push(new Circle({ left: d.x, top: d.y, radius: 1.6, fill: ISO.accent, originX: 'center', originY: 'center', selectable: false, evented: false }));
    }
    return p;
  }
  if (fam === 'messaging') return isoBox(cx, cy, 22, 14, 12, fill, top, stroke).parts; // conveyor (low slab)
  return isoBox(cx, cy, 17, 13, 15, fill, top, stroke).parts; // network/other — plain block
}

function drawSystemIso(canvas, model, lo, theme) {
  for (const e of lo.edges) {
    const a = lo.nodes[e.from], b = lo.nodes[e.to];
    if (a && b) canvas.add(new Line([a.x, a.y, b.x, b.y], { stroke: theme.muted, strokeWidth: 1, selectable: false, evented: false }));
  }
  // draw back-to-front so nearer sprites overlap farther ones
  const ids = Object.keys(lo.nodes).sort((i, j) => lo.nodes[i].y - lo.nodes[j].y);
  for (const id of ids) {
    const n = lo.nodes[id];
    for (const part of isoSprite(n.el.base || n.el.kind, n.x, n.y, theme.stroke)) canvas.add(part);
    canvas.add(new FabricText(n.el.label || id, { left: n.x, top: n.y + 22, originX: 'center', fontSize: 11, fill: theme.text, selectable: false, evented: false }));
  }
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
    // UML class relationships (spec §5.1)
    case 'inheritance': toEnd = 'triangle'; break;
    case 'implementation': toEnd = 'triangle'; dashed = true; break;
    case 'aggregation': fromEnd = 'diamond'; toEnd = 'none'; break;
    case 'composition': fromEnd = 'filled-diamond'; toEnd = 'none'; break;
    case 'association': toEnd = 'none'; break;
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

// Length each end occupies along the edge (so the line can stop at its base, tip = border).
const END_LEN = { arrow: 8, open: 8, triangle: 12, diamond: 16, 'filled-diamond': 16, dot: 8, 'o-dot': 8, cross: 10, none: 0 };
const endLen = (k) => END_LEN[k] || 0;

function makeEnd(kind, color, s = 8) {
  const tri = [{ x: 0, y: 0 }, { x: -s, y: -s * 0.55 }, { x: -s, y: s * 0.55 }];
  const vee = [{ x: -s, y: -s * 0.6 }, { x: 0, y: 0 }, { x: -s, y: s * 0.6 }]; // open stick arrow
  const big = [{ x: 0, y: 0 }, { x: -1.5 * s, y: -s * 0.9 }, { x: -1.5 * s, y: s * 0.9 }];
  const dia = [{ x: 0, y: 0 }, { x: -s, y: -s * 0.6 }, { x: -2 * s, y: 0 }, { x: -s, y: s * 0.6 }];
  const base = { originX: 'center', originY: 'center', selectable: false, evented: false };
  switch (kind) {
    case 'arrow': return new Polygon(tri, { ...base, fill: color });
    case 'open': return new Polyline(vee, { ...base, fill: '', stroke: color, strokeWidth: 1.1 });
    case 'triangle': return new Polygon(big, { ...base, fill: '#fff', stroke: color, strokeWidth: 0.75 }); // UML generalization
    case 'diamond': return new Polygon(dia, { ...base, fill: '#fff', stroke: color, strokeWidth: 0.75 });
    case 'filled-diamond': return new Polygon(dia, { ...base, fill: color });
    case 'dot': return new Circle({ ...base, radius: s * 0.5, fill: color });
    case 'o-dot': return new Circle({ ...base, radius: s * 0.5, fill: '#fff', stroke: color, strokeWidth: 0.75 });
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
  const parts = shapeParts(fam, el.base, n.width, n.height, fill, stroke);
  const sub = el.text?.slots?.subtitle?.content;
  // cylinders carry a top cap, so center the label in the body below it (drop by ~cap depth).
  const yOff = fam === 'storage' ? Math.min(10, n.height * 0.18) : 0;
  parts.push(new Textbox(el.label || el.id, {
    width: n.width - 16, originX: 'center', originY: 'center', top: (sub ? -8 : 0) + yOff,
    fontSize: 13, textAlign: 'center', fill: theme.text, fontFamily: 'sans-serif',
  }));
  if (sub) parts.push(new Textbox(sub, { width: n.width - 16, originX: 'center', originY: 'center',
    top: 12 + yOff, fontSize: 10, textAlign: 'center', fill: theme.muted, fontFamily: 'monospace' }));
  if (el.kindRef) { // vendor badge: brand-colored chip + an original category glyph (no official logos)
    const cat = el.base || SERVICE_CATEGORY[el.service] || 'service';
    const bx = -n.width / 2 + 12, by = -n.height / 2 + 12;
    parts.push(new Rect({ left: bx, top: by, width: 17, height: 17, rx: 4, ry: 4, originX: 'center', originY: 'center',
      fill: VENDOR_COLOR[el.vendor] || theme.accent, selectable: false, evented: false }));
    for (const g of iconGlyph(cat, bx, by, '#fff', 4)) parts.push(g);
  }
  return parts;
}

/** State-machine node: state/composite (rounded), initial/final dots, choice diamond. */
function stateParts(el, n, theme) {
  const w = n.width, h = n.height;
  const base = { originX: 'center', originY: 'center', fill: el.style?.fill || theme.fill,
    stroke: el.style?.stroke || theme.stroke, strokeWidth: 0.75 };
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
    fill: el.style?.fill || theme.fill, stroke: el.style?.stroke || theme.stroke, strokeWidth: 0.75, rx: 3, ry: 3 })];

  const headH = stereo ? 40 : 26;
  const headMid = -hh + headH / 2; // center the header block in its band
  if (stereo) parts.push(new FabricText(stereo, { left: 0, top: headMid - 8, originX: 'center', originY: 'center', fontSize: 9, fill: theme.muted }));
  parts.push(new FabricText(el.label || el.id, { left: 0, top: stereo ? headMid + 6 : headMid, originX: 'center', originY: 'center', fontSize: 13,
    fontWeight: el.kind === 'abstract' ? 'normal' : 'bold', fontStyle: el.kind === 'abstract' ? 'italic' : 'normal', fill: theme.text }));

  // Optional compartments (attrs / methods) — equal PAD top & bottom, text centered per ROW.
  const ROW = 16, PAD = 5;
  let dy = -hh + headH;
  const section = (list, kind) => {
    if (!list || !list.length) return;
    parts.push(new Line([-hw, dy, hw, dy], { stroke: theme.stroke, strokeWidth: 0.75, originX: 'center', originY: 'center' }));
    dy += PAD;
    for (const m of list) {
      parts.push(new FabricText(memberLine(m, kind), { left: -hw + 8, top: dy + ROW / 2, originX: 'left', originY: 'center', fontSize: 11, fontFamily: 'monospace', fill: theme.text }));
      dy += ROW;
    }
    dy += PAD;
  };
  section(el.attrs, 'attr');
  section(el.methods, 'method');
  return parts;
}

function drawEdge(canvas, e, lo, theme) {
  const a = lo.nodes[e.from], b = lo.nodes[e.to];
  if (!a || !b) return;
  const p = borderPoint(a, b), q = borderPoint(b, a);
  const { fromEnd, toEnd, dashed, glyph } = resolveEnds(e.el);
  const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const tl = endLen(toEnd), fl = endLen(fromEnd);
  // line stops at each arrowhead's base, so it never shows through a hollow/open head
  canvas.add(new Line([p.x + ux * fl, p.y + uy * fl, q.x - ux * tl, q.y - uy * tl], {
    stroke: theme.stroke, strokeWidth: 1.1, strokeDashArray: dashed ? [5, 4] : [],
    selectable: false, evented: false,
  }));
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  // tip sits ON the border: place the head's center back by half its length
  placeEnd(canvas, makeEnd(toEnd, theme.stroke), q.x - ux * tl / 2, q.y - uy * tl / 2, deg);
  placeEnd(canvas, makeEnd(fromEnd, theme.stroke), p.x + ux * fl / 2, p.y + uy * fl / 2, deg + 180);

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
  const outline = model.palette?.outline || '#000';
  const STRIP = 14; // fixed-width dependency strip (same for every task), subdivided per dep
  for (const bar of lo.bars) {
    const nb = bar.depColors ? bar.depColors.length : 0;
    const stripW = nb ? STRIP : 0;
    // outline is always the configured color (black default), thin; critical = a bit thicker.
    canvas.add(new Rect({ left: bar.x, top: bar.y, width: bar.width, height: bar.height,
      rx: 4, ry: 4, fill: bar.color || '#e6edfb', stroke: outline, strokeWidth: bar.critical ? 1.5 : 0.75,
      selectable: false, evented: false }));
    // one vertical segment per dependency; the binding dep (index 0) is twice as wide.
    if (nb) {
      const weights = bar.depColors.map((_, i) => (i === bar.bindingIdx ? 2 : 1));
      const tot = weights.reduce((a, w) => a + w, 0);
      let x = bar.x + 0.5;
      bar.depColors.forEach((c, i) => {
        const w = (STRIP - 1) * weights[i] / tot;
        canvas.add(new Rect({ left: x, top: bar.y + 0.5, width: w, height: bar.height - 1, fill: c,
          selectable: false, evented: false }));
        if (i > 0) canvas.add(new Line([x, bar.y + 0.5, x, bar.y + bar.height - 0.5],
          { stroke: outline, strokeWidth: 0.5, selectable: false, evented: false }));
        x += w;
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
      // label floats above the line (no opaque plate, so it doesn't gap the lifelines)
      if (msg.label) canvas.add(new FabricText(msg.label, { left: (msg.x1 + msg.x2) / 2, top: msg.y - 14,
        originX: 'center', fontSize: 10, fill: theme.text, selectable: false, evented: false }));
    }
  }
}

// gantt "organize" (timeless) view: task nodes + arrows to dependencies.
function drawGanttGraph(canvas, model, lo, theme) {
  const outline = model.palette?.outline || '#000';
  const unitLetter = lo.unit === 'hour' ? 'h' : 'd';
  for (const e of lo.edges) {
    const a = lo.nodes[e.from], b = lo.nodes[e.to];
    if (!a || !b) continue;
    const p = borderPoint(a, b), q = borderPoint(b, a);
    canvas.add(new Line([p.x, p.y, q.x, q.y], { stroke: theme.muted, strokeWidth: 1.2, selectable: false, evented: false }));
    placeEnd(canvas, makeEnd('arrow', theme.muted, 7), q.x, q.y, (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI);
  }
  for (const id in lo.nodes) {
    const n = lo.nodes[id];
    if (n.isStart) { canvas.add(star(n.x, n.y, 11, theme.accent)); continue; }
    canvas.add(new Rect({ left: n.x, top: n.y, width: n.width, height: n.height, originX: 'center', originY: 'center',
      rx: 5, ry: 5, fill: n.color || theme.fill, stroke: outline, strokeWidth: 0.75, selectable: false, evented: false }));
    const t = n.task;
    canvas.add(new FabricText(`${t.title || t.id}${t.cost ? ` (${t.cost}${unitLetter})` : ''}`,
      { left: n.x, top: n.y, originX: 'center', originY: 'center', fontSize: 11, fill: '#1c2030', selectable: false, evented: false }));
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
    if (!opt.e.ctrlKey) return; // plain wheel scrolls the container; Ctrl+wheel zooms
    applyZoom(getZoom() * 0.999 ** opt.e.deltaY);
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
