// diagrama IntelliJ plugin (Phase 4). A FileEditorProvider that adds a JCEF preview
// next to the host text editor for *.diagrama.kdl — the Markdown editor+preview shape.
//
// Build:  ./gradlew :buildPlugin   (run ../../build-intellij-bundle.sh first to copy
//         the core bundle into resources/web). Run:  ./gradlew :runIde
plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "1.9.25"
    id("org.jetbrains.intellij") version "1.17.4"
}

group = "dev.diagrama"
version = "0.1.0"

repositories { mavenCentral() }

intellij {
    version.set("2024.1")
    type.set("IC")            // IntelliJ IDEA Community — base shared by CLion/PyCharm
    plugins.set(emptyList())  // KDL editor support comes from the separately-installed intellij-kdl
}

kotlin { jvmToolchain(17) }

tasks {
    patchPluginXml {
        sinceBuild.set("241")
        untilBuild.set("251.*")
    }
    buildSearchableOptions { enabled = false }
}
