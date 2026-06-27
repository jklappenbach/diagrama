# diagrama — implementation plan

Derived from [`docs/spec.md`](../docs/spec.md) (v0.9). This is the build map: phases,
deliverables, and acceptance criteria. Checked items are done; the rest are ordered
by dependency.

## Progress

**Landed + tested (25 vitest cases, green in CI; bundle 410 KB):**
- ✅ **1a** round-trip write-back (`kdl.js`) — byte-exact emit; `setPos` minimal diff;
  comments/slashdash survive. *De-risk complete.*
- ✅ **1b** model + validation (`model.js`) — clean on all examples; class members.
- ✅ **1c** dagre layout (`layout.js`) — finite coords; class box sizing.
- ✅ **1d** fabric renderer (`render.js`) — **runtime-verified headlessly** (jsdom +
  stubbed ctx): family shapes (cylinder/pill/channel/box), edge decoration (ends,
  rel=owns/refs, cardinality, glyphs), UML class compartments, gantt bars.
- ✅ **1f** vendor-pack resolution (`packs.js`) — `vendor:service` → base+icon, all 5
  packs. *(SVG icon assets themselves = Phase 7.)*
- ✅ **1g** canvas nav — wheel + Ctrl+arrow zoom, background-drag pan, scroll container.
- ✅ **1h** embed API (`app/index.js`) — `renderAll`/`renderKdl`/`load`.
- ✅ **gantt scheduler** (`schedule.js`, Phase 3) — earliest-start, critical path,
  total duration, weekend-skipping dates, cycle detection.
- ✅ **persist hook** (Phase 2 core) — drag → `object:modified` → minimal KDL diff,
  verified end-to-end. *(Save *targets* per surface still to come.)*
- ✅ **all six types render**: system, gantt, class, state, sequence (temporal),
  pipeline (graph path). 28 tests green.

**Next:** 1e fonts (FontFace load + real text measurement); SVG icon assets (Phase 7
generation); then **Phase 4 IntelliJ surface** (JCEF preview over the core bundle).
Open `examples/preview.html` (served) to eyeball it.

## North star

One **renderer core** (`parse → load fonts → measure → schedule/layout → render`)
behind several **surfaces** (embed, VS Code, IntelliJ, browser). Author semantics in
**KDL**; the tool computes the picture; edits (text or drag) write back
**format-preservingly** and **always save** (spec §3, §8).

## Build order (critical path)

```
Phase 0  repo + CI ✓
Phase 1  renderer core, proven end-to-end on ONE type (system)
Phase 2  persistence / always-save write-back
Phase 3  remaining types (sequence · class · state · pipeline · gantt)
Phase 4  IntelliJ plugin (JCEF)  ── first real surface (your daily IDE)
Phase 5  standalone browser editor (Monaco + serve)
Phase 6  VS Code preview
Phase 7  vendor-pack generation + SVG pipeline (full catalogs)
Phase 8  KDL schema + LSP polish
```

Rationale: prove the whole pipeline on the richest vocabulary (`system`, which has
examples) before fanning out to types or surfaces. **IntelliJ first** — it's the daily
IDE here, and (like VS Code) it reuses the host editor + the official `intellij-kdl`
plugin, so we ship only the preview, not a text editor (spec §8.3, §10 Q1).

---

## Phase 1 — renderer core (`packages/core`)

Goal: `examples/system-*.diagrama.kdl` renders to a fabric canvas in a browser test
page, and the portable embed API works. Establishes every core subsystem.

### 1a. Round-trip spike (de-risk — do first) — spec §2, §8.5
- [ ] `@bgotink/kdl`: parse a `.diagrama.kdl`, mutate one node's `pos`, re-emit.
- [ ] Assert the diff is **minimal** and **comments / order / slashdash survive**.
- [ ] Decide the write helper API (`setPos(doc, id, x, y)`), document fidelity limits.
- **Accept:** a test proves a drag-equivalent edit yields a one-line diff.

### 1b. Model + validation — spec §4, §5
- [ ] Parse KDL AST → normalized model (`diagram`, `node`, `edge`, `group`, `note`,
      `nodetype`, `fonts`, `text`, + per-type elements `participant`/`message`/
      `fragment`/`task`/`lane`/`step`/`start`).
- [ ] Resolve `nodetype` and `vendor:service` kinds → base family + icon (§5.5).
- [ ] Validate against per-type schema; apply per-type defaults; clear error model.
- **Accept:** every file in `examples/` parses + validates; bad input gives a located error.

### 1c. Layout abstraction — spec §6
- [ ] Pluggable engine interface; **dagre** default; per-type dispatch.
- [ ] Node sizing fed from text measurement (§1e) before layout runs.
- **Accept:** `system` example produces stable, sensible coordinates.

### 1d. Fabric primitives + `system` renderer — spec §7
- [ ] Shared primitives: box, cylinder, pill, channel, group container, connector,
      label, note.
- [ ] Edge decoration (§5.6): ends (`arrow/open/diamond/…`), line styles, cardinality
      labels, inline glyphs, `rel=owns/aggregates/refs`.
- [ ] `system` renderer: families (compute/storage/messaging/network) + group kinds
      (zone/process/cluster/workflow/network) with border line styles.
- **Accept:** `system-stores-icons` renders with correct shapes, edges, groups.

### 1e. Text & typography — spec §5.7
- [ ] Keyed `fonts` map; built-ins `sys/sans/serif/mono`; load via FontFace.
- [ ] **Load-before-measure** ordering; auto-size; `wrap`/`maxlines`; slots
      (`title/subtitle/caption`, class compartments).
- **Accept:** a node with a `subtitle` slot + custom font renders at correct size.

### 1f. Icons + vendor pack resolution — spec §5.5
- [ ] Icon registry (generic set); SVG load; placement anchors (`tl/tr/bl/br/center`),
      scale relative to shape.
- [ ] Pack loader for `packs/*.kdl`; `vendor:service` → base + icon.
- **Accept:** `kind="aws:lambda"` draws a function shape with the Lambda icon badge.

### 1g. Canvas & navigation — spec §7.1
- [ ] Scrollbars + pan; wheel + **Ctrl+↑/↓** zoom about cursor; fit-to-window / 100%.
- **Accept:** an oversized diagram scrolls and zooms smoothly.

### 1h. Embed bundle + API — spec §8.1
- [ ] `Diagrama.renderAll()` / `load(url, sel)` over `<script type="application/diagrama+kdl">`.
- [ ] esbuild IIFE bundle (already wired); renderer-only (no Monaco) stays small.
- **Accept:** a single self-contained `.html` renders the `system` example offline.

---

## Phase 2 — persistence / always-save — spec §8.5
- [ ] Drag → `pos` write-back via the §1a helper (debounced ~250 ms, no dirty flag).
- [ ] Re-layout action clears `pos`.
- [ ] Save targets abstraction (host doc | `diagrama serve` PUT | File System Access).
- **Accept:** dragging a node persists a minimal diff; reload restores positions.

---

## Phase 3 — remaining renderers (`packages/core`)
One slice per type; each reuses primitives + layout + text.
- [ ] `sequence` — temporal layout: lifelines, activations, message arrows, fragments.
- [ ] `class` — 3-compartment boxes; members formatted from fields; UML edges.
- [ ] `state` — rounded states, initial/final/choice/composite, transition labels.
- [ ] `pipeline` — step shapes by role, icon by action; outcome-routed edges; stages.
- [ ] `gantt` — **scheduler engine** (topological order + earliest-start over
      `cost`/`deps`, critical-path highlight, total duration) + `timeless`/`calendar`
      modes, dynamic lanes, star `start` root, calendar header.
- **Accept:** every `examples/*` of each type renders; the gantt example schedules
  correctly (integ starts after api+ui+infra; critical path highlighted).

> Note: the gantt **scheduler** is the one genuinely novel algorithm — build and unit-test
> it standalone (deps graph → schedule) before wiring to the renderer.

---

## Phase 4 — IntelliJ plugin (`packages/intellij`) — spec §8.3  ── first surface
- [ ] `FileEditorProvider` for `*.diagrama.kdl` → [ text | JCEF preview ] split (the
      built-in Markdown plugin's shape).
- [ ] JCEF (Chromium) runs the core; the text half gets KDL grammar/hints from the
      official `intellij-kdl` plugin (no editor built).
- [ ] Refresh the preview on document change; map JCEF resource loading to the core bundle.
- [ ] Upgrade: edit-in-place — JCEF posts drags back to the PSI/document (Phase 2 write-back).
- **Accept:** open a `.diagrama.kdl`, get the split editor with live preview; (upgrade)
  a drag in the preview persists a minimal diff to the document.

> Packaging note: ship as a JetBrains plugin (works across IDEA / CLion / PyCharm —
> matches the C++/Python/JVM mix here). JCEF ships with the JetBrains runtime.

## Phase 5 — standalone browser editor (`packages/web`) — spec §8.4
- [ ] Monaco + `vscode-kdl` TextMate grammar; two-way sync (edit↔render; drag→pos).
- [ ] `diagrama serve` (local `PUT /<file>`) and/or File System Access API.
- **Accept:** edit text → re-render; drag → file saved; round-trips cleanly.

## Phase 6 — VS Code preview (`packages/vscode`) — spec §8.2  (later)
- [ ] Extension: preview webview running the core, side-by-side, refresh on edit (MD pattern).
- [ ] Reuse `vscode-kdl` for editor grammar/LSP (bundled/attributed in `vendor/`).
- [ ] Upgrade: `CustomTextEditorProvider` posting drags back (Phase 2 write-back).
- **Accept:** open a `.diagrama.kdl`, see live preview; (upgrade) drag persists to doc.

## Phase 7 — vendor packs + SVG pipeline (`packs/`) — spec §5.5, `packs/README.md`
- [ ] Build script: ingest each vendor's official icon library → full `map` rows + SVGs.
- [ ] **SVG-first**: convert bitmap-only marks to SVG; attribute per usage terms.
- [ ] Complete `aws/gcp/azure/cf/ci` from seed → full catalog.
- **Accept:** the common services across all five packs resolve to real SVG icons.

## Phase 8 — KDL schema + LSP polish — spec §10 Q3/Q4
- [ ] Ship a KDL Schema so editors autocomplete node/edge/step/task kinds.
- [ ] Optional: bundle the KDL LSP in a web worker for the browser app.

---

## Cross-cutting
- **Testing**: unit (model, scheduler, write-back fidelity) + golden-render snapshots
  per example. Wire into CI alongside the existing build+bundle job.
- **Dogfood**: keep `examples/` authoritative — every type has a real example; render
  them in CI to catch regressions.
- **Monorepo**: stand up `packages/{core,web,vscode,intellij}` (currently a single
  root package) at the start of Phase 1; `core` is the dependency of every surface.

## Open decisions (track from spec §10)
- [ ] First type on screen: **system** (proposed) — confirm.
- [ ] Layout default dagre vs ELK for routing quality (lean dagre).
- [ ] gantt mode names `timeless`/`calendar`; `cost` unit days@0.5 — confirm (or hours).
- [ ] In-browser LSP now vs validator-first (lean validator-first).
- [ ] Edit-in-place ordering per surface (read-only preview first, write-back upgrade).
