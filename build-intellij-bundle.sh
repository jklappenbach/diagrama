#!/usr/bin/env bash
# Build the core bundle and copy it into the IntelliJ plugin resources, so the JCEF
# preview can inline it. Run before `./gradlew :buildPlugin` in packages/intellij.
set -euo pipefail
cd "$(dirname "$0")"
npm run bundle
dest="packages/intellij/src/main/resources/web/diagrama.min.js"
cp dist/diagrama.min.js "$dest"
echo "copied core bundle -> $dest ($(wc -c < "$dest") bytes)"
