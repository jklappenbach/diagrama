# diagrama — specification (v0.3)

A diagramming system for **UML class, sequence, state, and system-design** diagrams,
authored as a **KDL** document that describes *meaning, not pixels*, auto-laid-out and
drawn with **fabric.js**. One **renderer core** powers several **surfaces**: an
embeddable read-only view, **IDE preview plugins** (the Markdown editor+preview pattern,
in VS Code and IntelliJ), and a **standalone browser editor**. Edits — typing the KDL
*or* dragging a shape — are written back **format-preservingly** and **always saved**
(the file is the source of truth, and it's version-controlled).

> Status: active design. Format (§4–5) and surfaces (§8) are the load-bearing parts.
> Open questions in §10.

## 1. Goals & principles

1. **Text-authorable, semantic — not pixels.** The document describes a *class*, a
   *message*, a *dependency* — never coordinates. The app lays it out and renders it.
2. **One format, four diagram types** — `class`, `sequence`, `state`, `system` — over a
   shared envelope (§4) with per-type vocabularies (§5).
3. **One renderer, several surfaces.** A single **renderer core** (parse → layout →
   draw) is the shared artifact behind every surface (§3, §8). Surfaces differ only in
   *who provides the text editor* and *whether editing writes back*.
4. **Reuse, don't reinvent.** KDL parse + **format-preserving** round-trip is
   `@bgotink/kdl`; the IDE surfaces get their text editor *and* KDL syntax/hints free
   from the host IDE + the official KDL plugins (§2). We build the renderer and the thin
   surface wrappers — not a text editor (except the browser app, §8.4).
5. **Always-save, minimal diffs.** A drag pins a `pos` override; the document is
   re-emitted format-preservingly so the git diff is *only* the change (§8.5).
6. **Embeddable & portable.** A read-only render embeds inline in one self-contained
   `.html` (§8.1).

## 2. Why KDL

The document format is **KDL 2.0**: `name + args + key=value props + { children }`,
**typed values**, comments, and `/-` slashdash to disable an element in place. It beats
JSON (no quote/comma noise, plus comments), XML (typed values, clean nesting), YAML (no
whitespace-fragility — matters for machine write-back), and a DSL like Mermaid/D2 (which
can't round-trip a drag). See the comparison we settled in design discussion.

**Two reuse wins decide it:**
- **`@bgotink/kdl`** (JS, Apache-2.0) does **format-preserving** parse↔stringify —
  comments/order/formatting survive an edit, so a drag yields a minimal diff. (This is
  the "`toml_edit` for KDL" capability; it de-risks the whole write-back story.)
- **Official IDE plugins** — `kdl-org/vscode-kdl` (grammar + LSP) and
  `kdl-org/intellij-kdl` (both Apache-2.0) — mean the **IDE surfaces don't build a text
  editor at all**: the host IDE's editor + these plugins give first-class KDL editing
  for free (§8.2–8.3).

Extension `.diagrama.kdl`; embed MIME `application/diagrama+kdl`.

## 3. Architecture — a renderer core + surfaces

The **renderer core** is the center of gravity; every surface wraps it:

```
                       ┌──────────────── renderer core (diagrama.min.js) ───────────────┐
.diagrama.kdl ──parse──►  model  ──layout──►  laid-out model  ──render──►  fabric canvas │
   (@bgotink/kdl)       │ (normalize+validate)   (dagre/temporal)        (boxes/edges…)  │
                       └────────────────────────────────────────────────────────────────┘
                             ▲ shared by every surface ▼
   embed HTML  ·  VS Code preview  ·  IntelliJ preview  ·  standalone browser editor
```

- **Loader/validator** — `@bgotink/kdl` parses KDL (format-preserving AST) → normalized
  model; validate against the diagrama schema; per-type defaults.
- **Layout** — pluggable: `dagre` (default) / `elk` (orthogonal) for `class`/`state`/
  `system`; a custom **temporal** layout for `sequence`.
- **Renderer** — per-type renderers over shared fabric primitives (boxes, connectors,
  labels, lifelines, notes).

Libraries (OSS): **fabric.js** (canvas + export), **`@bgotink/kdl`** (parse +
format-preserving emit), **dagre** (layout; ELK.js optional). The browser editor adds
**monaco-editor** + the **vscode-kdl** grammar/LSP (§8.4). The IDE surfaces add nothing
to the editor — the IDE provides it.

## 4. Data format — the KDL envelope

A document is a single top-level `diagram` node:

```kdl
diagram type="system" title="Cajeta layers" theme="light" {
    layout engine="dagre" direction="TB" spacing=50      // optional; per-type defaults

    group "g-lib" label="Libraries" kind="boundary" { member "http"; member "cluster" }

    node "http" label="cajeta-http" kind="service" group="g-lib" {
        style fill="#dae8fc" stroke="#446"               // optional per-node style
        pos x=120 y=140                                   // optional — pins position (a drag writes this)
    }

    edge "http" "ionet" kind="dependency" label="uses" dir="to"

    note "DCE drops unused libs" attach="http"
}
```

| Element | Form |
|---|---|
| **diagram** | `diagram type=… title=… theme=…` — the root; `type` required |
| **layout** | `layout engine=… direction=… spacing=…` — optional |
| **node** | `node "id" label=… kind=… group=…` + optional `{ style …; pos x= y=; <type-specific> }` |
| **edge** | `edge "from" "to" kind=… label=… dir=…` + optional `{ waypoints { pt x= y=; … } }` |
| **group** | `group "id" label=… kind=…` + `{ member "id"; … }` (groups nest) |
| **note** | `note "text" attach="id"` + optional `{ pos x= y= }` |

`id` is the first arg; `kind` is type-specific (§5); `pos` (a child) pins a node and is
what a drag writes back (§8.5). Values are typed; `/-` disables an element while authoring.

## 5. Per-type vocabularies

The envelope is shared; each `type` defines its `kind` values and any nested elements.

### 5.1 `class`
- **node.kind**: `class` | `interface` | `enum` | `abstract`; optional `stereotype=`.
- **members** as children: `attr "name" type=… vis="+|-|#|~"`, `method "name" sig=… vis=…`.
- **edge.kind**: `inheritance` | `implementation` | `association` | `aggregation` |
  `composition` | `dependency`; optional `mult-from=` / `mult-to=`.

### 5.2 `sequence`
Document order *is* time; fragments **contain** their messages:
- **participant.kind**: `actor` | `object` | `boundary` | `control` | `entity`.
- **message.kind**: `sync` | `async` | `return` | `create` | `destroy` | `self`.
- **fragment.kind**: `alt` | `opt` | `loop` | `par` | `ref`, with nested `branch` blocks.

### 5.3 `state`
- **node.kind**: `state` | `initial` | `final` | `choice` | `composite` (nests substates).
- **edge.kind**: `transition`, with `trigger=` / `guard=` / `action=`.

### 5.4 `system`
- **node.kind**: `service` | `datastore` | `queue` | `actor` | `external` | `component`.
- **groups** are boundaries / layers / zones (nested allowed).
- **edge.kind**: `dependency` | `dataflow` | `sync` | `async` | `publishes` | `subscribes`.

## 6. Layout

- **Graph types** → dagre by default (`layout.direction` controls flow); ELK.js optional.
- **`sequence`** → temporal layout: participants across the top, messages top-to-bottom
  in document order, activation bars from sync call→return, fragments as labeled frames.
- **Overrides** — a node's `pos` child pins it; an edge's `waypoints` route it; a
  **"re-layout"** action clears `pos` to return to auto-layout.

## 7. Per-type rendering

Each type maps to fabric primitives: `class` → 3-compartment boxes; `sequence` →
lifelines + activations + message arrows + fragment frames; `state` → rounded states +
transitions; `system` → typed shapes + boundary containers. Shared primitives keep the
renderers small.

## 8. Surfaces

All four wrap the **same renderer core**. They differ in who provides the text editor
and whether editing writes back.

### 8.1 Embed (portable, read-only)

The render inlines in one `.html`; KDL lives in a `<script>` block (raw text, parsed in
the browser):

```html
<div class="diagrama"></div>
<script type="application/diagrama+kdl"> diagram type="system" { … } </script>
<script src="diagrama.min.js"></script>   <!-- inline for a single self-contained file -->
<script>Diagrama.renderAll();</script>
```
Renderer-only (no Monaco) → small. Also `Diagrama.load(url, "#el")`, `?src=`, drag-drop.

### 8.2 VS Code plugin (Markdown editor+preview pattern)

**The IDE provides the text editor** (with KDL grammar/LSP from `vscode-kdl`); diagrama
adds a **preview webview** running the renderer core, opened side-by-side, refreshing on
edit — exactly like the built-in Markdown preview. A thin extension; no editor to build.

- **Edit-in-place (upgrade):** swap the read-only preview for a `CustomTextEditorProvider`
  (the draw.io-extension pattern) — the webview posts a drag back to the document, written
  format-preservingly via `@bgotink/kdl`. Same persist mechanism, hosted in VS Code.

### 8.3 IntelliJ plugin (editor+preview split)

A `FileEditorProvider` for `*.diagrama.kdl` returning a **[ text editor | JCEF preview ]**
split (the built-in Markdown plugin's shape). The text half gets KDL support from
`intellij-kdl`; the JCEF (Chromium) half runs the renderer core. Edit-in-place = the JCEF
panel posting drags back to the PSI/document (the §8.5 write-back).

### 8.4 Standalone browser editor (the only surface where text is on us)

No host IDE, so **we build a first-class text experience**: **Monaco** + the `vscode-kdl`
TextMate grammar + (optionally) the KDL LSP in a web worker, beside the fabric canvas,
with **two-way sync** (edit text → re-render; drag → write `pos` back). This is the
heaviest surface; it justifies Monaco's size, which the embed/IDE surfaces avoid.

### 8.5 Persistence — "always save" (editing surfaces)

Every change — text edit or drag — is serialized and saved immediately (debounced
~250 ms). No save button, no dirty flag.
- **Format-preserving write-back** via `@bgotink/kdl`: a drag appends/updates only a
  node's `pos` child, so the git diff is minimal and comments/order survive.
- **Save targets:** the host document (IDE surfaces); a local `diagrama serve` endpoint
  (`PUT /<file>`) or the File System Access API (browser app). The portable embed has no
  save target (read-only).

## 9. Project structure (monorepo)

```
diagrama/
  packages/
    core/        — parse (@bgotink/kdl), model, layout, render (fabric) → diagrama.min.js
    web/         — standalone browser editor (Monaco + core + two-way sync + serve)
    vscode/      — VS Code preview/custom-editor extension (wraps core)
    intellij/    — IntelliJ FileEditorProvider plugin (JCEF wraps core)
  examples/      — sample .diagrama.kdl (dogfood: cajeta diagrams)
  vendor/        — bundled vscode-kdl grammar (Apache-2.0, attributed)
  docs/spec.md   — this file
```

## 10. Open questions

1. **First surface to ship** — VS Code preview (cheapest, reuses IDE editor) vs the
   standalone browser app. Lean: renderer core → VS Code preview.
2. **`@bgotink/kdl` write-back fidelity** — verify comment/slashdash/order preservation
   across a drag round-trip early (the de-risk spike).
3. **LSP in-browser** — bundle the vscode-kdl LSP (web worker) for the browser app, or
   rely on the app's validator? Lean: validator first, LSP fast-follow.
4. **diagrama KDL schema** — ship a KDL Schema so editor/LSP can autocomplete node/edge
   kinds. Lean: yes, soon.
5. **Edit-in-place ordering** — read-only previews first; custom-editor/JCEF write-back
   as an upgrade per surface.
6. **Layout default** — dagre (small) vs ELK.js (better routing). Lean: dagre default.
