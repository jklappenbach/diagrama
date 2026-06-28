// Color palettes for gantt task coloring (spec §5.9). Each palette is 8 colors as TWO
// complementary halves (warm / cool). Tasks alternate halves by dependency depth, so a
// parent and child get complementary colors; within a half, overlapping tasks are
// greedily given different colors so each still reads uniquely in its time slot.

export const PALETTES = {
  //         ── group A (warm) ──                  ── group B (cool, complementary) ──
  earth:  ['#b5835a', '#c98a3b', '#a86a4a', '#d1a05f', '#5a7d6b', '#4a7a86', '#6b8e57', '#5f7d9c'],
  pastel: ['#f6c2a8', '#f6b8c2', '#f2e09a', '#f6b8b8', '#a8cde8', '#bfe3d0', '#cdb8e8', '#a9ddd6'],
  neon:   ['#ff5d6c', '#ff9f43', '#ffe14d', '#ff6fd6', '#3df27a', '#2bffd6', '#33d6ff', '#b06bff'],
};

/** Resolve the palette: user-defined colors > named built-in > default (pastel). */
export function resolvePalette(model) {
  const p = model.palette;
  if (p?.colors?.length) return p.colors;
  return PALETTES[p?.name] || PALETTES.pastel;
}

/**
 * Color tasks from two complementary palette halves, picked by `bar.parity`
 * (dependency-depth parity) so parent/child alternate halves. Within each half,
 * greedy interval coloring keeps overlapping tasks distinct. Sets `bar.color` in place.
 */
export function colorBars(bars, palette) {
  const half = Math.max(1, Math.ceil(palette.length / 2));
  const a = palette.slice(0, half);
  const bRaw = palette.slice(half);
  const groups = [a, bRaw.length ? bRaw : a];
  for (const parity of [0, 1]) {
    const group = groups[parity];
    const active = []; // { ef, idx } currently-running in this half
    for (const bar of bars.filter((x) => (x.parity || 0) === parity).sort((x, y) => x.es - y.es)) {
      for (let i = active.length - 1; i >= 0; i--) if (active[i].ef <= bar.es) active.splice(i, 1);
      const used = new Set(active.map((x) => x.idx));
      let idx = 0;
      while (used.has(idx)) idx++;
      bar.colorIdx = idx;
      bar.color = group[idx % group.length];
      active.push({ ef: bar.ef, idx });
    }
  }
  return bars;
}
