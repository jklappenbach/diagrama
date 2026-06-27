plugins {
    // Auto-provision the JDK 17 toolchain the plugin targets (system JDK may differ).
    id("org.gradle.toolchains.foojay-resolver-convention") version "0.8.0"
}

rootProject.name = "diagrama-intellij"
