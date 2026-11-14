# RN rewrite — Android build notes

Status: **complete for Alpha v0.5.1-react** — debug + release APKs build on Windows; both were
installed and exercised on an API 36 emulator (Pixel_9_Pro). Owner: Lead (build/verification).

## Dependency versions

| Package | Version | Notes |
| --- | --- | --- |
| react-native | 0.88.1 | scaffold; Hermes + New Architecture |
| react-native-webview | 14.0.1 | editor host |
| jszip | 3.10.1 | ZIP backup |
| react-native-safe-area-context | 5.5.2 | insets |
| Gradle | 9.5.0 | local install; template wrapper lists 9.4.1 |
| Android Gradle Plugin | AGP 9.x | RN 0.88 template |
| Kotlin | 2.2.0 | `kotlinVersion` |

## SDK / JDK

- JDK: 21 (Android Studio JBR 21 works). `gradle.properties` intentionally does **not** hardcode
  a machine path; set `JAVA_HOME` or use Android Studio.
- `org.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8`.
- compileSdk / buildTools: **37 / 37.0.0**; platform installed as `platforms;android-37.0`.
- NDK **27.1.12297006**, CMake **3.22.1**.
- targetSdk 36, minSdk 29.

## App configuration

- namespace `com.inorinal`, applicationId `com.green.inorinal`.
- versionCode `7`, versionName `Alpha v0.5.1-react`.
- label `祈`; Compose adaptive icon vectors copied verbatim.
- `allowBackup="false"`, `supportsRtl="true"`, `windowSoftInputMode="adjustResize"`.
- Release build currently signs with the template **debug keystore** (Alpha build; not for store
  distribution). Replace `signingConfigs.release` before a production release.

## Assets

- `assets/editor/{editor.html,editor.css,editor.js,vendor/*}` copied byte-for-byte (BOM kept).
- `assets/fonts/LXGWWenKai-Regular.ttf` + OFL, `MaterialIcons.ttf` + codepoints.
- `src/theme/material-codepoints.ts` generated from the codepoints file.
- RN bundles two small design textures: `src/assets/glow.png` (256²) and `src/assets/frost.png`
  (64² tiled noise), used by `AmbientBackground` / `GlassSurface`.

## Native module

`com.inorinal.nativebridge.InorinalModule` + `InorinalPackage`, registered in `MainApplication`.
Methods: file IO, Base64, media/image picking, sticker library, SAF save/open, HTML display/storage
rewrite, media cleanup, cache clear, and `readLegacyEntries` (one-time read-only Room migration).
File IO runs on a single-thread executor; pickers use `ActivityEventListener`.

## Windows build workarounds

1. **OneDrive file locks.** The repo lives under OneDrive, which intermittently locks/refuses
   deletes of AGP intermediates (`packageDebugResources` failure). `app/build.gradle` redirects the
   app module's build directory to a short local path:
   ```groovy
   layout.buildDirectory.set(file("C:/rn-build/app"))
   ```
   (overridable via `INORINAL_BUILD_ROOT` after the portability patch).
2. **MAX_PATH for CMake.** The deep source path plus generated object names exceeds 260 chars.
   `externalNativeBuild.cmake.buildStagingDirectory` is set to `C:/rn-cxx` (short, local).
   A `subst R:` drive also works but confuses Metro's bundle task (it mixes `R:\` and `C:\`), so
   building from the real `C:\...` path with a short staging dir is preferred.
3. **Slow React Native/Hermes AAR downloads.** `react-android`/`hermes-android` `debug` and
   `release` AARs (~270 MB + ~110 MB each) were downloaded from the Aliyun Maven mirror into a
   local repository and passed as `-Preact.internal.mavenLocalRepo=C:/Users/Green/inorinal-maven`.
   On a normal network this flag can be dropped.
4. **Metro not required.** `react { debuggableVariants = [] }` bundles JS into debug builds, so the
   debug APK also runs standalone (useful when the Windows bash executor is unavailable).
5. **Gradle wrapper download stalls.** During development `gradlew.bat` was temporarily pointed at
   a local Gradle 9.5.0 install; this local-only change has been reverted, so the committed wrapper
   downloads the distribution normally (slow only on first run).

## Build commands

```bash
# Debug (bundled JS, installable standalone)
cd react-native/android
./gradlew assembleDebug --console=plain \
  -Preact.internal.mavenLocalRepo=C:/Users/Green/inorinal-maven

# Release (JS bundle + Hermes bytecode, all ABIs)
./gradlew assembleRelease --console=plain \
  -Preact.internal.mavenLocalRepo=C:/Users/Green/inorinal-maven
```

## APK paths

- Debug: `C:/rn-build/app/outputs/apk/debug/app-debug.apk`
- Release: `C:/rn-build/app/outputs/apk/release/app-release.apk`
- The source tree also keeps a copy at `react-native/android/app/build/outputs/apk/<variant>/` when
  the redirect is disabled.

## Verification notes

- Emulator: Pixel_9_Pro, API 36, x86_64. `adb reverse tcp:8081 tcp:8081` only needed when running
  with Metro; bundled debug/release APKs need no server.
- Deterministic text input for regression used the test-only **ADBKeyboard** IME
  (`ADB_INPUT_TEXT` broadcast); it is installed on the emulator only, never in the app.
- Legacy migration was tested by seeding a hand-built SQLite file at
  `databases/journal_database`, deleting `files/journal/legacy-migrated.json`, and relaunching:
  the old row was imported once and the marker written.
- Debug and release are signed with the same debug key, so release can be installed over debug
  with data preserved (`adb install -r`).

## Deviations / open issues

- Dynamic color (`SYSTEM` style) falls back to Sakura, matching Compose behavior below API 31.
- Category label is unified to `情绪` (Compose category screen used `情感`).
- Live blur is intentionally not used; frosted glass is simulated with static textures for
  performance (see `docs/react-refactor/design-language.md`).
