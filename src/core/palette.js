// Color palettes for gantt task coloring (spec §5.9). We need at most as many colors
// as concurrent tasks (== max lane overlap), so a small palette suffices; overlapping
// tasks are greedily given different colors so each reads uniquely in its time slot,
// and a task's dependency can be traced by matching its left swatch to a body color.

export const PALETTES = {
  earth:  ['#a9836b', '#7d9b6a', '#c2a878', '#8a6d5a', '#9aa873', '#b0875a', '#6f8b7d', '#94785c'],
  pastel: ['#9ec5e8', '#f6b8b8', '#bfe3c0', '#ffd9a8', '#cdb8e8', '#f6c2dc', '#a9ddd6', '#f2e09a'],
  neon:   ['#3df27a', '#ff5d6c', '#33d6ff', '#ff6fd6', '#ffe14d', '#ff9f43', '#b06bff', '#2bffd6'],
};

/** Resolve the palette for a model: user-defined colors > named built-in > default. */
export function resolvePalette(model) {
  const p = model.palette;
  if (p?.colors?.length) return p.colors;
  return PALETTES[p?.name] || PALETTES.pastel;
}

/**
 * Greedy interval coloring: tasks whose [es, ef) overlap get different colors. Sets
 * `bar.color` / `bar.colorIdx` in place and returns the bars.
 */
export function colorBars(bars, palette) {
  const active = []; // { ef, colorIdx } currently-running
  for (const bar of [...bars].sort((a, b) => a.es - b.es)) {
    for (let i = active.length - 1; i >= 0; i--) if (active[i].ef <= bar.es) active.splice(i, 1);
    const used = new Set(active.map((a) => a.colorIdx));
    let idx = 0;
    while (used.has(idx)) idx++;
    bar.colorIdx = idx;
    bar.color = palette[idx % palette.length];
    active.push({ ef: bar.ef, colorIdx: idx });
  }
  return bars;
}
