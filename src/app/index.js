// diagrama — renderer-core entry (stub).
//
// Public surface of the bundle (`Diagrama.*`). Implementation lands in Phase 1:
// parse (@bgotink/kdl) -> model -> layout (dagre/temporal) -> render (fabric).
// For now these are no-ops so the bundle builds and the embed API shape is fixed.

export const version = '0.0.0';

/** Render every `<div class="diagrama">` paired with a KDL `<script>` block. */
export function renderAll() {
  // TODO(phase-1): query .diagrama containers, parse adjacent KDL, render.
}

/** Load a `.diagrama.kdl` from `url` into the element matched by `selector`. */
export async function load(/* url, selector */) {
  // TODO(phase-1): fetch + parse + render into selector.
}

export default { version, renderAll, load };
