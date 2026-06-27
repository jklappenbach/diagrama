# diagrama — IntelliJ plugin (Phase 4)

A `FileEditorProvider` that opens `*.diagrama.kdl` as a **[ editor | preview ]** split
(the built-in Markdown plugin's shape). The editor half is the normal IntelliJ text
editor — install the official **intellij-kdl** plugin for KDL syntax. The preview half
is a **JCEF** browser running the diagrama renderer core (`dist/diagrama.min.js`).

## How it works

```
host text editor ──(document text)──►  JCEF preview ── Diagrama.renderKdl ──► canvas
        ▲                                    │
        └──── WriteCommandAction ◄── drag ── window.__diagramaPersist(newText)
```

- Text edit → `documentChanged` → `window.diagrama.setContent(text)` → re-render.
- Drag a node → core's `onPersist(minimalKdl)` → `__diagramaPersist` (a `JBCefJSQuery`)
  → `Document.setText` on the EDT under a write command. The KDL diff is minimal
  (only the dragged node's `pos`), because the core uses format-preserving write-back.

So the same renderer core powers both this preview and the standalone browser editor;
this surface adds no text editor of its own — the IDE provides it.

## Build & run

Uses the **IntelliJ Platform Gradle Plugin 2.x** (`org.jetbrains.intellij.platform`),
which requires **Gradle 9+** (wrapper pinned to 9.6) and a **JDK 17–21** to launch
(Gradle daemon JVM pinned to 21 via `gradle/gradle-daemon-jvm.properties`; set
`JAVA_HOME` to a JDK ≤ 21 if your default is newer).

```sh
# from the repo root: build the core bundle into plugin resources first
./build-intellij-bundle.sh

cd packages/intellij
./gradlew runIde        # launches a sandbox IDE with the plugin
./gradlew buildPlugin   # -> build/distributions/diagrama-intellij-*.zip
```

Open any `examples/*.diagrama.kdl` in the sandbox IDE to see the split preview.

> Status: **scaffold** — Kotlin compiles against the IntelliJ Platform 2024.1 SDK
> (downloaded by the 2.x Gradle plugin on first build). Runtime verification in a
> running IDE (JCEF needs a display) still pending. `dist/diagrama.min.js` is
> git-ignored in resources; `build-intellij-bundle.sh` copies it in.
