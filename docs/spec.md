# diagrama — specification (v0.8)

A **diagramming system for software development** — software and systems architecture,
production and delivery management — authored as a **KDL** document that describes
*meaning, not pixels*, auto-laid-out and drawn with **fabric.js**. One **renderer core** powers several **surfaces**: an
embeddable read-only view, **IDE preview plugins** (the Markdown editor+preview pattern,
in VS Code and IntelliJ), and a **standalone browser editor**. Edits — typing the KDL
*or* dragging a shape — are written back **format-preservingly** and **always saved**
(the file is the source of truth, and it's version-controlled).

> Status: active design. Format (§4–5) and surfaces (§8) are the load-bearing parts.
> Open questions in §10.

## 1. Goals & principles

1. **Text-authorable, semantic — not pixels.** The document describes a *class*, a
   *message*, a *dependency* — never coordinates. The app lays it out and renders it.
2. **One format, multiple diagram types** — `class`, `sequence`, `state`, `system`,
   `pipeline` (CI/CD), `gantt` (scheduling) — over a shared envelope (§4) with per-type
   vocabularies (§5).
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
| **fonts** | `fonts { key "Family" src=… weight=… ; … }` — keyed font map (§5.7) |
| **text** | `text font="key" size=… color=… align=… wrap=… maxlines=…` — doc default, or `text "slot" "content"?` per block on a node (§5.7) |
| **nodetype** | `nodetype "name" base=… icon=…` + optional `{ style … }` — a reusable `kind` (§5.5) |
| **node** | `node "id" label=… kind=… group=…` + optional `{ style …; icon …; pos x= y=; <type-specific> }` |
| **edge** | `edge "from" "to" kind=… label=… dir=…` + decoration (`rel= line= from-end= to-end= from-card= to-card= glyph=`, §5.6) + optional `{ waypoints { pt x= y=; … } }` |
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
  `composition` | `dependency`. Ends follow from the kind; cardinality via
  `from-card=` / `to-card=` and other decoration are shared with `system` (§5.6).

### 5.2 `sequence`
Document order *is* time; fragments **contain** their messages:
- **participant.kind**: `actor` | `object` | `boundary` | `control` | `entity`.
- **message.kind**: `sync` | `async` | `return` | `create` | `destroy` | `self`.
- **fragment.kind**: `alt` | `opt` | `loop` | `par` | `ref`, with nested `branch` blocks.

### 5.3 `state`
- **node.kind**: `state` | `initial` | `final` | `choice` | `composite` (nests substates).
- **edge.kind**: `transition`, with `trigger=` / `guard=` / `action=`.

### 5.4 `system`

A node's **shape** comes from a *family*; its **icon** picks the specific tech/role
(§5.5). Topic and Queue share one shape, differing only by icon.

| family | base shape | `kind` values (each a distinct icon) |
|---|---|---|
| **compute** | rectangle | `service` · `component` · `actor` · `external` · `gateway` · `function` · `container` · `vm` |
| **storage** | cylinder | `sql` · `kv` · `blob` · `cache` (start); extensible: `timeseries` · `graph` · `search` |
| **messaging** | channel | `queue` · `topic` (same shape; FIFO-stack vs. fan-out icon) |
| **network** | pill | `lb` · `cdn` · `dns` · `firewall` · `waf` · `proxy` · `vpn` · `nat` · `router` · `mesh` · `endpoint` |

**Runtime substrate** — `function` (serverless / FaaS: Lambda, Cloud Functions),
`container` (managed containers: Fargate, Cloud Run), `vm` (unmanaged instances:
EC2, GCE) — denote *how* compute is hosted (distinct icons signal the management
level); `service` / `component` stay deployment-agnostic.

`cache` is a normal cylinder with a **bolt icon** (in-memory cue) — no special shape.
`datastore` remains a legacy alias for a generic (un-iconed) cylinder.

**Groups** carry a `kind` that sets a corner icon *and* a border line style:

| `group.kind` | icon | border |
|---|---|---|
| `boundary` (generic) | none | thin solid |
| `zone` | region | solid |
| `process` | gear | dashed |
| `cluster` | stacked nodes | dotted |
| `workflow` (distributed) | branch/flow | dash-dot |
| `network` (VPC / VNet / subnet) | cloud-boundary | dashed |

**Edges** — `kind` sets a preset (line + ends + glyph), all overridable via §5.6:

| `edge.kind` | line | to-end | glyph |
|---|---|---|---|
| `dependency` | dashed | open | — |
| `dataflow` | solid | arrow | — |
| `sync` | solid | arrow | — |
| `async` | dashed | open | clock |
| `publishes` | solid | arrow | bolt |
| `subscribes` | solid | open | — |

### 5.5 Icons & reusable node types

An **icon** is an SVG drawn on a node, defaulting to a **top-left corner badge**
(`pos="tl"`) so it never lands on an edge attach point (the perimeter midpoints),
and scaled to the shape (`scale=0.35` = 35% of the short side).

```kdl
node "scorer" label="Scorer" kind="service" {
    icon "ml"                                       // built-in registry name
    // icon src="./icons/ml.svg" pos="tr" scale=0.4 // custom SVG + overrides
}
```

- **Anchor** (`pos=`): `tl` (default) · `tr` · `bl` · `br` · `center` (watermark).
- **Source**: a built-in registry name, or `src=` (file / URL / inline SVG). Icons
  are **SVG everywhere**; bitmap-only sources are converted to SVG at build time
  (§packs), raster kept only when conversion is impossible.
- **Registry**: vendor-neutral generics (`sql kv blob cache queue topic` + the
  compute set) **and a bundled vendor pack** (`redis postgres mysql dynamo s3 gcs
  kafka sqs lambda fargate ec2`, extensible). Generics are the default; vendors are
  opt-in by name.

**Reusable node type** — bundle base shape + icon + style under a name, then use it
as a `kind`:

```kdl
nodetype "redis" base="cache" icon="redis" { style fill="#ffe0e0" stroke="#a00" }
nodetype "pg"    base="sql"   icon="postgres"

node "sessions" label="Session cache" kind="redis"
node "orders"   label="Orders DB"     kind="pg"
```

Built-in kinds are just predefined nodetypes, so vendor/cloud icon packs drop in.

**Vendor packs.** Major-cloud catalogs ship as namespaced packs — `aws`, `gcp`,
`azure`, `cf` (Cloudflare) — each mapping a service to a **base kind + vendor icon**.
Reference a service directly with a `vendor:service` kind, or wrap it in a
`nodetype`:

```kdl
node "ingest" label="Ingest"  kind="aws:lambda"     // -> base=function, AWS Lambda icon
node "edge"   label="Edge fn" kind="cf:workers"     // -> base=function, Cloudflare Workers icon
node "db"     label="Orders"  kind="gcp:cloudsql"   // -> base=sql, Cloud SQL icon
node "bus"    label="Events"  kind="azure:eventhubs" // -> base=topic, Event Hubs icon
```

A `kind` containing `:` resolves through the named pack's `map` (a `:`-free `kind`
stays a built-in/local nodetype). Packs are data manifests — `packs/<vendor>.kdl`
(§9) — **generated from each vendor's official icon library**, so the *full* service
catalog is covered and stays updatable: AWS Architecture Icons, Google Cloud icons,
Azure Architecture Icons, and Cloudflare's icon set (attributed per their usage
terms). The core bundles a curated subset; full packs load on demand.

### 5.6 Edge decoration (shared by `class` & `system`)

Ends, cardinality and ownership render the same way for class relationships and
system edges. `kind` presets them; the props below override per edge.

- **Ends** (`from-end` / `to-end`): `none · arrow` (filled) `· open` (V) `· dot ·
  o-dot · diamond · filled-diamond · cross`.
- **Line** (`line=`): `solid · dashed · dotted · dashdot`.
- **Cardinality / multiplicity** (`from-card` / `to-card`): `1 · N · * · 0..1 ·
  1..*` → renders `1:N`, `N:M` at the ends.
- **Inline glyph** (`glyph=`): a mid-line badge — `lock` · `bolt` · `clock` ·
  `num:<n>`.
- **Ownership shorthand** (`rel=`): `owns` (filled diamond at owner end) ·
  `aggregates` (hollow diamond) · `refs` (open arrow, no diamond).

```kdl
edge "orders" "sessions" rel="owns" from-card="1" to-card="N"   // 1:N composition
edge "scorer" "orders"   rel="refs" line="dashed"
edge "api"    "orders"   kind="dependency" glyph="lock" to-card="N:M"
```

The `class` relationship kinds (§5.1) map onto these ends automatically
(`composition`→filled diamond, `aggregation`→hollow diamond, `inheritance`→hollow
triangle…); `rel=` is the system-side spelling of the same machinery.

### 5.7 Text & typography

Text is a layout *input*, not decoration: a label's measured size sets its node's
size, which dagre needs up front. The core orders this explicitly —

```
parse → load fonts → measure labels → size nodes → layout (dagre) → render
```

**Source.** All text is KDL string values, so the parser handles the hard cases —
embedded quotes, multi-line (`"""…"""`), raw strings (`#"…"#`), full UTF-8 — with
no custom escaping:

```kdl
note """
Multi-line, "quoted", & symbolic — no escaping needed.
""" attach="x"
```

Labels are **plain text** (no Markdown/HTML) — safe for the portable embed, simple
to render. Structured text (class `attr`/`method`, §5.1) is *formatted* from its
fields (`+ name: Type`, monospace), never typed as a raw string.

**Sizing — auto-size (default).** A node grows to fit its label + padding, down to a
per-kind minimum; no clipping. Text **wraps** at `wrap=` px (default ~160);
`maxlines=N` ellipsizes when you want fixed-height boxes. Edge labels get a
background plate for legibility; cardinality sits at the ends (§5.6).

**Typography — document default + per-element override:**

```kdl
diagram type="system" theme="light" {
    text font="sans" size=13 color="#222"                // document default
    node "scorer" label="Scorer" {
        text font="mono" size=12 align="center" wrap=180 maxlines=2
    }
}
```

`text` props: `font` (a font-map key, below) · `size` · `color` · `align` · `wrap`
· `maxlines`.

**Fonts — a keyed map.** A top-level `fonts` block maps **short keys** to families
(open or commercial); text everywhere references a key, so font choices live in one
place and a label stays terse:

```kdl
fonts {
    h "Inter"          src="./fonts/Inter-var.woff2" weight="600"   // titles
    b "Inter"          weight="400"                                  // body (reuses Inter)
    m "JetBrains Mono" src="https://…/JetBrainsMono.woff2"          // code / mono
}

node "orders" label="Orders DB" kind="pg" { text font="h" }
```

- **Reference by key:** `font="h"`. Built-in keys `sys · sans · serif · mono` need
  no declaration.
- **Formats:** `woff2 · woff · ttf · otf` — open families and any commercial font
  *you license and supply*. An entry **with `src=`** loads it; **without `src=`** the
  family is assumed system-installed or already loaded. diagrama ships only open
  defaults and **references** closed fonts, never redistributes them.
- **Load-before-measure:** keyed fonts are awaited (`document.fonts.load`) *before*
  measurement, so metrics — hence layout — are correct.
- **Portability:** the self-contained embed can inline keyed fonts (base64) so one
  `.html` renders identically offline; otherwise `src` is fetched at load.

**Multiple text blocks (slots).** A node can carry more than one text block, each
styled independently. `label=` feeds the `title` slot; add `text "slot" "content"`
children for the rest, each with its own props:

```kdl
node "orders" label="Orders DB" kind="pg" {
    text "title"    font="h" size=14
    text "subtitle" "PostgreSQL 15" font="b" size=11 color="#666"
    text "caption"  "primary store"  font="m" size=10 align="right"
}
```

Standard slots: `title` (from `label=`), `subtitle`, `caption`. A bare `text <props>`
(no slot name) sets the node-wide default that individual slots override. Class
compartments are slots too — `name`, `attrs`, `methods` (§5.1) — so each compartment
takes its own font key.

### 5.8 `pipeline` (CI/CD)

A CI/CD pipeline as a left-to-right flow of **steps** grouped into **stages**, with
explicit success/failure routing and gates. `step` shapes encode the *control role*;
the **icon** encodes the *specific action* (and platform packs supply tool icons, §5.5).

**Steps** — shape by role, icon by action:

| `step.kind` | shape | role |
|---|---|---|
| `trigger` | start pill | what kicks the pipeline (push / PR / schedule / manual / webhook via `on=`) |
| `source` | rounded box | checkout / fetch source |
| `build` · `test` · `scan` · `package` · `deploy` · `release` · `job` | rounded box (distinct icon) | work steps |
| `approval` · `gate` | diamond | manual approval / automated gate (`by=`, `when=`) |
| `artifact` | document | produced/consumed artifact (image, package, report) |

- **Stages** are `group`s (lanes/columns); steps belong to a stage via `group=`.
- **Trigger detail**: `on="push|pr|schedule|manual|tag|webhook"` (+ `cron=` for schedule).
- **Tool/platform** on any step: `kind="ci:github-actions"`, `kind="aws:codebuild"`,
  etc. — resolves to the right base step kind + the vendor/tool icon.

**Edges** — flow with outcome routing:

| `edge.kind` | line | meaning |
|---|---|---|
| `flow` | solid arrow | next step (default) |
| `onsuccess` | solid green | take on success |
| `onfailure` | dashed red | take on failure |
| `manual` | dashed + person glyph | requires human action |
| `parallel` | solid, forked | fan-out to concurrent steps |

```kdl
diagram type="pipeline" title="Build → deploy" {
    layout engine="dagre" direction="LR"

    group "ci"  label="CI"  kind="process"
    group "cd"  label="CD"  kind="workflow"

    step "t"    kind="trigger" on="pr"               label="PR opened"
    step "src"  kind="source"  group="ci"            label="Checkout"
    step "b"    kind="ci:github-actions" group="ci"  label="Build"         // tool icon
    step "test" kind="test"    group="ci"            label="Unit + lint"
    step "img"  kind="artifact" group="ci"           label="container image"
    step "appr" kind="approval" group="cd" by="oncall" label="Promote?"
    step "dep"  kind="aws:codedeploy" group="cd"     label="Deploy prod"

    edge "t" "src" kind="flow"
    edge "src" "b" kind="flow"
    edge "b" "test" kind="flow"
    edge "b" "img"  kind="flow"
    edge "test" "appr" kind="onsuccess"
    edge "appr" "dep"  kind="manual"
}
```

### 5.9 `gantt` (scheduling)

Planned execution derived from a **dependency graph**: tasks carry a time cost, are
topologically ordered, scheduled earliest-start, and the **critical path** and total
**estimated duration** are computed (not authored). Two render modes:

- **`mode="timeless"`** — dependency / ordering view: no time axis; tasks placed by
  dependency order with lanes stacked. For reasoning about order and dependencies.
- **`mode="calendar"`** — bars on a horizontal **calendar axis**, positioned by the
  computed start/end, honouring the `calendar` working week.

**Elements:**

| element | form |
|---|---|
| **calendar** | `calendar start="YYYY-MM-DD" unit="day" workweek="mon-fri"` — calendar mode only |
| **lane** | `lane "id" label="…"` — a swimlane (parallel track); **auto-created** if a task names an undeclared lane |
| **start** | `start "start" label="Start"` — the do-nothing **star** root; **implicit if omitted**; exactly one per chart |
| **task** | `task "id" title="…" cost=N lane="…" start="YYYY-MM-DD"? ticket="…" ticket-url="…"` + `{ desc "…"; deps "id" "id"… }` |

- **`cost`** — duration in **days, 0.5 resolution** (`cost=2.5`).
- **`start`** (on a task) — the *estimated* start; **optional**. If omitted it is
  **derived** from dependencies (the max end of its deps). The **end is always
  calculated** (start + cost over working days) — never authored.
- **`deps`** — the dependency set (**≥ 1 id required**). Every task must depend on at
  least one other; the implicit `start` node gives the first task its origin. The
  graph must be acyclic; tasks are arranged in dependency order automatically.
- **`ticket` / `ticket-url`** — ticket id and/or a link to it.
- The **critical path** is highlighted; the chart reports total estimated duration
  (the critical-path length).

```kdl
diagram type="gantt" title="Release plan" mode="calendar" {
    calendar start="2026-07-01" unit="day" workweek="mon-fri"
    lane "be" label="Backend"
    lane "fe" label="Frontend"

    start "start" label="Start"                          // star root (implicit if omitted)

    task "api" title="Build API" cost=5 lane="be" ticket="JIRA-1234" \
        ticket-url="https://jira/browse/JIRA-1234" {
        desc "Order + payment REST endpoints"
        deps "start"
    }
    task "ui" title="Build UI" cost=4 lane="fe" ticket="JIRA-1240" {
        deps "start"
    }
    task "integ" title="Integration" cost=2.5 {
        deps "api" "ui"                                  // waits on both; end calculated
    }
}
```

## 6. Layout

- **Graph types** → dagre by default (`layout.direction` controls flow); ELK.js optional.
- **`sequence`** → temporal layout: participants across the top, messages top-to-bottom
  in document order, activation bars from sync call→return, fragments as labeled frames.
- **`gantt`** → a scheduler over the dependency graph: topological order + earliest-start
  from `cost`/`deps`; critical path highlighted. `mode=timeless` drops the time axis;
  `mode=calendar` positions bars on the calendar.
- **Overrides** — a node's `pos` child pins it; an edge's `waypoints` route it; a
  **"re-layout"** action clears `pos` to return to auto-layout.

## 7. Per-type rendering

Each type maps to fabric primitives: `class` → 3-compartment boxes; `sequence` →
lifelines + activations + message arrows + fragment frames; `state` → rounded states +
transitions; `system` → typed shapes + boundary containers; `pipeline` → step shapes +
routed edges; `gantt` → lane bands + task bars (or order columns) + a calendar header.
Shared primitives keep the renderers small.

### 7.1 Canvas & navigation

The viewport is independent of diagram size and applies to **every** type:

- **Scrollbars + pan** — when the rendered canvas exceeds the window, horizontal and
  vertical scrollbars appear and the diagram pans (background-drag / scroll-wheel).
- **Zoom** — mouse wheel and **Ctrl + ↑ / ↓** (and `+` / `−`), zooming about the
  cursor; plus **fit-to-window** and **100%** reset.
- In `gantt` `mode=calendar`, the time axis scrolls horizontally with a **sticky lane
  gutter** and **sticky date header**.

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
  packs/         — vendor icon packs (aws/gcp/azure/cloudflare): manifest + SVGs (§5.5)
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
