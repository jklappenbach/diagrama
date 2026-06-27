// Vendor/icon pack loader (spec §5.5). Parses packs/<vendor>.kdl manifests and resolves
// a `vendor:service` kind to its base family + icon path. Generic-by-design: the same
// resolver serves aws/gcp/azure/cf/ci and any future pack.

import { parseDoc } from './kdl.js';

const args = (n) => n.entries.filter((e) => !e.name).map((e) => e.value.value);
const props = (n) => {
  const o = {};
  for (const e of n.entries) if (e.name) o[e.name.name] = e.value.value;
  return o;
};

/** Parse one pack manifest -> { name, label, iconbase, map: {service: {base, icon}} }. */
export function parsePack(text) {
  const doc = parseDoc(text);
  const pk = doc.nodes.find((n) => n.name.name === 'pack');
  if (!pk) throw new Error('pack manifest has no `pack` node');
  const p = props(pk);
  const iconbase = p.iconbase || '';
  const map = {};
  for (const c of pk.children ? pk.children.nodes : []) {
    if (c.name.name !== 'map') continue;
    const cp = props(c);
    map[args(c)[0]] = { base: cp.base, icon: cp.icon ? iconbase + cp.icon : undefined };
  }
  return { name: args(pk)[0], label: p.label, iconbase, map };
}

/** A registry of packs; resolves `vendor:service` kinds. */
export class Packs {
  constructor() { this.byName = {}; }
  add(pack) { this.byName[pack.name] = pack; return this; }
  addText(text) { return this.add(parsePack(text)); }
  /** -> { vendor, service, base, icon } or null if unknown. */
  resolve(kind) {
    if (!kind || !kind.includes(':')) return null;
    const [vendor, service] = kind.split(':');
    const entry = this.byName[vendor]?.map[service];
    if (!entry) return null;
    return { vendor, service, base: entry.base, icon: entry.icon };
  }
}
