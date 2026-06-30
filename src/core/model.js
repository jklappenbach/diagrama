// KDL Document -> normalized diagram model + validation (spec §4, §5).
//
// Generic envelope extraction (nodes/edges/groups/notes/nodetypes/fonts/text) plus
// per-type elements (system; gantt tasks/lanes/start; pipeline steps; sequence). Kind
// resolution: `vendor:service` -> {vendor, service}; a declared nodetype -> its base +
// icon + style; otherwise a built-in base kind.

import { parseDoc, diagramNode, idOf } from './kdl.js';

/** Positional args of a node (Entry.value.value for unnamed entries). */
function args(node) {
  return node.entries.filter((e) => !e.name).map((e) => e.value.value);
}

/** Properties of a node as a plain object (named entries). */
function props(node) {
  const o = {};
  for (const e of node.entries) if (e.name) o[e.name.name] = e.value.value;
  return o;
}

const childrenOf = (node) => (node.children ? node.children.nodes : []);
const childByName = (node, name) => childrenOf(node).find((c) => c.name.name === name);

function readStyle(node) {
  const s = childByName(node, 'style');
  return s ? props(s) : undefined;
}

function readPos(node) {
  const p = childByName(node, 'pos');
  if (!p) return undefined;
  const { x, y } = props(p);
  return { x, y };
}

/** text children -> { default?, slots: {name: {...}} } (spec §5.7). */
function readText(node) {
  const out = { slots: {} };
  for (const c of childrenOf(node)) {
    if (c.name.name !== 'text') continue;
    const a = args(c);
    const cfg = props(c);
    if (a.length === 0) out.default = cfg; // bare `text <props>` = node default
    else out.slots[a[0]] = { content: a[1], ...cfg }; // `text "slot" "content"? <props>`
  }
  return out.default || Object.keys(out.slots).length ? out : undefined;
}

/** Resolve a node's `kind` against nodetypes + vendor packs. */
function resolveKind(kind, nodetypes, packs) {
  if (kind == null) return { base: undefined };
  if (kind.includes(':')) {
    const r = packs?.resolve(kind);
    if (r) return { base: r.base, icon: r.icon, vendor: r.vendor, service: r.service, kindRef: kind };
    const [vendor, service] = kind.split(':');
    return { vendor, service, kindRef: kind }; // unresolved (pack not loaded)
  }
  const nt = nodetypes[kind];
  if (nt) return { base: nt.base, icon: nt.icon, style: nt.style, via: kind };
  return { base: kind };
}

export function buildModel(textOrDoc, opts = {}) {
  const packs = opts.packs;
  const doc = typeof textOrDoc === 'string' ? parseDoc(textOrDoc) : textOrDoc;
  const errors = [];
  const dn = diagramNode(doc);
  if (!dn) {
    return { errors: [{ message: 'no top-level `diagram` node' }], nodes: [], edges: [] };
  }
  const meta = props(dn);
  if (!meta.type) errors.push({ message: '`diagram` requires a `type`' });

  const m = {
    type: meta.type,
    title: meta.title,
    theme: meta.theme || 'light',
    mode: meta.mode,
    view: meta.view,
    layout: undefined,
    calendar: undefined,
    fonts: {},
    textDefault: undefined,
    nodetypes: {},
    palette: undefined,
    nodes: [],
    edges: [],
    groups: [],
    notes: [],
    lanes: [],
    tasks: [],
    steps: [],
    participants: [],
    messages: [],
    fragments: [],
    start: undefined,
    errors,
    doc,
  };

  // First pass: declarations (fonts, nodetypes, layout, calendar) the rest depend on.
  for (const c of childrenOf(dn)) {
    const name = c.name.name;
    if (name === 'layout') m.layout = props(c);
    else if (name === 'calendar') m.calendar = props(c);
    else if (name === 'fonts') {
      for (const f of childrenOf(c)) {
        const fam = args(f)[0];
        m.fonts[f.name.name] = { family: fam, ...props(f) };
      }
    } else if (name === 'nodetype') {
      m.nodetypes[idOf(c)] = { ...props(c), style: readStyle(c) };
    } else if (name === 'text' && args(c).length === 0) {
      m.textDefault = props(c);
    } else if (name === 'palette') {
      m.palette = {
        name: args(c)[0], outline: props(c).outline,
        colors: childrenOf(c).filter((x) => x.name.name === 'color').map((x) => args(x)[0]),
      };
    }
  }

  // Second pass: elements.
  for (const c of childrenOf(dn)) {
    const name = c.name.name;
    const a = args(c);
    const p = props(c);
    switch (name) {
      case 'node':
      case 'step': {
        const members = (kindName) => childrenOf(c)
          .filter((x) => x.name.name === kindName)
          .map((x) => ({ name: args(x)[0], ...props(x) }));
        const attrs = members('attr');
        const methods = members('method');
        const el = {
          id: a[0], label: p.label, kind: p.kind, group: p.group, stereotype: p.stereotype,
          ...resolveKind(p.kind, m.nodetypes, packs),
          style: readStyle(c), pos: readPos(c), text: readText(c), props: p,
          attrs: attrs.length ? attrs : undefined,
          methods: methods.length ? methods : undefined,
        };
        const iconNode = childByName(c, 'icon');
        if (iconNode) el.iconSpec = { name: args(iconNode)[0], ...props(iconNode) }; // { name?, src?, pos?, scale? }
        (name === 'step' ? m.steps : m.nodes).push(el);
        break;
      }
      case 'edge':
        m.edges.push({
          from: a[0], to: a[1], kind: p.kind, label: p.label, dir: p.dir,
          rel: p.rel, line: p.line, fromEnd: p['from-end'], toEnd: p['to-end'],
          fromCard: p['from-card'], toCard: p['to-card'], glyph: p.glyph,
          trigger: p.trigger, guard: p.guard, action: p.action,
        });
        break;
      case 'group':
        m.groups.push({
          id: a[0], label: p.label, kind: p.kind,
          members: childrenOf(c).filter((x) => x.name.name === 'member').map((x) => args(x)[0]),
        });
        break;
      case 'note':
        m.notes.push({ text: a[0], attach: p.attach, pos: readPos(c) });
        break;
      case 'lane':
        m.lanes.push({ id: a[0], label: p.label });
        break;
      case 'start':
        m.start = { id: a[0] || 'start', label: p.label || 'Start' };
        break;
      case 'task': {
        const depsNode = childByName(c, 'deps');
        const descNode = childByName(c, 'desc');
        m.tasks.push({
          id: a[0], title: p.title, cost: p.cost, lane: p.lane, start: p.start,
          ticket: p.ticket, ticketUrl: p['ticket-url'],
          desc: descNode ? args(descNode)[0] : undefined,
          deps: depsNode ? args(depsNode) : [],
        });
        break;
      }
      default:
        break;
    }
  }

  if (m.type === 'sequence') buildSequence(dn, m);
  validate(m);
  return m;
}

// Sequence: document order IS time. Walk in order, giving each message a row index;
// fragments record the row range they span and their branch boundaries (spec §5.2).
function buildSequence(dn, m) {
  const pushMsg = (c) => {
    const a = args(c), p = props(c);
    m.messages.push({ from: a[0], to: a[1], kind: p.kind, label: p.label, row: m.messages.length });
  };
  const visit = (nodes) => {
    for (const c of nodes) {
      const nm = c.name.name;
      if (nm === 'participant') m.participants.push({ id: args(c)[0], ...props(c) });
      else if (nm === 'message') pushMsg(c);
      else if (nm === 'fragment') {
        const start = m.messages.length;
        const branches = [];
        for (const b of childrenOf(c)) {
          if (b.name.name === 'branch') {
            const bs = m.messages.length;
            visit(childrenOf(b));
            branches.push({ label: props(b).label, range: [bs, m.messages.length] });
          } else if (b.name.name === 'message') pushMsg(b);
        }
        m.fragments.push({ kind: props(c).kind, label: props(c).label, range: [start, m.messages.length], branches });
      }
    }
  };
  visit(childrenOf(dn));
}

function validate(m) {
  const e = m.errors;
  if (m.type === 'gantt') {
    const ids = new Set(m.tasks.map((t) => t.id));
    ids.add(m.start ? m.start.id : 'start'); // implicit start always referenceable
    for (const t of m.tasks) {
      if (!t.deps.length) e.push({ id: t.id, message: `task "${t.id}" needs >= 1 dependency` });
      for (const d of t.deps)
        if (!ids.has(d)) e.push({ id: t.id, message: `task "${t.id}" depends on unknown "${d}"` });
      if (t.cost == null) e.push({ id: t.id, message: `task "${t.id}" missing cost` });
    }
  }
  if (m.type === 'system') {
    const ids = new Set([...m.nodes, ...m.groups].map((x) => x.id));
    for (const ed of m.edges) {
      if (!ids.has(ed.from)) e.push({ message: `edge from unknown "${ed.from}"` });
      if (!ids.has(ed.to)) e.push({ message: `edge to unknown "${ed.to}"` });
    }
  }
}
