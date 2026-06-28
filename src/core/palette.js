// Color palettes for gantt task coloring (spec §5.9). Each palette is 10 colors as TWO
// complementary halves of 5 (warm / cool). Tasks alternate halves task-by-task down the
// dependency chain (parent and child are complementary), and cycle through the colors
// WITHIN a half so consecutive tasks vary; overlapping same-half tasks never collide.

export const PALETTES = {
  //         ──────────── group A (warm), 5 ────────────         ──────────── group B (cool, complementary), 5 ────────────
  earth:  ['#b5835a', '#c98a3b', '#a86a4a', '#d1a05f', '#9c6f3f', '#5a7d6b', '#4a7a86', '#6b8e57', '#5f7d9c', '#4f6b78'],
  pastel: ['#f6c2a8', '#f6b8c2', '#f2e09a', '#f6b8b8', '#f0cdb0', '#a8cde8', '#bfe3d0', '#cdb8e8', '#a9ddd6', '#b8c8ee'],
  neon:   ['#ff5d6c', '#ff9f43', '#ffe14d', '#ff6fd6', '#ff7849', '#3df27a', '#2bffd6', '#33d6ff', '#b06bff', '#4d8bff'],
};

/** Resolve the palette: user-defined colors > named built-in > default (pastel). */
export function resolvePalette(model) {
  const p = model.palette;
  if (p?.colors?.length) return p.colors;
  return PALETTES[p?.name] || PALETTES.pastel;
}

/**
 * Color tasks from two complementary palette halves picked by `bar.parity`
 * (dependency-depth parity → parent/child alternate halves). Within a half, colors are
 * assigned round-robin (so consecutive tasks differ) while skipping any color currently
 * in use by an overlapping task. Sets `bar.color` in place.
 */
export function colorBars(bars, palette) {
  const half = Math.max(1, Math.ceil(palette.length / 2));
  const a = palette.slice(0, half);
  const bRaw = palette.slice(half);
  const groups = [a, bRaw.length ? bRaw : a];
  for (const parity of [0, 1]) {
    const group = groups[parity];
    const active = []; // { ef, idx } currently-running in this half
    let counter = 0;
    for (const bar of bars.filter((x) => (x.parity || 0) === parity).sort((x, y) => x.es - y.es)) {
      for (let i = active.length - 1; i >= 0; i--) if (active[i].ef <= bar.es) active.splice(i, 1);
      const used = new Set(active.map((x) => x.idx));
      let idx = counter % group.length;
      for (let g = 0; used.has(idx) && g < group.length; g++) idx = (idx + 1) % group.length;
      bar.colorIdx = idx;
      bar.color = group[idx];
      active.push({ ef: bar.ef, idx });
      counter++;
    }
  }
  return bars;
}
