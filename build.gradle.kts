// Top-level build file where you can add configuration options common to all sub-projects/modules.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.ksp) apply false
}

// Keep generated Gradle outputs outside OneDrive to prevent sync-related file locks.
System.getenv("LOCALAPPDATA")
    ?.takeIf { it.isNotBlank() }
    ?.let { localAppData ->
        val localBuildRoot = file("$localAppData/Inorinal/gradle-build")
        layout.buildDirectory.set(File(localBuildRoot, "root"))
        subprojects {
            layout.buildDirectory.set(File(localBuildRoot, name))
        }
    }