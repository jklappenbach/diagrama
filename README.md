# diagrama

A **diagramming system for software development** — software and systems architecture,
production and delivery management — authored as a **KDL** document, laid out automatically, and drawn on canvas with
[fabric.js](http://fabricjs.com/). The document describes *meaning*, not pixels, so
diagrams are diffable and hand/AI-authorable. One **renderer core** drives several
**surfaces** — an embeddable read-only view, **Markdown-style preview plugins** for VS
Code and IntelliJ, and a **standalone browser editor** — and edits (typing the KDL *or*
dragging a shape) are written back **format-preservingly** and **always saved**.

> **Status: active design.** Format + architecture in [`docs/spec.md`](docs/spec.md)
> (v0.9); build map in [`plan/diagrama-plan.md`](plan/diagrama-plan.md). Implementation starting.

## Why

Text-in, diagram-out, no pixel-fiddling: write the semantic model, get a laid-out
diagram. Drag to nudge and it's persisted back to the (version-controlled) file. Built
to be authored by tooling (and by hand).

## Format at a glance — KDL

```kdl
diagram type="system" title="Example" {
    node "a" label="Service A" kind="service"
    node "b" label="Datastore" kind="datastore"
    edge "a" "b" kind="dependency" label="reads"
}
```

See [`examples/`](examples/) for full system / sequence samples. (Format rationale —
KDL over JSON/XML/YAML — in [`docs/spec.md`](docs/spec.md) §2.)

## Embed (portable)

```html
<div class="diagrama"></div>
<script type="application/diagrama+kdl"> diagram type="system" { … } </script>
<script src="diagrama.min.js"></script>
<script>Diagrama.renderAll();</script>
```

Inline `diagrama.min.js` and you have one self-contained `.html`.

## Stack

**Renderer core**: fabric.js (canvas/render/export) · [`@bgotink/kdl`](https://github.com/bgotink/kdl)
(format-preserving KDL parse/emit) · dagre (layout; ELK.js optional). **Browser-editor
surface** adds Monaco + the official Apache-2.0 [`kdl-org/vscode-kdl`](https://github.com/kdl-org/vscode-kdl)
grammar/LSP. **IDE surfaces** reuse the host editor + the official KDL plugins (no editor
built). Bundled to `diagrama.min.js`; the portable embed is renderer-only. OSS, client-only.

## Develop

```sh
npm install
npm test            # vitest: round-trip, model, scheduler, layout (16 cases)
npm run bundle      # esbuild -> dist/diagrama.min.js
npx vite examples   # serve, then open examples/preview.html to see the renderer
```

Core lives in `src/core/` (`kdl` write-back · `model` · `layout` · `schedule` ·
`render`); the embed entry is `src/app/index.js`. Build map in
[`plan/diagrama-plan.md`](plan/diagrama-plan.md).

## License

MIT (TBD).
