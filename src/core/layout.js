// Layout (spec §6). Graph types -> dagre; gantt -> the scheduler (schedule.js) mapped
// onto lane rows × a day axis. Node sizes are estimated from label length so layout is
// deterministic and headless-testable; the renderer refines with real text metrics.

import dagre from 'dagre';
import { schedule } from './schedule.js';

const CHAR_W = 0.58; // approx glyph advance as a fraction of font size

export function estimateSize(el, fontSize = 13) {
  const lines = [el.label || el.title || el.id || ''];
  if (el.text?.slots?.subtitle?.content) lines.push(el.text.slots.subtitle.content);
  const longest = Math.max(...lines.map((s) => s.length));
  return {
    width: Math.max(120, Math.round(longest * fontSize * CHAR_W) + 36),
    height: 40 + (lines.length - 1) * 16,
  };
}

/** dagre layout for graph types. Returns laid-out nodes, groups (bounding boxes), edges. */
export function layoutGraph(model) {
  const spacing = Number(model.layout?.spacing) || 50;
  const g = new dagre.graphlib.Graph({ compound: true });
  g.setGraph({
    rankdir: model.layout?.direction || 'TB',
    nodesep: spacing, ranksep: spacing, marginx: 24, marginy: 24,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const parentOf = {};
  for (const gr of model.groups) {
    g.setNode(gr.id, { isGroup: true, el: gr });
    for (const mid of gr.members) parentOf[mid] = gr.id;
  }
  for (const n of model.nodes) {
    g.setNode(n.id, { ...estimateSize(n), el: n });
    if (parentOf[n.id] && g.hasNode(parentOf[n.id])) g.setParent(n.id, parentOf[n.id]);
  }
  for (const e of model.edges) if (g.hasNode(e.from) && g.hasNode(e.to)) g.setEdge(e.from, e.to, { el: e });

  dagre.layout(g);

  const nodes = {}, groups = {}, edges = [];
  for (const id of g.nodes()) {
    const nd = g.node(id);
    if (nd.isGroup) {
      groups[id] = { x: nd.x, y: nd.y, width: nd.width, height: nd.height, el: nd.el };
    } else {
      let { x, y } = nd;
      if (nd.el.pos?.x != null) { x = Number(nd.el.pos.x); y = Number(nd.el.pos.y); } // pin
      nodes[id] = { x, y, width: nd.width, height: nd.height, el: nd.el };
    }
  }
  for (const ed of g.edges()) {
    const e = g.edge(ed);
    edges.push({ from: ed.v, to: ed.w, points: e.points, el: e.el });
  }
  const gg = g.graph();
  return { kind: 'graph', nodes, groups, edges, width: gg.width, height: gg.height };
}

/** gantt layout: lane bands + task bars positioned by the scheduler. */
export function layoutGantt(model, opts = {}) {
  const pxPerDay = opts.pxPerDay || 36;
  const rowH = 34, laneGap = 6, headerH = 28, gutter = 150;
  const s = schedule(model);
  if (s.cycle) return { kind: 'gantt', cycle: s.cycle };

  const timeless = model.mode === 'timeless';
  const lanes = model.lanes.length ? model.lanes : [{ id: '_', label: '' }];
  const laneIndex = {};
  lanes.forEach((l, i) => { laneIndex[l.id] = i; });

  const bars = [];
  // timeless mode places bars by dependency order column instead of time.
  model.tasks.forEach((t, i) => {
    const sc = s.tasks.get(t.id);
    const li = laneIndex[t.lane] ?? 0;
    const x0 = timeless ? gutter + (s.order.indexOf(t.id) - 1) * 90 : gutter + sc.es * pxPerDay;
    const w = timeless ? 80 : Math.max(8, sc.cost * pxPerDay);
    bars.push({
      task: t, es: sc.es, ef: sc.ef, critical: sc.critical,
      x: x0, y: headerH + li * (rowH + laneGap) + 4,
      width: w, height: rowH - 8, lane: t.lane,
      startDate: s.dates ? s.dates(sc.es) : undefined,
    });
  });

  return {
    kind: 'gantt', timeless, lanes, laneIndex, bars, total: s.total,
    rowH, laneGap, headerH, gutter, pxPerDay,
    width: gutter + (timeless ? model.tasks.length * 90 + 120 : s.total * pxPerDay + 40),
    height: headerH + lanes.length * (rowH + laneGap) + 16,
    dates: s.dates,
  };
}

/** Dispatch by diagram type. */
export function layout(model, opts) {
  return model.type === 'gantt' ? layoutGantt(model, opts) : layoutGraph(model);
}
