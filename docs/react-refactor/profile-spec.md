# Profile / Settings / About / Backup — React Native Rebuild Spec

Source of truth: Android app `com.green.inorinal`, branch `react`. All strings below are copied verbatim from Kotlin source.
All UI strings are hardcoded Kotlin literals — `res/values/strings.xml` contains only `app_name` (`祈`). Do not expect string resources for anything else.

Source files:
- [ProfileScreen.kt](app/src/main/java/com/green/inorinal/ui/screens/ProfileScreen.kt)
- [SettingsScreen.kt](app/src/main/java/com/green/inorinal/ui/screens/SettingsScreen.kt)
- [AboutScreen.kt](app/src/main/java/com/green/inorinal/ui/screens/AboutScreen.kt)
- [OpenSourceLicensesScreen.kt](app/src/main/java/com/green/inorinal/ui/screens/OpenSourceLicensesScreen.kt)
- [MainActivity.kt](app/src/main/java/com/green/inorinal/MainActivity.kt)
- [JournalViewModel.kt](app/src/main/java/com/green/inorinal/data/JournalViewModel.kt)
- [JournalBackupManager.kt](app/src/main/java/com/green/inorinal/backup/JournalBackupManager.kt)
- [JournalMediaStore.kt](app/src/main/java/com/green/inorinal/media/JournalMediaStore.kt)
- [UserStickerStore.kt](app/src/main/java/com/green/inorinal/media/UserStickerStore.kt)
- [AppLayout.kt](app/src/main/java/com/green/inorinal/ui/layout/AppLayout.kt) (width-based design tokens)
- [Theme.kt](app/src/main/java/com/green/inorinal/ui/theme/Theme.kt) / [Color.kt](app/src/main/java/com/green/inorinal/ui/theme/Color.kt)

---

## 1. Profile screen (“我的”)

Hosted as tab index 3 of `MainTabScreen`; bottom tab label is `我的` (tabs: `首页`, `分类`, `收藏`, `我的`). Icon: `Icons.Filled.Person` (selected) / `Icons.Outlined.Person`.

### Layout (top → bottom), all inside a vertically scrolling centered Column

| # | Element | Spec |
|---|---------|------|
| 1 | Top app bar | title `个人中心`, bold, `onSurface`; container `surface` |
| 2 | Spacer | 12dp (`isNarrow`) else 16dp |
| 3 | Avatar | circle `avatarSize` = 76/88/100dp (narrow/compact/else), bg `primary @ 15% alpha`; icon `Icons.Outlined.AccountCircle` (contentDesc `用户头像`) `avatarIconSize` = 60/70/80dp, tint `primary` |
| 4 | Name | `日记爱好者`, bold, `profileNameSp` = 18/22sp, `onSurface` |
| 5 | Tagline | `记录生活中的每一个美好瞬间`, 13sp (narrow) else 14sp, `onSurfaceVariant`, centered, maxLines 2, ellipsis, width 92% |
| 6 | Stats row | spacer `sectionGap` 20/24/32dp, `SpaceEvenly`, each cell `weight(1f)` |
| 7 | Actions row | spacer `sectionGap` |
| 8 | Menu card | spacer 16dp (narrow) else 24dp |
| 9 | Menu items | `设置` / `数据备份` / `关于`, 1dp-elevation card, sharp dividers |

Screen padding: `contentPadding` = 10/12/16/20dp; row/cell inner padding 16dp; card corner radius 12dp; card color `surfaceVariant`; divider `outlineVariant @ 30% alpha`.

### Stats cells (`StatItem`)

| Order | Icon | Label (exact) | Value text | Tint |
|---|---|---|---|---|
| 1 | `Icons.Filled.EditNote` | `日记` | `totalCount` (plain integer) | `primary` |
| 2 | `Icons.Filled.LocalFireDepartment` | `连续` | `${streakCount}天` (e.g. `12天`) | `FireOrange` `#FF8A65` |
| 3 | `Icons.Filled.Star` | `收藏` | `favoriteCount` | `StarYellow` `#FFD54F` |

Cell internals: icon 26dp, 4dp gap, value bold `statValueSp` = 16/20sp `onSurface`, label 12sp `onSurfaceVariant`.
There is **no “本月”/month card** in the UI even though `monthCount` exists in the ViewModel — do not add one for fidelity.

### Actions (`OutlinedButton`, radius 12dp, content color `primary`, icon 18dp + 6dp gap, labels maxLines 1)

| Button | Icon | Behavior |
|---|---|---|
| `导出条目` | `Icons.Filled.CloudUpload` | SAF create-document, MIME `application/zip`, suggested name `祈_日记备份_${System.currentTimeMillis()}.zip` |
| `导入条目` | `Icons.Filled.CloudDownload` | SAF open-document, types `application/zip`, `application/json`, `*/*` |

Responsive rule: when `isCompact` (width < 360dp) the two buttons stack in a Column with 12dp spacing and full width; otherwise a Row with 12dp spacing and `weight(1f)` each.

### Menu card rows (`ProfileMenuItem`)

| Icon | Label | Action |
|---|---|---|
| `Icons.Filled.Settings` | `设置` | navigate `settings` |
| `Icons.Filled.CloudUpload` | `数据备份` | **same export flow as `导出条目`** (no separate screen) |
| `Icons.Filled.Info` | `关于` | navigate `about` |

Row: clickable 16dp padding, icon 22dp `primary`, 12dp gap, text 16sp `onSurface`, trailing `Icons.Filled.ChevronRight` 20dp `onSurfaceVariant`.

### Dialogs / feedback

No in-screen dialogs. Only SAF pickers + `Toast`:

| Event | Text | Duration |
|---|---|---|
| Export success | `导出成功` | SHORT |
| Export exception | `导出失败: ${e.message}` | SHORT |
| Export stream null | `无法打开导出位置` (throws → becomes `导出失败: 无法打开导出位置`) | SHORT |
| Import result | `ImportResult.message()` = `导入完成：新增 {imported} 篇，跳过 {skipped} 篇，失败 {failed} 篇` | LONG |
| Import exception | `导入失败: ${e.message}` | SHORT |
| Import stream null | `无法读取导入文件` (→ `导入失败: 无法读取导入文件`) | SHORT |

Stats wiring: `refreshStats()` (total/month/favorite/streak) runs on ViewModel init and after create / save(with flag) / delete / toggleFavorite / import. It is **imperative, not a DB flow** — a RN port must refresh after every mutation or stats go stale.

Streak algorithm: distinct entry `date` set; if today missing start from yesterday; count consecutive days backwards.

---

## 2. Settings screen

Top bar: back icon (`contentDescription` `返回`) + title `设置` bold. Body: scrolling Column with `contentPadding`; each group = 14sp SemiBold header `onSurfaceVariant` (padding start 4dp, bottom 8dp) + one `surfaceVariant` card (radius 12dp, elevation 1dp) with 1dp rows and `outlineVariant @30%` dividers; 24dp spacer between groups.

### Rows in exact order

| Group | Row label | Subtitle | Control | Current default | Behavior |
|---|---|---|---|---|---|
| 界面设置 | `颜色风格` | — | dropdown (value shown before `›`) | `樱花粉` | 4 options, applies instantly |
| 界面设置 | `主题模式` | — | dropdown | `跟随系统` | 3 options, applies instantly |
| 界面设置 | `字体大小` | — | row with `›` | `16` | opens 4-option dialog |
| 界面设置 | `卡片样式` | — | row with `›` | — | Toast `卡片样式功能即将上线` |
| 编辑设置 | `默认字体` | — | row with `›` | — | Toast `默认字体功能即将上线` |
| 编辑设置 | `默认笔刷` | — | row with `›` | — | Toast `默认笔刷功能即将上线` |
| 隐私设置 | `应用锁` | — | row with `›` | — | Toast `应用锁功能即将上线，敬请期待` |
| 隐私设置 | `隐藏敏感内容` | — | row with `›` | — | Toast `隐藏敏感内容功能即将上线` |
| 开发者 | `调试模式` | `自动记录日志，便于开发与调试` | Switch | off | ON → confirm dialog; OFF → immediately disables + Toast `调试模式已关闭，已有日志将被删除` |
| 开发者 | `删除调试日志` | — | row with `›` | — | `DebugLog.clearLogs()` + Toast `调试日志已删除` |
| 其他 | `清除缓存` | — | row with `›` | — | opens confirm dialog |

Row metrics: `SettingItem` = 16sp `onSurface` + trailing `›` 20sp `onSurfaceVariant`, 16dp padding, whole row clickable. `SettingSwitchItem` = same padding, title 16sp, subtitle 12sp, Switch on the right, tapping the row toggles.

### Option sets (order = enum declaration order)

| Selector | Options (exact) | Stored value |
|---|---|---|
| 颜色风格 | `樱花粉` (SAKURA), `薄荷绿` (MINT), `长春花色` (PERIWINKLE), `跟随系统` (SYSTEM) | enum `.name` |
| 主题模式 | `浅色` (LIGHT), `深色` (DARK), `跟随系统` (SYSTEM) | enum `.name` |
| 字体大小 | `小`=14, `中`=16, `大`=18, `特大`=20 | int sp |

Dropdowns use a focusable `DropdownMenu` anchored top-end; tapping a menu item applies + closes immediately (no confirm). The 字体大小 dialog renders each option's label **at its own sp size** with a `RadioButton`; initial selection = current value; buttons `确定` (apply + Toast `字体大小已设置为{sp}sp`) and `取消`.

### Dialogs (exact text)

| Dialog | Title | Body | Confirm | Dismiss |
|---|---|---|---|---|
| 开启调试模式 | `开启调试模式` | `开启后应用会自动记录运行日志，可能会降低运行速度并增大应用所占磁盘空间。日志只记录技术事件和脱敏后的崩溃堆栈，不记录日记标题、正文或搜索内容；单个日志文件最大 2 MB，最多保留 7 天。日志会保存到应用专属目录。是否继续？` | `继续` → enable + Toast `调试模式已开启，日志保存于：{path}` or `调试模式已开启` | `取消` |
| 清除缓存 | `清除缓存` | `确定要清除应用缓存吗？这不会删除你的日记数据。` | `清除` → `cacheDir.deleteRecursively()` + Toast `缓存已清除` / `清除失败: {msg}` | `取消` |

Debug log dir: `getExternalFilesDir(null)/logs`, fallback `noBackupFilesDir/logs`; `DebugLog.clearLogs()` also runs when debug mode is turned off; max 2 MB per file, 7-day retention.

### Persistence (Preferences DataStore)

- Store name `settings` (file `settings.preferences_pb` under app `datastore/`).
- Keys: `color_style` (string), `theme_mode` (string), `font_size` (int), `debug_mode` (boolean).
- Defaults when absent: `AppColorStyle.SAKURA`, `AppThemeMode.SYSTEM`, `16`, `false`.
- Read once in `LaunchedEffect(Unit)` via `dataStore.data.map{}.first()`; invalid enum strings fall back to the defaults above (`valueOf` in try/catch). Font size is read raw with no validation (dialog restricts to 14–20, but a stale value passes through).
- Writes are fire-and-forget in `rememberCoroutineScope` per change; no debounce, no failure handling.
- Changing `debug_mode` also calls `DebugLog.setEnabled(...)`.

### Propagation

State is hoisted in `MainActivity`: local `mutableStateOf` is the single source for the current session, and `InorinalTheme(colorStyle, themeMode)` sits above `AppNavigation`, so any change recomposes the whole app immediately. `font_size` only reaches the editor (`EditorBridge.applyEditorSettings`, clamped 12–28 sp) — it does **not** change Profile/Settings/Home text sizes.

Theme resolution: `LIGHT`→light, `DARK`→dark, `SYSTEM`→system dark. Color style: SAKURA/MINT/PERIWINKLE pick the matching light/dark scheme; `SYSTEM` uses Android 12+ dynamic color (`dynamicLight/DarkColorScheme`), falling back to Sakura below API 31. Palettes: Sakura primary `#C06070`, Mint primary `#429E9D`, Periwinkle primary `#6F6BC7`, light background `#FAF7F2`, light surface `#FAFAFA`; dark backgrounds `#1F1215` / `#121F1D` / `#141323`. Status and navigation bar icon appearance follow dark mode.

---

## 3. Backup export / import

### UI flow

Export: `导出条目` **or** menu `数据备份` → `ActivityResultContracts.CreateDocument("application/zip")` with suggested filename `祈_日记备份_<epochMillis>.zip` → on URI, open output stream on IO dispatcher → `viewModel.exportBackup(os)` → Toast `导出成功` / `导出失败: …`.
Import: `导入条目` → `ActivityResultContracts.OpenDocument()` with `["application/zip","application/json","*/*"]` → open input stream → `viewModel.importBackup(input, overwrite = false)` → single Toast of `ImportResult.message()`. **No overwrite UI exists**; `overwrite` is hardwired `false`.

Export content source: all entry IDs ordered `createdAt DESC`, each fully re-read (content chunked at 512 000 chars), content passed through `toBackupHtml`.

### ZIP structure

Written with `ZipOutputStream(outputStream.buffered())` in this order:

| Entry name | Contents |
|---|---|
| `manifest.json` | UTF-8 JSON **array** of entry objects (see below) |
| `media/{entryId}/{fileName}` | one entry per referenced media file; `entryId` is the parent directory name of the stored file (also the journal entry id) |
| `stickers/{fileName}` | every safe-named file directly in `filesDir/user_stickers` (no recursion) |

Media set = union of `${journal-media://local/{entryId}/{fileName}}` resolves and `file://…` URIs under the media root (`filesDir/journal_media`), deduplicated by canonical path. No directory entries are written; timestamps are not set explicitly.

### manifest.json — entry object fields

JSON array, Gson default config (no pretty printing, **nulls omitted**, HTML chars `< > & = '` escaped as `\uXXXX` because Gson `htmlSafe` is on).

| Key | JSON type | Value |
|---|---|---|
| `id` | string | entry UUID |
| `title` | string | raw title |
| `content` | string | HTML with media refs rewritten: `journal-media://local/{id}/{file}` → `media/{id}/{file}`; `file://…` under media root → `media/{parentDirName}/{fileName}` |
| `date` | string | `ISO_LOCAL_DATE`, e.g. `2025-11-14` |
| `weather` | string | enum name: `SUNNY` / `RAINY` / `CLOUDY` / `NIGHT_CLEAR` (legacy `SNOWY` possible only for old data; converter normalizes SNOWY→CLOUDY on DB write) |
| `mood` | string | `HAPPY` / `CALM` / `SAD` (legacy `EXCITED`,`PROUD`,`EMOTIONAL` normalized on DB write) |
| `category` | string | `ALL` / `DAILY` / `WORK` / `GOAL` / `INSPIRATION` / `EMOTION` |
| `isFavorite` | boolean | favorite flag |
| `imageUrl` | string / absent | omitted when null |
| `createdAt` | number | epoch millis |
| `updatedAt` | number | epoch millis |

**No version field, no schema marker, no exported-at/app-version metadata.** “Versioning” is purely structural: the reader sniffs the first two bytes (`PK`) to pick ZIP vs legacy JSON. Extra unknown keys are ignored; missing keys fall back per the table below.

### Import detection & parsing

1. Peek 2 bytes; if `PK` → `importZip`, else → `importLegacyJson` (plain JSON array, no media/stickers).
2. ZIP: entries iterated in archive order; non-directory entries count against `MAX_ARCHIVE_FILES`. Entry classification:
   - name == `manifest.json` → manifest (last one wins);
   - `media/{safeEntryId}/{safeFileName}` (exactly 3 slash-separated parts) → staged under `cache/journal_backup_import_<millis>/{entryId}/`;
   - `stickers/{safeFileName}` (exactly 2 parts) → staged under `…/stickers/`;
   - anything else is silently ignored (not counted as failure).
3. Manifest → `List<Map<String,Any?>>`; unparseable/blank JSON yields `failed = 1` and zero entries.

### Import validation & limits

| Constant | Value | Effect |
|---|---|---|
| `MAX_ARCHIVE_FILES` | 5 000 | non-directory entry count; exceeding aborts the whole import (exception) |
| `MAX_BACKUP_ENTRIES` | 10 000 | rows beyond this are dropped and counted as `failed` (`rows.size - 10000`) |
| `MAX_MANIFEST_BYTES` | 16 MiB | per entry read cap, applies to legacy JSON too |
| `MAX_MEDIA_FILE_BYTES` | 20 MiB | per media file |
| `MAX_STICKER_FILE_BYTES` | 512 KiB | per sticker |
| `MAX_TOTAL_MEDIA_BYTES` | 128 MiB | cumulative media + stickers |
| `MAX_TITLE_LENGTH` | 500 chars | title truncated |
| `MAX_ENTRY_CONTENT_LENGTH` | 10 000 000 chars | longer content → row rejected (`failed`) |
| safe entry id | `[A-Za-z0-9_-]{1,128}` | invalid id → row rejected |
| safe media file name | `[A-Za-z0-9._-]{1,255}`, not `.`/`..` | invalid → entry ignored / row rejected |
| safe sticker name | `[A-Za-z0-9._-]{1,255}`, not `.`/`..` | file limit additionally 2×256 KiB at the sticker store |

Per-row fallbacks in `parseEntry`:

| Field | Fallback / rule |
|---|---|
| `id` | blank → new random UUID; then must match safe-entry-id, else row rejected |
| `title` | blank → `未命名日记`, then `.take(500)` |
| `content` | missing → `""`; > 10 000 000 chars → row rejected |
| `date` | unparseable/missing → **today** |
| `weather` | unknown → `SUNNY` |
| `mood` | unknown → `HAPPY` |
| `category` | unknown → `DAILY` |
| `isFavorite` | only real JSON boolean → true; anything else (incl. `"true"` string) → false |
| `imageUrl` | blank/missing → null |
| `createdAt` / `updatedAt` | number or numeric string; else **now** |

### Import merge semantics (overwrite / skip)

1. Stickers imported first, each wrapped in `runCatching` (failures silently ignored, never counted).
2. Per entry: look up existing by id. If `!overwrite && exists` → `skipped++`, continue **before** media copy.
3. Otherwise copy staged media into `filesDir/journal_media/{entryId}/{fileName}` (overwrite=true), rewrite `media/…` refs back to `journal-media://local/…` (`restoreBackupHtml`) **only if that entry had staged media**, then `migrateInlineImages`, force `updatedAt = now`.
4. All accepted entries inserted in one `insertAll` (`OnConflictStrategy.REPLACE`) → `imported = size`; on throw, `failed += size` and `imported = 0`.
5. Temp dir deleted in `finally`; `refreshStats()` runs at the end.

`ImportResult` fields: `imported`, `skipped`, `failed` (only these three). Message: `导入完成：新增 {imported} 篇，跳过 {skipped} 篇，失败 {failed} 篇`.

Byte-compat caveats for a RN reimplementation:
- JSON must be a **top-level array** with exactly these camelCase keys; nulls omitted; HTML-escaped strings (`\u003c` etc.) if byte-identical output is required (semantically optional).
- Dates are `YYYY-MM-DD`; enums are Kotlin names, never display names (`晴天` is not valid).
- Media refs live inside the HTML `content` string, not in a side table — the `media/…` ↔ `journal-media://local/…` rewrite is the whole contract.
- Sticker ZIP paths have no entry-id segment; media paths do (and the entry id must equal the journal entry id).

---

## 4. About screen

Top bar: back (`返回`) + title `关于`. Body: scrolling Column, horizontal padding `contentPadding`, vertical gradient background from `primary @10%` → `background` → `background`, centered children:

| # | Element | Exact spec |
|---|---|---|
| 1 | Top spacer | `aboutTopSpacer` 24/32/60dp |
| 2 | Icon | `Icons.Outlined.AutoStories` (contentDesc `祈日记`), `aboutIconSize` 88/104/120dp, tint `primary` |
| 3 | Spacer | 20dp |
| 4 | App name | `祈`, bold, `aboutHeroSp` 36/42/48sp, `primary` |
| 5 | Spacer | 12dp |
| 6 | Version | `Alpha v0.2.3`, 16sp, `onSurfaceVariant`, **tappable (easter egg)** |
| 7 | Spacer | 40dp |
| 8 | Dedication | `以本软件献给我最亲爱的小不点儿～`, italic, 13sp (narrow) else 15sp, `onSurfaceVariant @70%`, centered, full width with 8dp horizontal padding |
| 9 | Spacer | 20dp |
| 10 | Licenses note | `本软件使用了若干开源组件与图标，详见许可证信息。`, 12sp, `onSurfaceVariant @70%`, centered |
| 11 | Spacer | 24dp |
| 12 | Button | OutlinedButton, radius 12dp, `primary`: `Icons.Filled.Description` 18dp + `开放源代码许可` → navigate `licenses` |
| 13 | Spacer | 12dp |
| 14 | Button | OutlinedButton, radius 12dp, `primary`: `Icons.Filled.Update` 18dp + `检查更新` → Toast `当前已是最新版本` (no network call) |

Easter egg: 5 taps on the version text (counter resets at 5) spawn 30 particles for 5 s. Each: random x in 0–1, start y = -0.1, speed 0.003–0.008 screen-height per 16 ms frame, drift ±0.0015, size 12–32dp, rotation +2°/frame; heart (`Icons.Filled.Favorite`, `FavoriteRed #E57373 @80%`) or star (`Icons.Filled.Star`, `StarYellow #FFD54F @80%`) chosen randomly; removed below y > 1.2; overlay is not click-blocking (drawn above Scaffold).

No author name, email, or website link exists anywhere in this screen — do not invent one.

---

## 5. Open source licenses

Top bar: back (`返回`) + title `开放源代码许可`. Body: scrolling Column, 16dp padding; intro 14sp `onSurfaceVariant`: `感谢以下开源项目与资源。完整许可证文本请以各项目官方仓库为准。`; 16dp gap; one `surfaceVariant` card radius 12dp, rows separated by `outlineVariant @30%`, each row 16dp padding: name (bold 16sp `onSurface`), 4dp, license (13sp `primary`), 4dp, note (13sp `onSurfaceVariant`), 4dp, source URL text (12sp `onSurfaceVariant @80%`, **not a link — not tappable**).

| # | Name | License | Source | Note |
|---|---|---|---|---|
| 1 | AndroidX Activity / Lifecycle / Navigation | Apache License 2.0 | https://developer.android.com/jetpack/androidx | 应用基础架构与导航。 |
| 2 | Jetpack Compose / Material 3 | Apache License 2.0 | https://developer.android.com/jetpack/compose | 界面框架与 Material 组件。 |
| 3 | Material Icons / Material Symbols | Apache License 2.0 | https://github.com/google/material-design-icons | 应用内天气、心情、头像、底部导航、日记卡片操作及装饰矢量图标。 |
| 4 | Room | Apache License 2.0 | https://developer.android.com/training/data-storage/room | 本地数据库。 |
| 5 | DataStore | Apache License 2.0 | https://developer.android.com/topic/libraries/architecture/datastore | 用户设置存储。 |
| 6 | Gson | Apache License 2.0 | https://github.com/google/gson | 备份清单与旧 JSON 导入导出。 |
| 7 | LXGW WenKai | SIL Open Font License 1.1 | https://github.com/lxgw/LxgwWenKai | 编辑器手写风格字体。 |
| 8 | Moveable | MIT License | https://github.com/daybrush/moveable | 编辑器贴纸拖移、缩放与旋转控制。 |
| 9 | Atrament | MIT License | https://github.com/jakubfiala/atrament | 编辑器涂鸦笔触绘制。 |
| 10 | Rough.js | MIT License | https://github.com/rough-stuff/rough | 编辑器涂鸦手绘风格渲染。 |

The RN rebuild keeps this list verbatim (Android-only entries like Room/DataStore/Gson should stay for fidelity unless the lead decides otherwise) and may append new entries for RN-only dependencies, but must not reorder or reword existing ones.

---

## 6. Version constants & app identity

| Item | Value | Location |
|---|---|---|
| Application id / namespace | `com.green.inorinal` | [build.gradle.kts](app/build.gradle.kts#L8) |
| `versionCode` | `6` | [build.gradle.kts](app/build.gradle.kts#L15) |
| `versionName` | `Alpha v0.2.3` | [build.gradle.kts](app/build.gradle.kts#L16) |
| Displayed version | `Alpha v0.2.3` (**hardcoded literal**) | [AboutScreen.kt](app/src/main/java/com/green/inorinal/ui/screens/AboutScreen.kt#L155) |
| App name (launcher) | `祈` | [strings.xml](app/src/main/res/values/strings.xml#L2) |
| Brand name in backup filename | `祈` | [ProfileScreen.kt](app/src/main/java/com/green/inorinal/ui/screens/ProfileScreen.kt#L191) |
| minSdk / targetSdk / compileSdk | 29 / 36 / 36 | build.gradle.kts |

Single source of truth for the version string does not exist — gradle `versionName` and the About literal must be kept in sync manually; in RN put it in one config module and render it in About.

---

## 7. Risks / gotchas for the RN port

1. **No backup format version field.** The importer only distinguishes ZIP vs legacy JSON by the `PK` magic. Any future format change is undetectable; if you add a `version` key, the Android app will simply ignore it (safe direction), but a `manifest` object instead of an array will break it.
2. **Gson `htmlSafe` escaping** (`< > & = '` → `\u003c`-style) and **null omission** mean byte-identical manifests require reimplementing Gson quirks; semantic equality only needs the same keys/types.
3. **Media references live inside HTML strings.** Backup fidelity depends on reproducing the exact `journal-media://local/{entryId}/{fileName}` ↔ `media/{entryId}/{fileName}` rewrite, including the "only rewrite back if the entry had staged media" rule.
4. **`overwrite` is dead UI.** Every import is skip-on-duplicate (`skipped`), so re-importing the same backup always reports `新增 0`; there is no user-visible way to force replacement.
5. **Import failures are partially silent:** bad stickers, unknown ZIP paths, and rows over the entry cap never surface individually — only the aggregate `失败 N 篇`.
6. **Failures can be double-counted**: parse failures increment `failed`, and a failed `insertAll` adds the whole batch size again.
7. **Stats are imperative, not reactive**, and `monthCount` is computed but never displayed. In RN either keep the same refresh-on-mutation contract or make counts derived (visible behavior difference only if a mutation is missed).
8. **Streak is clock-dependent** (`LocalDate.now()`), so timezone/clock changes alter the `连续` value and its `天` suffix formatting.
9. **Font-size setting only affects the editor** (clamped 12–28 sp), not the rest of the app; label says 字体大小 with no scope hint, which is a known fidelity trap.
10. **Settings have no validation or migration**: invalid enum strings silently fall back to SAKURA/SYSTEM defaults; `font_size` is read unvalidated.
11. **No progress/confirmation UX for backup** — long exports/imports block with no indicator; failures are toasts only. A RN implementation should match this (no spinner) unless the lead approves a deviation.
12. **Toast vs Snackbar**: all feedback on these screens is Android `Toast`; RN equivalents need a global toast host to keep timing/length semantics (SHORT ≈ 2 s, LONG ≈ 3.5 s).
13. **Width-dependent layout tokens** (`isNarrow < 340`, `isCompact < 360`, `isRegular 360–419`, `isComfortable ≥ 420` dp) govern paddings, avatar size, and the button stacking rule; use `useWindowDimensions().width` with the same breakpoints.
14. **String duplication**: `个人中心` title vs `我的` tab label vs `祈` app name; keep all three distinct as-is.
