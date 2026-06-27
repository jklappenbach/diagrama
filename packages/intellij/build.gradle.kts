// diagrama IntelliJ plugin (Phase 4) — IntelliJ Platform Gradle Plugin 2.x.
// A FileEditorProvider that adds a JCEF preview beside the host text editor for
// *.diagrama.kdl (the Markdown editor+preview shape).
//
// Build:  run ../../build-intellij-bundle.sh first (copies the core bundle into
//         resources/web), then  ./gradlew buildPlugin   ·   ./gradlew runIde
plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.1.0"
    id("org.jetbrains.intellij.platform") version "2.17.0"
}

group = "dev.diagrama"
version = "0.1.0"

repositories {
    mavenCentral()
    intellijPlatform { defaultRepositories() }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity("2024.1")   // base shared by CLion / PyCharm
        // KDL editor support comes from the separately-installed intellij-kdl plugin.
    }
}

intellijPlatform {
    pluginConfiguration {
        ideaVersion {
            sinceBuild.set("241")
            untilBuild.set("251.*")
        }
    }
}

kotlin { jvmToolchain(17) }
