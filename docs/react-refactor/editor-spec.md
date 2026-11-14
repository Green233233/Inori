# Editor Spec — Compose `EditorScreen` + WebView editor, for the React Native port

Status: reverse-engineered from the `react` branch (Compose app, package `com.green.inorinal`).
Purpose: implementation-ready reference for rebuilding the journal editor in
`react-native/` (RN 0.88.1, React 19.3, New Architecture) with `react-native-webview`.

Nothing in this document is a proposal unless it lives under **§9 Porting plan**. Everything
before §9 describes what the current app does, with exact strings and payloads.

## 0. Source map (what was read)

| Area | File | Size |
|---|---|---|
| Compose screen (UI, save lifecycle) | `app/src/main/java/com/green/inorinal/ui/screens/EditorScreen.kt` | 1358 lines |
| Android↔JS bridge | `app/src/main/java/com/green/inorinal/editor/EditorBridge.kt` | 750 lines |
| Editor page | `app/src/main/assets/editor/editor.html` | 22 lines |
| Editor styles | `app/src/main/assets/editor/editor.css` | 213 lines |
| Editor logic | `app/src/main/assets/editor/editor.js` | 1438 lines / 50 115 B |
| Media files | `app/src/main/java/com/green/inorinal/media/JournalMediaStore.kt` | 172 lines |
| Sticker library | `app/src/main/java/com/green/inorinal/media/UserStickerStore.kt` | 187 lines |
| Persistence hook | `app/src/main/java/com/green/inorinal/data/JournalViewModel.kt` (`saveEntry`, `getEntryById`) | 229 lines |
| Enums (metadata labels) | `app/src/main/java/com/green/inorinal/data/JournalEntry.kt` | 102 lines |
| Doodle protocol doc | `docs/doodle-engine.md` | 126 lines |

Vendored web deps (`app/src/main/assets/editor/vendor/`): `atrament.js` (7 275 B, classic
build, defines `window.Atrament` + `window.ATRAMENT_MODE_*`), `rough.js` (29 953 B, Rough.js
4.6.6 IIFE, `rough.canvas(...)`), `moveable.min.js` (245 551 B). `atrament.esm.js` (13 824 B)
is present but **not loaded**.

Font: `app/src/main/assets/fonts/LXGWWenKai-Regular.ttf` (+ `OFL-LXGWWenKai.txt`).

## 1. Architecture in one paragraph

The journal body is **HTML inside a `contenteditable` div**, not a native rich-text model.
Compose owns chrome (top bar, 4-tab bottom bar, three overlay toolbars/sheets) and persistence;
the WebView owns text editing, stickers (Moveable), the doodle canvas (Atrament + Rough) and
image insertion. All content crosses the boundary as a **whole-document `innerHTML` string**.
Android → JS is `evaluateJavascript(...)`; JS → Android is `@JavascriptInterface` on the
object `AndroidBridge`. There is no JSON envelope today: each direction calls named functions.

```
Compose EditorScreen ──evaluateJavascript("fn(args)")──► editor.js (window.fn)
        ▲                                                     │
        └──── AndroidBridge.onContentChanged(html) ◄───────────┘
              AndroidBridge.onDoodleStateChanged(stateJson)
              AndroidBridge.onImageClicked(dataUrl)
              AndroidBridge.requestImageInsert()
              AndroidBridge.setStickerGestureActive(bool)
```

WebView is configured to be fully offline: `blockNetworkLoads = true`,
`allowContentAccess = false`, and `shouldInterceptRequest` serves `journal-media://` (and
legacy `file://` under `filesDir/journal_media`) from disk while returning **403 Forbidden**
for every other `file://` URL outside `file:///android_asset/`.

## 2. Bridge protocol (exhaustive)

### 2.1 Android → JS: JS functions Android calls

All calls go through `EditorBridge.evaluateJavascript`. Argument escaping is done by
`escapeForJs` (§2.4). Function names are globals installed at the bottom of `editor.js`
(`Object.assign(window, {...})`).

| JS function | Args (from Android) | Emitted by | When |
|---|---|---|---|
| `setContent(html)` | display HTML (data-URI images) | `setContent`, `onPageFinished` pending flush | load entry, after any save that changes representation |
| `getContent()` | – returns HTML string | `getContent(cb)`, `saveEntry` via `getContentForSave()` | every save; 2 000 ms timeout fallback |
| `execCmd(command)` | `bold` `italic` `underline` `strikeThrough` `justifyLeft` `justifyCenter` `justifyRight` `undo` `redo` | `EditorBridge.execCmd` | text toolbar buttons |
| `changeFont(fontName)` | `handwrite` `serif` `sans-serif` | `changeFont` | font chips |
| `changeSize(size)` | `"2"` `"3"` `"5"` (`<font size>` 1–7) | `changeSize` | size chips |
| `changeColor(color)` | `#RRGGBB` | `changeColor` | colour swatch |
| `insertImage(dataUri)` | `data:image/jpeg;base64,…` | `insertImage(uri)` | after picker + compress |
| `insertSticker(name)` | `heart`…`ribbon` (20 keys) | `insertSticker` | built-in sticker tap |
| `insertCustomSticker(dataUri)` | `data:image/png;base64,…` or jpeg | `insertUserSticker`, `insertCustomSticker(uri)` | library tap / import |
| `toggleDoodleMode(active)` | `true` / `false` (raw `$active`) | `toggleDoodleMode` | doodle tab on/off, meta menu open, sheet dismiss |
| `setBrush(type)` | `pencil` `pen` `marker` `watercolor` `highlighter` `eraser` | `setBrush` | brush chip |
| `setBrushSize(size)` | decimal string, e.g. `"2"`, `"12.5"` (`formatBrushSize` trims zeros) | `setBrushSize` | brush chip + slider |
| `setBrushColor(color)` | `#RRGGBB` | `setBrushColor` | doodle colour swatch |
| `setBrushRoughness(float)` | clamped `0f..4f` | `setBrushRoughness` | exposed but unused by UI |
| `undoDoodle()` / `redoDoodle()` / `clearDoodle()` | – | same-named fns | doodle toolbar |
| `mergeDoodle()` | – | `mergeDoodle` | doodle "确认" (then panel hides) |
| `insertDoodleImage()` | – | `insertDoodleImage` | doodle "导出" |
| `getDoodleJson()` | – returns JSON string | `getDoodleJson()` (suspend, 2 000 ms) | unused by UI |
| `exportDoodleImage()` | – returns PNG data URL | `exportDoodleImage()` (suspend, 2 000 ms) | unused by UI |
| `applyTheme(isDark, bg, text, paperStart, paperMid, paperEnd, line)` | raw literals `'#RRGGBB'` / `'rgba(...)'`, first arg bare boolean | `applyTheme` | every WebView `update` (recomposition) and after page load if pending |
| `applyEditorSettings(fontSizeSp)` | int clamped `12..28` | `applyEditorSettings` | font-size setting + every recomposition |
| `loadDoodleJson(json)` | doodle JSON string | exported API, not called by Android | – |
| `setBrushOptions(optionsJson)` | JSON `{color,size|width,roughness,tool}` | exported API, not called | – |

Also reachable (same object): `getDoodleState()`, `setDoodleTool` (alias of `setBrush`).

Notes:
- `applyTheme` is the only call that builds JS with single-quoted interpolals instead of
  `escapeForJs`; colour values are generated by `colorToHex` (`#%02X%02X%02X`) so no quoting
  hazard exists, but do not pass untrusted strings through it.
- `execCmd` **omits the second argument when value is empty**, so JS sees `execCmd("bold")`
  and `document.execCommand(cmd, false, null)`.
- Format calls call `webView.requestFocus()` *before* `evaluateJavascript` so the selection
  survives the native→web focus hop. `execCmd`/`changeFont`/`changeSize`/`changeColor` in JS
  then call `paper.focus()` + `restoreSelection()`.
- There is **no** bulk "sticker library sync" call. The sticker sheet is native Compose
  (thumbnails decoded with `BitmapFactory.decodeFile`); JS only ever receives one
  `insertCustomSticker(dataUri)` at a time.

### 2.2 JS → Android: `@JavascriptInterface` methods

Exposed via `webView.addJavascriptInterface(this, "AndroidBridge")`. All are void; JS never
reads return values (so they can be made async over `postMessage` in RN).

| Method | Param | JS caller | Meaning on Android |
|---|---|---|---|
| `onContentChanged(html)` | full `paper.innerHTML` | `notifyContentChanged()` | updates `EditorBridge.content: StateFlow<String>`; **never writes to DB directly** — the screen's debounce does |
| `onDoodleStateChanged(stateJson)` | JSON, see §8.4 | `notifyDoodleStateChanged()` | `doodleState` StateFlow (`"{}"` when blank). Currently not consumed by UI |
| `onImageClicked(dataUrl)` | `img.src` | `bindImageClick` → `image.onclick` | posted to main looper → `onImageClick` → Compose preview `AlertDialog` |
| `requestImageInsert()` | – | *not called by editor.js* (dead hook) | invokes `onImageRequest` → picker |
| `setStickerGestureActive(active)` | boolean | `notifyStickerGesture()` | posted to main looper; `requestDisallowInterceptTouchEvent(active)` on parent + full-screen `systemGestureExclusionRects` while active (API ≥ 29); otherwise leaves 64 dp edge exclusions installed |

`onContentChanged` fires from: `input` on `#paper`, any `execCmd`/`changeFont`/`changeSize`/
`changeColor`, `normalizeFontTags`, `insertImage`, `insertSticker`, `insertCustomSticker`,
sticker `dragEnd`/`resizeEnd`/`rotateEnd`, sticker delete, `insertDoodleImage`, `mergeDoodle`,
`persistDoodleChange` (each recorded doodle stroke / erase / undo / redo / clear),
`toggleDoodleMode(false)`.

### 2.3 JS-side globals Android relies on

`window.Atrament`, `window.ATRAMENT_MODE_DISABLED | DRAW | ERASE`, `window.rough.canvas`,
`window.Moveable` (constructor or `.default`), and the 28 functions listed in §2.1. Keep every
one of these names when porting — the RN glue can reuse them unchanged.

### 2.4 String escaping / decoding (must be reproduced)

`escapeForJs(str)`:
```
\  -> \\      "  -> \"      '  -> \'      \n -> \n      \r -> \r
result is wrapped in "..."
```
It does **not** escape `<`, `>`, `&`, U+2028, U+2029, or emoji. Emoji and CJK pass through as
raw UTF-16.

`decodeJsString(result)`: WebView `evaluateJavascript` returns a JSON literal; Android does
`JSONArray("[$result]").getString(0)` and returns `""` for `null`/blank/unparseable.

### 2.5 Initial load sequence (order matters)

1. `EditorScreen` composes; `remember { EditorBridge(context) }`.
2. `LaunchedEffect(entryId)` loads the entry from the repository
   (`viewModel.getEntryById`, which also runs `migrateInlineImages` on read). Sets `title`,
   `weather`/`mood`/`category` (both `normalized()`), fills `lastSavedSnapshot`, and calls
   **`bridge.setPendingContent(entry.content)`** — deliberately *not* `setContent`, because the
   WebView may not be created/loaded yet. `setPendingContent` stores
   `pendingContent = toDisplayableHtml(content)` and only calls `setContent` if `pageLoaded`.
3. `AndroidView(factory)` creates the `WebView`, applies settings, adds the JS interface,
   installs `WebViewClient`, `loadUrl("file:///android_asset/editor/editor.html")`.
4. Page loads → `editor.js` `DOMContentLoaded` → `initialiseDoodle()`, `bindEditorEvents()`,
   `bindStickerHandlers()`, `updateVisibleViewport()`.
5. `onPageFinished` → `pageLoaded = true` → flush `pendingContent` via `setContent` →
   flush `pendingThemeJs` → flush `pendingEditorSettingsJs`.
6. `AndroidView(update)` runs on every recomposition and calls `applyTheme(...)` +
   `applyEditorSettings(fontSizeSp)`; if the page isn't ready these are queued in
   `pendingThemeJs` / `pendingEditorSettingsJs` (single slot, last write wins).
7. `setContent(html)` → `toDisplayableHtml` (journal-media URLs → data URIs) → updates
   `_content` → `evaluateJavascript("setContent(\"…\")")` → JS `setContent` sanitizes,
   re-binds image clicks and stickers, `extractDoodleDataNode()`, clears the saved selection,
   and **deliberately does not notify Android** (comment: notifying would re-trigger autosave and
   re-migrate images into duplicates).

If the entry does not exist: `Toast "该日记不存在或已被删除"` and `onBack()`.

### 2.6 Unsaved-changes / save lifecycle

There is **no dirty flag**. Correctness comes from three mechanisms:

1. **Content autosave** — `bridge.content.debounce(350).collectLatest { saveLatestContent() }`.
   350 ms after the last `onContentChanged`.
2. **Metadata autosave** — `LaunchedEffect(title, weather, mood, category, hasLoadedEntry)`
   with `delay(350)` then `saveLatestContent()`. Title typing therefore also saves every 350 ms
   of idle.
3. **Snapshot equality** — `lastSavedSnapshot: (title, content, weather, mood, category)`;
   if the new snapshot equals it, `saveEntry` returns early (no DB write).

`saveEntry(content = getCurrentContent(), allowEmptyOverwrite = false)`:
```
saveMutex.withLock {
  if (!hasLoadedEntry) return true                     // entry still loading
  if (entry == null && !hasMeaningfulChanges) return true   // nothing to persist
  if (!allowEmptyOverwrite && wouldEmptyOverwrite(content)) return true  // silent skip
  baseEntry = entry ?: createDraftEntry()              // draft gets a fresh UUID
  bridge.currentEntryId = baseEntry.id
  if (snapshot == lastSavedSnapshot) return true
  savedEntry = viewModel.saveEntry(baseEntry.copy(...), refreshStatistics = entry == null)
  entry = savedEntry; bridge.currentEntryId = savedEntry.id
  displayContent = toDisplayableHtml(savedEntry.content)   // DB has journal-media://, page has data:
  lastSavedSnapshot = snapshot.copy(content = displayContent)
  if (displayContent != snapshot.content) bridge.setContent(savedEntry.content)  // re-render if rep changed
}
```
`hasMeaningfulChanges(content)`: `title.isNotBlank() || content.isNotBlank() ||
weather != SUNNY || mood != HAPPY || category != DAILY`.

`createDraftEntry()` default title: `"${year}年${month}月${day}日 ${dayOfWeek}"` with
`星期一 … 星期日`, e.g. `2026年11月14日 星期六`.

**Exit save** (`BackHandler(enabled = !showEmptyOverwriteDialog && !isSaving)` → `saveAndExit()`,
also the top-bar back button):
```
if (isSaving || showEmptyOverwriteDialog) return
content = bridge.getContentForSave()            // getContent() with 2 s timeout, falls back to _content
if (wouldEmptyOverwrite(content)) { pendingEmptyExitContent = content; showEmptyOverwriteDialog = true; return }
isSaving = true
saveEntry(content, allowEmptyOverwrite = false)
   -> onBack()            on success
   -> isSaving=false; Toast "保存失败，请检查存储空间后重试"
```

**Empty-content protection** (the guard against a WebView render race wiping an entry):
```
protectedContent() = lastSavedSnapshot?.content ?: entry?.content.orEmpty()
wouldEmptyOverwrite(c) = isBlankEditorHtml(c) && !isBlankEditorHtml(protectedContent())
```
`isBlankEditorHtml(html)` — deliberately conservative:
`blank → true`; contains `journal-sticker` → false; `<img` → false; `doodle-data` → false;
`journal-media://` → false; else strip `<br>`s, replace `&nbsp;` with space, strip all tags,
strip `\u200B`, `trim()` and test emptiness.

Dialog (exact strings):

- title: `即将覆盖为空内容`
- body: `检测到整篇手账即将被覆盖为空内容，如果您没有这么做，很抱歉应用可能在保存手账时出现了问题。如果点按继续保存按钮，手账将会被空内容覆盖。点按取消按钮，则应用将保护本手账条目内容，不保存即退出。如果清空手账不是您的意图，请点击“取消”。`
- confirm: `继续保存` (error colour) → `confirmEmptyOverwriteAndExit()` →
  `saveEntry(pendingEmptyExitContent, allowEmptyOverwrite = true)` then `onBack()`
- dismiss: `取消` → `cancelEmptyOverwriteAndExit()` → `forceRestoreProtectedEntry()` writes the
  protected snapshot back to the DB, then `onBack()`. Failure →
  `Toast "恢复手账失败，请重试"`.
- `onDismissRequest` maps to the **cancel** path (tap-outside = protect, never overwrite).

**Background save**: `DisposableEffect(lifecycleOwner)` observes `ON_STOP` and, when
`!isSaving`, launches `saveLatestContent()` (`allowEmptyOverwrite = false`, so a blank page can
never clobber). `onDispose` removes the observer and calls `bridge.destroy()`
(`bridgeScope.cancel()` + `webView.destroy()`).

### 2.7 State Android keeps

| Field | Type | Purpose |
|---|---|---|
| `_content` | `MutableStateFlow<String>` | last HTML from JS, also updated synchronously by `setContent`/`setPendingContent` |
| `_doodleState` | `MutableStateFlow<String>` | `"{}"` default; `getDoodleState()` JSON |
| `currentEntryId` | `String?` | target media folder; set from draft/loaded/saved entry |
| `pageLoaded` | Boolean | gates `evaluateJavascript` vs pending queues |
| `pendingContent` / `pendingThemeJs` / `pendingEditorSettingsJs` | String? | one-slot pre-load queues |
| `isDoodleMode`, `stickerGestureActive` | Boolean | touch interception + gesture exclusion |

## 3. Compose UI spec (exact labels)

Scaffold: `Modifier.fillMaxSize().imePadding()`, `containerColor = colorScheme.background`,
`TopAppBar` container `colorScheme.surface`, bottom `Surface`
(`RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp)`, `tonalElevation = 4.dp`,
`shadowElevation = 10.dp`) wrapping a transparent `NavigationBar`.

### 3.1 Top bar

| Element | Spec |
|---|---|
| Back | `IconButton`, `Icons.AutoMirrored.Filled.ArrowBack`, `contentDescription = "返回并保存"`, `enabled = !isSaving`, tint `onSurface`, onClick `saveAndExit` |
| Title | `BasicTextField`, `singleLine`, bold, `16.sp` if `windowSize.isCompact` else `18.sp`, `fillMaxWidth`, placeholder `标题` at `onSurfaceVariant α 0.68`, `maxLines = 1`, ellipsis |
| Actions | one `IconButton` showing `WeatherIcon(selectedWeather, 18.dp)` + `MoodIcon(selectedMood, 18.dp)`, both `colorScheme.primary`, 2 dp gap. onClick sets `showMetaMenu = true`, `currentToolbar = "none"`, `bridge.toggleDoodleMode(false)` |

Meta `DropdownMenu` (3 items):
1. `天气：${selectedWeather.displayName}` with weather icon → opens weather sheet
2. `心情：${selectedMood.displayName}` with mood icon → opens mood sheet
3. `分类` with `Icons.Filled.Dashboard` → opens category sheet

No save/delete/undo action in the top bar. There is no delete-entry affordance on this screen.

### 3.2 Metadata sheets (`ModalBottomSheet`, drag handle, `surface`)

Weather — title `选择天气`; `Weather.selectableEntries` = `晴天 / 阴天 / 雨天 / 夜晚`
(`SUNNY, CLOUDY, RAINY, NIGHT_CLEAR`); `FilterChip` with icon, 20 dp, centred `FlowRow`,
8 dp gaps, 24 dp bottom spacer. Legacy `SNOWY("雪天")` normalises to `CLOUDY`.

Mood — title `记录此刻心情`; `Mood.selectableEntries` = `开心 / 无感 / 伤心`
(`HAPPY, CALM, SAD`); legacy `EXCITED/PROUD → HAPPY`, `EMOTIONAL → CALM`.

Category — title `日记分类`; horizontal-scrolling chips over
`Category.entries.filter { it != ALL }` with labels
`DAILY → 日常`, `WORK → 工作`, `GOAL → 目标`, `INSPIRATION → 灵感`, `EMOTION → 情绪`
(fallback `category.name`).

Selecting a chip calls `dismissEditorSheet()`:
`showWeatherPicker = false; showMoodPicker = false; showCategoryPicker = false;
if (currentToolbar == "doodle") bridge.toggleDoodleMode(false); currentToolbar = "none"`.
Sheet horizontal padding `windowSize.sheetHorizontalPadding`.

### 3.3 Bottom `NavigationBar` (4 items, always visible, fixed height)

| # | Label (`10.sp`) | Icon | `contentDescription` | Selected state | onClick |
|---|---|---|---|---|---|
| 1 | `文字` | `Icons.Filled.TextFields` | `文字` | `currentToolbar == "text"` | toggle `text`/`none`; close sheets; `if (currentToolbar != "doodle") toggleDoodleMode(false)` |
| 2 | `涂鸦` | `Icons.Filled.Brush` | `涂鸦` | `currentToolbar == "doodle"` | toggle `doodle`/`none`; close sheets; `toggleDoodleMode(currentToolbar == "doodle")` |
| 3 | `照片` | `Icons.Filled.AddPhotoAlternate` | `照片` | never (`false`) | `imageLauncher.launch("image/*")` directly |
| 4 | `贴纸` | `Icons.Filled.AutoAwesome` | `贴纸` | `currentToolbar == "sticker"` | toggle `sticker`/`none`; close sheets; `if (currentToolbar != "doodle") toggleDoodleMode(false)` |

Item colours: `selectedIconColor`/`selectedTextColor` = `primary`,
`indicatorColor = primary α 0.12`, indicator from `NavigationBarItemDefaults`.

The three overlay panels are `AnimatedVisibility(visible  = currentToolbar == "…",
Modifier.align(BottomCenter).zIndex(2f), enter = slideInVertically { it } + fadeIn(),
exit = slideOutVertically { it } + fadeOut())`, rendered **over** the WebView inside the content
`Box` (WebView is `matchParentSize().zIndex(0f)`).

### 3.4 `TextToolbarPanel` (Card, radius 20 dp, elevation 8 dp, padding 10/12 dp)

Row 1 (horizontal scroll, 6 dp gaps) — `FormatButton` = `OutlinedButton` 40 dp, radius 8 dp,
text `16.sp`:

| Label | Style | Command |
|---|---|---|
| `B` | bold | `bold` |
| `I` | italic | `italic` |
| `U` | underline | `underline` |
| `S` | strikethrough | `strikeThrough` |
| – | `Icons.Filled.FormatAlignLeft` | `justifyLeft` |
| – | `Icons.Filled.FormatAlignCenter` | `justifyCenter` |
| – | `Icons.Filled.FormatAlignRight` | `justifyRight` |
| – | `Icons.Filled.Undo` | `undo` |
| – | `Icons.Filled.Redo` | `redo` |

`SmallIconButton` = `IconButton` 36 dp, icon 18 dp, tint `onSurfaceVariant`, no
`contentDescription`.

Row 2 — font `FilterChip`s (`12.sp`): `手写体` → `handwrite`, `宋体` → `serif`,
`黑体` → `sans-serif`; size chips: `小` → `"2"`, `中` → `"3"`, `大` → `"5"`.
Local state starts `selectedFont = "handwrite"`, `selectedSize = "3"`.

Row 3 — 12 colour dots, 28 dp circles, 4 dp gaps, click → `bridge.changeColor`:
`#333333 #666666 #FF6B6B #FFB6C1 #FF8C42 #FFD93D #6BCB77 #4D96FF #9B59B6 #1ABC9C #E91E63 #795548`.

Panel is hidden via `onHide = { currentToolbar = "none" }` (no visible close button).

### 3.5 `DoodleToolbarPanel`

Brush chips (`BrushChip` = `FilterChip`, `12.sp`), selected brush starts as `pencil`:

| Chip | Tool | Size range | Default |
|---|---|---|---|
| `铅笔` | `pencil` | 0–5 | 2 |
| `钢笔` | `pen` | 0–5 | 2 |
| `马克笔` | `marker` | 5–25 | 12 |
| `水彩` | `watercolor` | 5–25 | 12 |
| `荧光笔` | `highlighter` | 5–25 | 12 |
| `橡皮擦` | `eraser` | 1–30 | 12 |

`selectBrush(brush)`: if the current `brushSize` falls outside the new range, reset to that
range's default; then `setBrush(brush)` + `setBrushSize(format)` where
`formatBrushSize(v) = String.format(Locale.US, "%.2f", v).trimEnd('0').trimEnd('.')`.
Local `brushSize` starts at `2f`.

Slider row: label `粗细` (`12.sp`, `onSurfaceVariant`), `Slider` over the current range,
numeric readout in a 34 dp box, `12.sp`, centre-aligned, same format.

Colours (24 dots, 28 dp, click → `setBrushColor`; `#FFFFFF` gets an extra 1 dp
surfaceVariant ring so it is visible):
`#000000 #333333 #666666 #FF0000 #FF6B6B #FFB6C1 #FF8C42 #FFD93D #6BCB77 #4D96FF #9B59B6 #1ABC9C #E91E63 #795548 #00BCD4 #CDDC39 #FF69B4 #8B4513 #2E8B57 #4169E1 #FF4500 #DA70D6 #20B2AA #FFFFFF`

Buttons, row A (3 × `OutlinedButton`, weight 1, `12.sp`, `maxLines = 1`, 8 dp padding):
`撤销` → `undoDoodle()`, `重做` → `redoDoodle()`, `清除` → `clearDoodle()`.

Buttons, row B: `导出` (`OutlinedButton`) → `insertDoodleImage()` **then**
`Toast "已将涂鸦导出为图片插入正文"`; `确认` (`Button`) → `mergeDoodle()` then `onHide()`
(which also runs `toggleDoodleMode(false)` in the screen callback).

### 3.6 `StickerPanel`

Header row: `选择贴纸` (bold) + `TextButton "完成"` → `onHide`.

`OutlinedButton` full width, radius 12 dp, `AddPhotoAlternate` 18 dp + 8 dp gap +
label `导入贴纸` → `ActivityResultContracts.GetContent("image/*")` → `bridge.insertCustomSticker(uri)`.

When the library is non-empty:
- `已导入贴纸` (`13.sp`, SemiBold)
- `长按可从库中删除` (`11.sp`, `onSurface α 0.55`)
- grid of `windowSize.stickerColumns` columns, cells `windowSize.stickerCell`, radius 12 dp,
  `surfaceVariant α 0.35`, thumbnail inset 6 dp, placeholder `Icons.Filled.Image`,
  `contentDescription "已导入贴纸"`; **click** → `bridge.insertUserSticker(id)`,
  **long-press** → delete dialog.
- Delete dialog: title `删除已导入贴纸`, body
  `仅从贴纸库移除，不会删除日记里已经贴上的贴纸。`, confirm `删除` → `bridge.deleteUserSticker(id)`
  + refresh, dismiss `取消`.

Then `内置贴纸` (`13.sp`, SemiBold) and 20 emoji cells (`windowSize.stickerEmojiSp`), click →
`bridge.insertSticker(name)`:

`heart ❤️`, `star ⭐`, `smile 😊`, `flower 🌸`, `sun ☀️`, `moon 🌙`, `cloud ☁️`, `rain 🌧️`,
`snow ❄️`, `leaf 🍃`, `cat 🐱`, `dog 🐶`, `bird 🐦`, `fish 🐟`, `cake 🎂`, `coffee ☕`,
`book 📖`, `music 🎵`, `sparkle ✨`, `ribbon 🎀`.

Library refresh: `DisposableEffect(bridge)` installs `bridge.onUserStickersChanged = { refresh }`
(cleared on dispose); also refreshed manually after delete. Imported thumbnails are decoded with
`BitmapFactory.decodeFile(item.file.absolutePath)` keyed by `(item.id, file.lastModified())`.

### 3.7 Image preview dialog

`AlertDialog` with a single `TextButton "关闭"`. Body is an `AndroidView(ImageView)`:
`file://…` → `setImageURI`, otherwise base64 after the comma → `BitmapFactory.decodeByteArray`
→ `setImageBitmap`; `adjustViewBounds = true`, `ScaleType.FIT_CENTER`, height
`windowSize.imagePreviewHeight`. Errors log `IMAGE_PREVIEW_FAILED`.

### 3.8 Toast strings

| String | Trigger |
|---|---|
| `该日记不存在或已被删除` | `getEntryById` returned null |
| `图片插入失败，请重试` | `onImageInsertFailed` (open stream / decode / OOM) |
| `保存失败，请检查存储空间后重试` | `saveAndExit` / confirm path returned false |
| `恢复手账失败，请重试` | `forceRestoreProtectedEntry` failed |
| `已将涂鸦导出为图片插入正文` | doodle `导出` |

## 4. WebView content format

### 4.1 Page skeleton (`editor.html`, UTF-8, viewport locked)

```html
<div id="paper" contenteditable="true" spellcheck="false"></div>
<canvas id="doodle-canvas"></canvas>
<button id="sticker-delete-btn" type="button" aria-label="删除贴纸" title="删除">×</button>
<script src="vendor/atrament.js"></script>
<script src="vendor/rough.js"></script>
<script src="vendor/moveable.min.js"></script>
<script src="editor.js"></script>
```

`<title>祈 - 编辑器</title>`, `lang="zh-CN"`,
`viewport = width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no`.
The page is a fixed-height document: `html, body { overflow: hidden }`, and `#paper` is
`position:absolute; inset:0; overflow-y:auto` so **the WebView itself never scrolls** — `#paper`
does.

### 4.2 CSS tokens and page background (exact)

```css
:root{
  --bg-color:#FAF7F2; --paper-bg-start:#FFF8F0; --paper-bg-mid:#FFFDF7;
  --paper-bg-end:#FFF8F0; --text-color:#333333; --line-color:rgba(0,0,0,0.03);
  --editor-font-size:16px; --keyboard-inset:0px;
}
#paper{
  padding:28px clamp(20px,5vw,32px) calc(40px + var(--keyboard-inset));
  scroll-padding:28px 0 calc(40px + var(--keyboard-inset));
  font-size:var(--editor-font-size); line-height:1.9; letter-spacing:0.015em;
  background-color:var(--paper-bg-mid);
  background-image:
    repeating-linear-gradient(to bottom, transparent 0, transparent calc(1.9em - 1px),
      var(--line-color) calc(1.9em - 1px), var(--line-color) 1.9em),
    linear-gradient(145deg, var(--paper-bg-start) 0%, var(--paper-bg-mid) 52%, var(--paper-bg-end) 100%);
  background-attachment:local;
}
```

Ruled lines are locked to `1.9em`, so changing `--editor-font-size` moves the lines with the
text. `#paper:empty::before { content:'写下此刻的心情…'; opacity:0.32 }` is the placeholder;
selection `rgba(128,128,128,0.24)`.

`applyTheme(...)` overwrites `--bg-color`, `--text-color`, `--paper-bg-start/-mid/-end`,
`--line-color` on `documentElement`. The Compose caller passes `bgColor = colorScheme.background`,
`textColor = onBackground`, all three paper stops `= colorScheme.surface`, and
`lineColor = "rgba(255,255,255,0.05)"` in dark mode / `"rgba(0,0,0,0.03)"` in light mode.
`applyEditorSettings(n)` sets `--editor-font-size: clamp(n,12,28)px`.

### 4.3 Font loading

```css
@font-face{
  font-family:'handwrite';
  src:url('../fonts/LXGWWenKai-Regular.ttf') format('truetype');
  font-display:swap;
}
body{ font-family:'handwrite', cursive, sans-serif; }
```
The relative path escapes `assets/editor/` to `assets/fonts/`, so **the `editor/` and `fonts/`
sibling layout must be preserved** in the RN asset tree. `changeFont` maps
`handwrite → 'handwrite, serif'`, `serif → 'serif, Songti SC, SimSun'`,
`sans-serif → 'sans-serif, PingFang SC, Microsoft YaHei'` and applies it via
`document.execCommand('fontName', …)`.

### 4.4 Sticker node markup (`.journal-sticker`)

Emoji sticker:
```html
<span class="journal-sticker" contenteditable="false" data-sticker-id="stk_lq3k9d_x8f2a1"
      data-sticker-kind="emoji" data-rotate="0" data-left="128" data-top="96"
      style="width:72px;height:72px;display:flex;position:absolute;left:128px;top:96px;float:none;margin:0;transform:rotate(0deg);transform-origin:center center">
  <span class="journal-sticker__emoji">❤️</span>
</span>
```
Image sticker: same shell, `data-sticker-kind="image"`, size `112px`, child
`<img class="journal-sticker__media" src="data:image/png;base64,…" alt="sticker" draggable="false">`.

Positioning contract (this *is* the persisted format):

| Attribute / style | Meaning |
|---|---|
| `data-sticker-id` | `stk_<base36 time>_<6 random base36>`; regenerated if missing on load |
| `data-sticker-kind` | `emoji` \| `image`; inferred from `.journal-sticker__media` presence if missing |
| `data-left` / `data-top` | authoritative px coordinates (rounded to 2 dp) inside `#paper`, relative to the paper content box, **scroll-independent** |
| `style.left/top` | mirror of `data-left/top`, same units |
| `style.width/height` | px; emoji default 72, custom image default 112, min 36 when resized |
| `data-rotate` + `style.transform` | degrees, `rotate(<deg>deg)`, `transform-origin:center center` |
| `style.zIndex` | base 5; selected `max+1`; dragging 40; `.is-selected` CSS 30 |
| `contenteditable="false"` | never edited as text |

Clamp rules (`clampStickerPosition`): `left ∈ [0, max(0, paper.clientWidth - max(24, width*0.35))]`,
`top ∈ [0, max(paper.scrollHeight, paper.clientHeight) + 400]`.
Insert default: `x = paper.scrollLeft + max(16, (paper.clientWidth - size)/2)`,
`y = paper.scrollTop + max(24, paper.clientHeight*0.28)`.
`ensurePaperFitsStickers()` grows `#paper.style.minHeight` to `max(bottom + 48)` and re-runs
`resizeDoodleCanvas()`.

Legacy `.inserted-sticker` nodes are upgraded on every `bindStickerHandlers()` call: emoji taken
from `textContent` (fallback `★`), rebuilt as a `.journal-sticker`, position derived from its
`getBoundingClientRect()` converted to paper-local coordinates.

Selection / deletion UI: `#sticker-delete-btn` (28 dp, `#e53935`, white 2 dp ring, fixed) is
positioned at `right-10 / top-14` of the selected sticker, hidden while the doodle canvas is
active. `paper` `pointerdown` outside any sticker → deselect. `keydown Backspace/Delete` deletes
the selected sticker, `Escape` deselects. `data-sticker-bound` is **never** persisted (a WeakSet
tracks bound nodes) — it broke re-binding after `setContent`.

### 4.5 Inserted image markup

```html
<img class="inserted-image" src="data:image/jpeg;base64,…"
     style="max-width:100%;display:block;cursor:pointer">
```
Plus, for doodle exports: `class="inserted-image doodle-export"` with `style.maxWidth='100%'`
and `cursor:pointer` (doodle export keeps the live canvas PNG, no data attributes).
CSS: `.inserted-image{max-width:100%;border-radius:8px;margin:8px 0;
box-shadow:0 2px 8px rgba(0,0,0,0.1)}`.

`bindImageClick` attaches `onclick` that posts `src` to `AndroidBridge.onImageClicked`;
sticker media (`img.journal-sticker__media`, or any img inside a `.journal-sticker`) is skipped.
Insertion is `insertNodeAtSelection` → `range.deleteContents(); range.insertNode(node);
range.setStartAfter(node); collapse; saveSelection(); node.scrollIntoView({block:'nearest'})`,
falling back to `paper.appendChild(node)` when the caret is outside `#paper`.

### 4.6 Doodle data node

```html
<div class="doodle-data" contenteditable="false" data-doodle-json="%7B%22version%22%3A1,…%7D"></div>
```
`.doodle-data { display:none !important }`. Appended as the **last child** of `#paper` when
strokes exist, removed when the last stroke is cleared. The JSON is stored
`encodeURIComponent`-encoded in `data-doodle-json` (keeps quotes/braces out of the attribute).
`extractDoodleDataNode()` runs on every `setContent`, decoding it into the live canvas; a
missing/corrupt node resets to an empty doodle (`loadDoodleJson('')`).

### 4.7 Text styles produced by the formatting commands

- `bold`/`italic`/`underline`/`strikeThrough` → execCommand's `<b>/<i>/<u>/<strike>` (browser-dependent).
- `changeSize` uses `execCommand('fontSize', false, n)` then, 50 ms later,
  `normalizeFontTags()` rewrites **every** `<font>` in reverse document order into
  `<span style="font-size:…;font-family:…;color:…">`, preserving existing inline styles:
  `1→12px 2→14px 3→16px 4→18px 5→20px 6→22px 7→24px` (unknown → `16px`).
- `changeFont` → `<font face="handwrite, serif">` etc.
- `changeColor` (`foreColor`) → `<font color="#RRGGBB">`, folded into `<span style>` by the same
  normaliser if a size change follows.

### 4.8 Sanitizer applied on every `setContent`

`sanitizeEditorHtml` runs the incoming HTML through `<template>` then:
1. removes `script,iframe,object,embed,link,meta,base,form,input,button,textarea,select,foreignObject`;
2. per element, removes attributes that: start with `on`, equal `srcdoc`, are
   `src|href|xlink:href` with a `javascript:` value, are `src|href|xlink:href` starting with
   `file://` **without** `/journal_media/` in the path, or are `style` containing `url(` or
   `expression(`.

Consequences for the port: `file://` media URLs pointing outside `journal_media` are stripped by
the page itself, and `<button>`/`<input>` cannot be persisted. Content must round-trip through
`sanitizeEditorHtml`, so always load via `setContent(html)`, never by assigning `innerHTML`
from the host.

### 4.9 `getContent()` output contract

`paper.innerHTML` after `syncDoodleDataNode()` and removing every `data-sticker-bound`
attribute. This is the string stored in `JournalEntry.content` (after native
`migrateInlineImages`). It is **not** a fragment with a wrapping element — `#paper`'s own
attributes are not included, and there is no `<html>/<body>`.

## 5. Media pipeline

### 5.1 Directory layout (`filesDir`)

```
filesDir/
  journal_media/                     ← JournalMediaStore.ROOT_DIR_NAME
    <entryId>/                       ← isSafeEntryId: [A-Za-z0-9_-]{1,128}
      1785556800000_<uuid>.jpg       ← System.currentTimeMillis() + "_" + UUID.randomUUID() + "." + ext
      1785556800123_<uuid>.png
  user_stickers/                     ← UserStickerStore.ROOT_DIR_NAME
    <millis>_<8-char-uuid>.png|jpg|webp|gif   ← id = filename without extension
```

Entry ids come from `UUID.randomUUID().toString()` (drafts) or the DB primary key. File names
must match `[A-Za-z0-9._-]{1,200}` (media) / `[A-Za-z0-9._-]{1,255}` (stickers).

### 5.2 Image insert flow (exact)

1. Bottom bar `照片` or `AndroidBridge.requestImageInsert()` →
   `ActivityResultContracts.GetContent("image/*")`.
2. Callback: `entry ?: createDraftEntry()` (a draft is created and adopted immediately);
   `bridge.currentEntryId = entry.id`; `bridge.insertImage(uri)`.
3. `insertImage` opens the `InputStream` **synchronously on the picker thread** (the URI grant is
   transient), then on `bridgeScope` (Main) reads bytes on IO, requires non-empty.
4. `compressImageBytes(bytes, maxSizePixels = 1_500_000, quality = 75)`:
   `inJustDecodeBounds` → `inSampleSize` (powers of 2 up to `sqrt(total/max)`) → decode →
   if still `> maxSizePixels`, scale by `sqrt(max/current)` → `Bitmap.compress(JPEG, quality)`.
5. `mediaStore.saveImage(entryId, jpegBytes, "jpg")` (writes the file — see the orphan note in
   §5.7) and `toJpegDataUri(bytes)` = `"data:image/jpeg;base64," + Base64.NO_WRAP`.
6. `evaluateJavascript("insertImage(\"data:image/jpeg;base64,…\")")` → JS inserts the `<img>`
   at the caret and notifies `onContentChanged`.
7. On `OutOfMemoryError`, retry once with `maxSizePixels = 500_000, quality = 50`; any other
   failure → `IMAGE_PROCESSING_FAILED` + `onImageInsertFailed` → `Toast "图片插入失败，请重试"`.

### 5.3 Two representations of the same content

| Representation | Where | Form |
|---|---|---|
| Display HTML | WebView + `bridge.content` + `lastSavedSnapshot.content` | images as `data:image/…;base64,…` |
| Stored HTML | DB (`JournalEntry.content`) | images as `journal-media://local/<entryId>/<fileName>` |

`editorMediaUri(entryId, fileName) = "journal-media://local/<entryId>/<fileName>"`
(scheme `journal-media`, host `local`).

`toDisplayableHtml(html)` (called by `setContent`, `setPendingContent`, `saveEntry` bookkeeping):
1. `journal-media://local/<entryId>/<file>` (regex `journal-media://local/([^/"'<>]+)/([^"'<>]+)`,
   both parts validated) → `fileToDataUri(File(entryDir(entryId), fileName))`
   (`data:<mime>;base64,` with `Base64.NO_WRAP`; empty/unreadable file leaves the URL as-is);
2. `file://…` (regex `file://[^\s"'<>]+`) → data URI **only if** the canonical path is under
   `journal_media/`; otherwise untouched.

`mimeTypeForExtension`: `jpg|jpeg→image/jpeg`, `png→image/png`, `gif→image/gif`,
`webp→image/webp`, `svg→image/svg+xml`, else `application/octet-stream`.

### 5.4 Inline base64 migration on save (`migrateInlineImages`)

`JournalViewModel.saveEntry` calls `mediaStore.migrateInlineImages(entry.id, entry.content)`
before `repository.insert`, and `getEntryById` calls it on read (migrating legacy rows once and
re-inserting them). Implementation:

```kotlin
if (!html.contains("data:image/")) return html
DATA_IMAGE_REGEX = Regex("""data:image/([a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/=\r\n]+)""")
replace each match:
  ext = subtype.lowercase() ("jpeg"→"jpg", "svg+xml"→"svg")
  bytes = Base64.decode(b64, DEFAULT) ?: leave the match untouched
  file  = saveImage(entryId, bytes, ext)     // new UUID name each time
  → editorMediaUri(entryId, file.name)
```
So: **the DB never stores base64**, the WebView always renders base64, and each save that still
sees a `data:` URI writes a *new* file (names are timestamp+UUID, so repeated saves of an
unmigrated document leak files — see §5.7).

### 5.5 Backup mapping (`JournalBackupManager`)

`toBackupHtml`: `journal-media://local/<entry>/<file>` → `media/<entry>/<file>`, and in-root
`file://` → `media/<parent>/<file>`. Media files are collected via `referencedMediaFiles(html)`
(union of `journal-media://` refs and in-root `file://` refs) and zipped under `media/…`.
Import: copy staged media into `entryDir(entry.id)/<fileName>`, `restoreBackupHtml`
(`media/<entry>/<file>` → `journal-media://local/<entry>/<file>`), then `migrateInlineImages`.
Stickers: `allFilesForExport()` (flat `user_stickers/*`) /
`importFromBackupFile(fileName, bytes)` (skip if exists; reject > 512 KB).
Backups keep doodle data automatically because they serialise full HTML.

### 5.6 Sticker import constraints (`UserStickerStore`)

- `MAX_STICKER_BYTES = 256 * 1024` (256 KB).
- `importSticker(sourceBytes, maxBytes)`:
  `compressUnderLimit` loops **8 times**: start `maxPixels = 512_000`, `quality = 85`; if the
  encoding exceeds 256 KB, `maxPixels *= 0.65` (floor 40 000) and `quality -= 10` (floor 40).
  Last resort `encodeOnce(40_000 px, quality 40)`; returns null if still too large.
- `encodeOnce`: `inSampleSize` (powers of 2) → scale to `maxPixels` → **PNG (quality 100) when
  the bitmap has alpha**, flattening to JPEG only if the PNG still exceeds 256 KB; otherwise
  JPEG at `quality`.
- Persisted name `"${millis}_${uuid.take(8)}.${ext}"`; id = name without extension.
- `listStickers()` sorts by `lastModified()` **descending**; extensions map
  `png/webp/gif → image/*`, everything else `image/jpeg`.
- `fileToDataUri` hard-fails outside the root (`isUnderRoot`) and on empty files.

`EditorBridge.insertCustomSticker(uri)` (import-from-device): decode → `importSticker` into the
library → **also** `mediaStore.saveImage(entryId, itemBytes, item.extension)` (so entry backups
carry the sticker) → `onUserStickersChanged` → `insertCustomSticker(dataUri)` → JS builds a
112 px image sticker.

`EditorBridge.insertUserSticker(stickerId)` (library tap): read library file → data URI → copy
file bytes into the current entry's media dir (best-effort) → `insertCustomSticker(dataUri)`.

### 5.7 Deletion & lifecycle

- Delete a journal entry: `repository.delete` + `mediaStore.deleteEntryMedia(entryId)`
  (`deleteRecursively`, guarded by `canonical.parentFile == mediaRoot`).
- Delete a library sticker: `deleteSticker(id)` removes every `user_stickers/<id>.<ext>`; **does
  not** touch stickers already inserted into entries (that copy lives in the entry media dir or,
  if unsaved, only as base64 in the document).
- `deleteEntryMedia` is never called when an entry is emptied — media files referenced by a
  removed `<img>` become orphans.
- **Known leak**: `insertImage`/`insertCustomSticker` write a media file whose name is never
  referenced by the HTML (the page embeds base64; the save-time `migrateInlineImages` writes a
  *second* file). Only save-time names ever appear in `journal-media://` URLs.

## 6. Doodle engine

### 6.1 Initialisation

`DOMContentLoaded` → `initialiseDoodle()`: `canvas = #doodle-canvas` → `resizeDoodleCanvas()` →
`createAtrament()` → `applyBrushOptions()`.

```js
new Atrament(canvas, {
  color: brush.color, width: canvas.width, height: canvas.height,
  weight: brush.size, smoothing: 0.85, adaptiveStroke: true,
  mode: doodle.active ? atramentModeForTool(tool) : MODE_DISABLED,
  secondaryMouseButton: true, recordStrokes: true
});
atrament.addEventListener('strokerecorded', ({stroke}) => handleRecordedStroke(stroke));
atrament.addEventListener('dirty', notifyDoodleStateChanged);
roughCanvas = rough.canvas(canvas);   // null-safe if window.rough missing
```
`MODE_DISABLED|DRAW|ERASE` are read from `window.ATRAMENT_MODE_*` with fallbacks
`'disabled'|'draw'|'erase'`.

### 6.2 Canvas sizing / DPR / scroll

`resizeDoodleCanvas()`:
```
ratio  = devicePixelRatio || 1
width  = floor(innerWidth * ratio)
height = ceil(max(innerHeight, paper.scrollHeight) * ratio)
canvas.width/height = those (backing store)
canvas.style.width  = innerWidth + 'px'
canvas.style.height = max(innerHeight, paper.scrollHeight) + 'px'
syncDoodleCanvasScroll(); queueDoodleRender();
```
`syncDoodleCanvasScroll()` → `canvas.style.transform = translateY(-paper.scrollTop)px`.
The canvas is `position:fixed; inset:0; pointer-events:none; z-index:10; touch-action:none;
will-change:transform`, and gets `pointer-events:auto` only while `.active`. So strokes use
**CSS pixels** (drawing ctx is scaled by `ratio` in `redrawDoodle`), and the canvas slides with
the paper scroll while its height tracks the content height.

Resize triggers: `window.resize`, `paper` `input`, `ensurePaperFitsStickers()`, and a
`requestAnimationFrame` after `setContent`.

### 6.3 Tools and presets

`BRUSH_PRESETS` (single source of truth, mirrored by the Compose panel):

| tool | roughness | min | max | default |
|---|---|---|---|---|
| `pencil` | 0.35 | 0 | 5 | 2 |
| `pen` | 0.5 | 0 | 5 | 2 |
| `watercolor` | 0.25 | 5 | 25 | 12 |
| `marker` | 0.25 | 5 | 25 | 12 |
| `highlighter` | 0.25 | 5 | 25 | 12 |
| `eraser` | 0 | 1 | 30 | 12 |

`setBrush(tool)` sets `currentTool`, resets `roughness` from the preset and **clamps** the current
size into the preset range. `setBrushSize` parses a float and clamps. `setBrushColor` stores
`#RRGGBB`. `setBrushRoughness` is an intentional **no-op** (roughness is tool-derived) that only
re-notifies state. `applyBrushOptions()` pushes `color`, `effectiveBrushSize(size)`
(`max(0.1, …)`), `smoothing`, `adaptiveStroke`, and `mode` (draw/erase only when active) into
Atrament.

### 6.4 Recording, schema, eraser

`handleRecordedStroke(stroke)` requires `stroke.segments.length > 0`. Eraser path
(`stroke.mode === MODE_ERASE || currentTool === 'eraser'`): push history →
`applyStructuredErase` (destructive: splits every stored stroke where any point falls within
`radius = max(effectiveBrushSize(weight) * 1.15, 6)` of any eraser point, keeping chunks with
`> 1` point and suffixing ids `-erase-<ts>-<i>`) → clear redo → `redrawDoodle()` →
`persistDoodleChange()` → `notifyDoodleStateChanged()`.

Drawing path: push history → `doodle.strokes.push(normalizeStroke(stroke))` → clear redo →
`queueDoodleRender()` → `persistDoodleChange()` → `notifyDoodleStateChanged()`.

`normalizeStroke` → the persisted schema (`docs/doodle-engine.md` §Data Schema):
```json
{ "id":"1785556800000-k3f9a1", "type":"stroke", "tool":"pencil",
  "points":[{"x":12.5,"y":18.25,"time":0,"pressure":0.5}],
  "color":"#000000", "width":3, "roughness":1.4,
  "atramentOptions":{"smoothing":0.85,"adaptiveStroke":true},
  "createdAt":1785556800000 }
```
Coordinates are rounded to 2 dp; `width`/`roughness`/`smoothing`/`pressure` also rounded;
`tool` is `pencil` whenever the eraser produced the record.

### 6.5 Rendering

`queueDoodleRender()` coalesces into one `requestIdleCallback` (fallback
`setTimeout 16`) → `redrawDoodle()`:
1. clear the whole backing store with an identity transform (`source-over`, alpha 1, no dashes);
2. `ctx.setTransform(ratio,0,0,ratio,0,0)` and render every stroke;
3. `syncDoodleDataNode()`.

`renderStroke`: `simplifyPoints(points, 0.8)` (keep first/last, drop points closer than 0.8 px),
skip if `< 2` points, then
```js
roughCanvas.curve([[x,y],…], {
  stroke, strokeWidth: effectiveBrushSize(stroke.width), roughness: stroke.roughness,
  bowing: min(4, 0.8 + stroke.roughness), curveTightness: 0.15,
  disableMultiStroke: stroke.width < 2
})
```
Fallback when `rough.canvas` is unavailable: plain round-cap/round-join polyline.

### 6.6 History

`HISTORY_LIMIT = 40`. Undo/redo stacks hold `JSON.stringify({strokes, bitmapLayers})` (full
snapshots, not patches). `undoDoodle` moves the current state onto redo and `restoreDoodleSnapshot`s
the popped item (which also `persistDoodleChange()` + notifies). `clearDoodle` is a no-op when
already empty, otherwise pushes history, empties both arrays, clears redo.

### 6.7 Mode switching

`toggleDoodleMode(active)`:
```
doodle.active = active; canvas.classList.toggle('active', active);
paper.contentEditable = String(!active);
atrament.mode = active ? atramentModeForTool(currentTool) : MODE_DISABLED;
active  -> deselectSticker(); resizeDoodleCanvas();
           body/documentElement style.overflow = 'hidden'
!active -> overflow = ''; syncDoodleDataNode(); notifyContentChanged()
notifyDoodleStateChanged()
```

### 6.8 Merge / export

- `mergeDoodle()` = `syncDoodleDataNode(); notifyContentChanged();` — it does **not** bake the
  canvas into a PNG. The doodle stays a structured, editable layer stored in the hidden node, so
  "确认" simply commits the doodle into the HTML and closes the panel (the panel's `onHide` also
  disables doodle mode).
- `insertDoodleImage()` = `exportDoodleImage()` (`redrawDoodle()` + `canvas.toDataURL('image/png')`)
  → `<img class="inserted-image doodle-export">` at the caret → notify. This is the "flatten"
  path and creates a normal `data:` image that `migrateInlineImages` converts on save.
- `getDoodleJson()` = `{version:1, canvas:{width:innerWidth, height:innerHeight,
  dpr:devicePixelRatio}, strokes, bitmapLayers, updatedAt}`.

### 6.9 Doodle state JSON (sent to `onDoodleStateChanged`)

```json
{"canUndo":true,"canRedo":false,"dirty":true,"active":true,
 "tool":"pencil","brush":{"color":"#000000","size":2,"roughness":0.35,
 "smoothing":0.85,"adaptiveStroke":true}}
```
Deduplicated against `lastStateJson` before posting. Wiring gap to be aware of: the Compose screen
never reads `bridge.doodleState`, so undo/redo buttons never disable.

## 7. Gesture / touch plumbing (currently native-side)

- `webView.setOnTouchListener`: while `isDoodleMode || stickerGestureActive`, `ACTION_DOWN/MOVE`
  call `parent.requestDisallowInterceptTouchEvent(true)` (so the WebView keeps the gesture);
  on `ACTION_UP/CANCEL` it is re-asserted only while a sticker gesture is active.
- `updateSystemGestureExclusion(view, expandFull)`: API ≥ 29; `expandFull` (sticker gesture
  active) → one full-view rect so system back never fires mid-drag; otherwise two 64 dp
  (`≥ 56 px`) edge strips.
- Recursion guard: `updateSystemGestureExclusion` also runs on `addOnLayoutChangeListener`.

## 8. Porting plan — React Native + `react-native-webview`

Target: `react-native/` (RN 0.88.1, New Arch). `react-native-webview` is **not** a dependency yet
— add it (`package.json`) before starting.

### 8.1 Required assets and destination

Copy the editor bundle verbatim (no edits required, see §8.4):

```
react-native/android/app/src/main/assets/editor/editor.html
react-native/android/app/src/main/assets/editor/editor.css
react-native/android/app/src/main/assets/editor/editor.js
react-native/android/app/src/main/assets/editor/vendor/atrament.js
react-native/android/app/src/main/assets/editor/vendor/rough.js
react-native/android/app/src/main/assets/editor/vendor/moveable.min.js
react-native/android/app/src/main/assets/fonts/LXGWWenKai-Regular.ttf   ← ../fonts/ path from editor.css
react-native/android/app/src/main/assets/fonts/OFL-LXGWWenKai.txt
```

Notes:
- `android/app/src/main/assets/` is merged into the APK by Gradle and served at
  `file:///android_asset/…` — this works in debug and release, and is independent of Metro
  (`bundleInDebug`). Do **not** put these under `react-native/assets/` (Metro would hash-rename
  them and break `vendor/`/`../fonts/` relative paths).
- Mirror to iOS (`ios/Inorinal/editor/…` added as a folder reference in the Xcode project) if iOS
  is in scope; `source={{uri: fileUrl}}` + `allowingReadAccessToURL` pointing at the directory.
- Because the same files exist in the Compose app, they will drift. Add a checksum test
  (`editor.js` sha256) or a Gradle `Copy` task from one canonical directory.
- `atrament.esm.js` is unused; skip it (13 KB).

### 8.2 Loading strategy

Preferred (matches current behaviour exactly):
```jsx
<WebView
  source={{uri: 'file:///android_asset/editor/editor.html'}}
  originWhitelist={['file://*', 'about:blank']}
  allowFileAccess
  allowFileAccessFromFileURLs={false}
  allowUniversalAccessFromFileURLs={false}
  javaScriptEnabled
  domStorageEnabled
  cacheEnabled={false}
  mixedContentMode="never"
  onShouldStartLoadWithRequest={r => r.url === EDITOR_URL}   // mirror shouldOverrideUrlLoading
  ...
/>
```
Avoid `source={{html, baseUrl}}`: it changes the document URL and breaks `../fonts/`
resolution and the `file:///android_asset/` origin, and the bridge reload semantics differ.

Since a custom URL scheme cannot be intercepted from JS/RN (no `shouldInterceptRequest` hook in
`react-native-webview`), the current `journal-media://` + 403-blocking design **cannot be
reproduced as-is**. Two viable replacements:

1. **Data-URI display (recommended, parity)** — keep base64 in the DOM, exactly like
   `toDisplayableHtml` does today. Simple, no native hooks, no origin problems. Cost: HTML size
   (a 1.5 Mpx JPEG ≈ 200–400 KB base64) and memory; mitigate with the lazy loader in §8.4/8.5.
2. **`file://` absolute paths + `allowFileAccessFromFileURLs`** — page at
   `file:///android_asset/...` reading `file:///data/user/0/com.inorinal/files/journal_media/...`.
   Requires enabling file access from file URLs (a deliberate security relaxation; the Compose
   build disabled it on purpose) and still needs a re-render after every save because paths change.

Do **not** attempt `http://localhost` redirect: it would need `blockNetworkLoads`-equivalent
handling and breaks `file://` font loading.

### 8.3 Image URL strategy for the RN port

Keep three distinct forms, as today:

| Layer | Form |
|---|---|
| In-memory / DOM | `data:image/jpeg;base64,…` |
| Persisted (`JournalEntry.content`) | `journal-media://local/<entryId>/<fileName>` (keep the exact string format — old backups/DB rows depend on the regexes) |
| On disk | `filesDir/journal_media/<entryId>/<millis>_<uuid>.<ext>` via `react-native-fs` (`DocumentDirectoryPath`) |

RN-side helpers to write (1:1 with Kotlin):
`toDisplayableHtml(html)` (regex replace `journal-media://local/([^/"'<>]+)/([^"'<>]+)` →
read file → `data:<mime>;base64,`), `migrateInlineImages(entryId, html)`
(`data:image/([a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/=\r\n]+)` → write file → `journal-media://…`),
`referencedMediaFiles`, `toBackupHtml`, `restoreBackupHtml`.
Also keep `isSafeEntryId` `[A-Za-z0-9_-]{1,128}` and `isSafeFileName` `[A-Za-z0-9._-]{1,200}` —
they are the traversal guard.

### 8.4 JS glue to add (no `editor.js` edits needed)

`editor.js` only touches `window.AndroidBridge` through 5 guards, and exposes everything else on
`window`. So inject a shim **before** content load and never fork `editor.js`:

```js
// injectedJavaScriptBeforeContentLoaded  (string, not template-literal-interpolated data)
(function () {
  var post = function (msg) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch (e) {}
  };
  window.AndroidBridge = {
    onContentChanged:      function (html)  { post({v:1, type:'content', html: html}); },
    onDoodleStateChanged:  function (state) { post({v:1, type:'doodleState', state: state}); },
    onImageClicked:        function (src)   { post({v:1, type:'imageClick', src: src}); },
    requestImageInsert:    function ()      { post({v:1, type:'requestImageInsert'}); },
    setStickerGestureActive: function (a)   { post({v:1, type:'stickerGesture', active: !!a}); }
  };
  // fire-and-forget command channel: window[fn](...args)
  window.__rnInvoke = function (fn, args) {
    var f = window[fn];
    if (typeof f !== 'function') { post({v:1, type:'error', message:'missing fn ' + fn}); return; }
    try { f.apply(null, args || []); } catch (e) { post({v:1, type:'error', message:String(e)}); }
  };
  // request/response channel for calls whose return value matters
  window.__rnCall = function (id, fn, args) {
    var f = window[fn], value = null;
    try { value = typeof f === 'function' ? f.apply(null, args || []) : null; }
    catch (e) { post({v:1, type:'reply', id:id, error:String(e)}); return; }
    post({v:1, type:'reply', id:id, value:value});
  };
  window.addEventListener('load', function () { post({v:1, type:'ready'}); }, {once:true});
})();
```
Command dispatch from RN:
```ts
const cmd = (fn: string, ...args: unknown[]) =>
  webRef.current?.injectJavaScript(
    `window.__rnInvoke(${JSON.stringify(fn)}, ${JSON.stringify(args)}); true;`);
```
`JSON.stringify` handles quoting/backslashes/CJK/emoji correctly, replacing `escapeForJs` — do
not hand-roll escaping.

### 8.5 Proposed minimal message protocol (parity with §2)

JS → RN (`onMessage`, JSON, `v:1`):

| `type` | Payload | Replaces |
|---|---|---|
| `ready` | – | `onPageFinished` readiness |
| `content` | `html: string` | `onContentChanged` |
| `doodleState` | `state: string` (JSON-in-JSON, keep as string) | `onDoodleStateChanged` |
| `imageClick` | `src: string` | `onImageClicked` |
| `requestImageInsert` | – | `requestImageInsert` |
| `stickerGesture` | `active: boolean` | `setStickerGestureActive` |
| `reply` | `id: string, value?: string, error?: string` | `evaluateJavascript(cb)` results |
| `error` | `message: string` | new (log only) |

`content` is high-frequency (every keystroke). Keep it verbatim; debounce on the RN side exactly
as today (350 ms) and do **not** throttle inside the shim, otherwise the doodle/sticker commits
(`persistDoodleChange` → `notifyContentChanged`) can be dropped.

RN → JS (via `__rnInvoke` / `__rnCall`), same names as §2.1:
`setContent, getContent, execCmd, changeFont, changeSize, changeColor, insertImage, insertSticker,
insertCustomSticker, toggleDoodleMode, setBrush, setBrushSize, setBrushColor, setBrushRoughness,
undoDoodle, redoDoodle, clearDoodle, mergeDoodle, insertDoodleImage, applyTheme,
applyEditorSettings, loadDoodleJson, getDoodleJson, exportDoodleImage, getDoodleState, setBrushOptions`.
Use `__rnCall` only for `getContent` (and optionally `getDoodleJson`); everything else is
fire-and-forget. `exportDoodleImage` returns a multi-MB data URL — if you ever need it, write the
bytes natively instead of round-tripping through `postMessage`.

Optional (P2) lazy image loading: replace eager base64 in `toDisplayableHtml` with a placeholder
(`<img data-media-src="journal-media://local/e/f.jpg" src="data:image/gif;base64,R0lGOD…">`), have
JS ask `{type:'mediaRequest', refs:[...]}` after `setContent`, and RN reply with
`{type:'mediaData', items:[{ref, dataUri}]}` → JS assigns `img.src`. Saves memory and postMessage
size on long journals; keep the persisted HTML unchanged.

### 8.6 Behavioural mapping table

| Compose/Kotlin | RN equivalent |
|---|---|
| `EditorBridge.content` StateFlow | `useRef<string>` + `useState` for dirty/derived UI |
| `debounce(350).collectLatest` | `setTimeout`/`useEffect` with 350 ms trailing debounce; `useRef` clear on unmount and before exit-save |
| `getContentForSave()` (2 s timeout, falls back to tracked content) | `Promise.race([__rnCall('getContent'), timeout(2000)])` else last `content` message |
| `saveMutex` | `p-limit`-style boolean/`await` chain (`savingRef`) |
| `BackHandler` | `useEffect` + `BackHandler.addEventListener('hardwareBackPress', …)` returning `true`; iOS: `navigation.addListener('beforeRemove')` |
| `ON_STOP` save | `AppState.addEventListener('change', …)` → `background` |
| `onPageFinished` pending flush | `onMessage type:'ready'` (primary) + `onLoadEnd` (fallback, idempotent guard) |
| `ActivityResultContracts.GetContent("image/*")` | `react-native-image-picker` `launchImageLibrary({mediaType:'photo', includeBase64:true})` or a document picker; **or** do the downscale in the WebView via canvas |
| `Bitmap` JPEG compression (1.5 Mpx, q75 / retry 0.5 Mpx q50) | either a tiny native module, or (simpler) compress in the WebView: `createImageBitmap` + `<canvas>` → `toDataURL('image/jpeg', 0.75)` with a `sqrt(max/current)` scale |
| `UserStickerStore` 256 KB / 512 kpx / PNG-if-alpha loop | `react-native-image-resizer`/native module, or the same 8-iteration loop implemented in JS on top of resize+quality |
| `systemGestureExclusionRects` + `requestDisallowInterceptTouchEvent` | not exposed by `react-native-webview`; needs a small native module (P2) or accept system-back conflicts during edge drags |
| `Toast` | `ToastAndroid.show` (Android) / RN `Alert` or a snackbar for cross-platform |
| Room `JournalEntry.content` | existing RN persistence (not yet present in `react-native/` at the time of writing) |

### 8.7 WebView props checklist

```
javaScriptEnabled, domStorageEnabled, allowFileAccess,
allowFileAccessFromFileURLs={false}, allowUniversalAccessFromFileURLs={false},
mixedContentMode="never", cacheEnabled={false}, cacheMode="LOAD_NO_CACHE",
originWhitelist={['file://*']}, onShouldStartLoadWithRequest (allow only the editor URL),
setSupportMultipleWindows={false}, javaScriptCanOpenWindowsAutomatically={false},
androidLayerType="hardware", style={{flex:1, backgroundColor:'transparent'}},
injectedJavaScriptBeforeContentLoaded={BRIDGE_SHIM}
```
`blockNetworkLoads` has no prop; the `onShouldStartLoadWithRequest` guard plus the local-only
asset set is the equivalent. Consider `androidLayerType="hardware"` (default) — `"software"`
hurts the doodle canvas.

### 8.8 Layout, keyboard, scroll

- Mirror `Scaffold(imePadding())`: `android:windowSoftInputMode="adjustResize"` (RN template
  default) + a flex column with the WebView in a `flex:1` container, top bar and bottom bar as
  siblings. Do **not** wrap the WebView in `ScrollView`/`KeyboardAvoidingView`: the page scrolls
  `#paper` itself, and the caret-visibility logic reads `visualViewport`.
- The page already handles the keyboard: `updateVisibleViewport()` computes
  `keyboardInset = layoutHeight - (visualViewport.offsetTop + visualViewport.height)` into
  `--keyboard-inset` (added to `#paper` bottom padding) and `keepCaretVisible()` scrolls
  `#paper.scrollTop`. This requires `visualViewport` events to fire — true with `adjustResize`,
  false with `adjustPan`. Keep `adjustResize`.
- If the bottom toolbar overlays the WebView (as in Compose, `zIndex 2`), reserve nothing: the
  panel is an overlay and the WebView keeps full height. Replicate exactly, otherwise caret
  scroll margins change.
- Safe areas: Compose relies on `Scaffold` insets; in RN use `react-native-safe-area-context`
  (already a dependency) for top/bottom bars, never inside the WebView.

### 8.9 Pitfalls (each one already bit the Compose implementation)

1. **UTF-8 / BOM**: `editor.html` declares `charset=UTF-8`; `editor.js` starts with a UTF-8 BOM
   (`\uFEFF` before `// ==== editor core ====`). Copy bytes, do not re-save through a tool that
   strips/normalises. Never inject the document through a `String`-typed bridge that re-encodes.
2. **Emoji escapes**: `STICKER_MAP` stores emoji as `\uXXXX` escapes, several as surrogate pairs
   (`\uD83D\uDE0A`). Don't "fix" them into literals; and when passing `insertSticker("heart")`
   keep the ASCII key, not the emoji.
3. **Escaping**: `escapeForJs` did not escape U+2028/U+2029; `JSON.stringify` based dispatch
   fixes that but must be used for *every* string argument (content, data URIs, fonts).
4. **`setContent` must not notify**: `setContent` intentionally skips `notifyContentChanged`.
   If the RN side re-renders on the `content` message after `setContent`, you get an autosave loop
   and duplicate media files. Track a "last applied content" string and ignore one echo.
5. **Set content only after `ready`**: the Compose version queues `pendingContent` because a
   pre-load `evaluateJavascript` is silently lost. Same rule: queue until `ready` (and keep
   `onLoadEnd` as a one-shot fallback). Re-apply pending theme/settings once `ready` arrives.
6. **Moveable grouping**: `new Moveable(document.body, {target: null, container: body,
   rootContainer: body, individualGroupable: false, keepRatio: true, origin: false, edge: false,
   pinchable: false, preventClickEventOnDrag: true, checkInput: true})`; the code **always**
   assigns a single `HTMLElement` to `.target` (`selectSticker`, `dragStart`, `resizeStart`,
   `rotateStart`, `dragEnd`, `resizeEnd`, `rotateEnd`) and calls `updateRect()` after mutations.
   Never pass an array/deselectable group; nearby stickers otherwise glue together. Also keep
   `.moveable-control-box/.moveable-area {z-index:1000}`, control size 20 dp, and the
   `isMoveableUiEvent()` filter (otherwise the outside-tap deselect handler fires mid-drag).
7. **Image loading**: `img.onclick` is bound on insert **and** re-bound for every existing `img`
   after `setContent` (`bindImageClickHandlers`) — new images inserted through a different path
   will not preview. Sticker media must stay unclickable (guard checks
   `.journal-sticker__media`/`closest('.journal-sticker')`).
8. **`data-sticker-bound` regression**: never persist bind bookkeeping in the HTML; a WeakSet is
   used for exactly that reason.
9. **base64 memory**: a 400 KB JPEG becomes ~530 KB of base64 inside a JS string, in the DOM, and
   again in `postMessage`. Avoid keeping two copies: build the message, send, drop the reference;
   prefer the lazy media protocol (§8.5) for journals with many photos.
10. **Doodle canvas growth**: canvas backing store = `innerWidth × max(innerHeight,
    paper.scrollHeight) × dpr`. A long journal on a 3× device can allocate tens of MB. The page
    re-sizes on every `input` — preserve that, but do not additionally scale by `dpr` twice.
11. **Doodle + contentEditable**: `toggleDoodleMode(true)` sets `paper.contentEditable = "false"`
    and hides overflow. If RN re-mounts the WebView while doodle mode is on, the state is lost —
    re-issue `toggleDoodleMode` + brushes after `ready`.
12. **`getContent` timing**: always race with a 2 s timeout and fall back to the last message;
    a hung `onMessage` otherwise blocks exit save. Never save with an empty string as fallback —
    the empty-content guard is only as good as the content you pass it.
13. **Empty guard is HTML-shape based**: any change to the emitted markup (e.g. switching stickers
    from `.journal-sticker` to another class, or emitting `<img>` differently) must be reflected in
    `isBlankEditorHtml`'s four markers (`journal-sticker`, `<img`, `doodle-data`,
    `journal-media://`), or real content will be treated as blank and the dialog will appear.
14. **Ruled-paper drift**: line spacing is `1.9em` with the line drawn at `calc(1.9em - 1px)`;
    any change to `font-size`/`line-height`/`padding` desynchronises the ruling from the text
    baseline. Keep `1.9` and keep padding multiples of the line height.
15. **`contenteditable` focus**: formatting commands require `paper.focus()` + `restoreSelection()`
    (saved range). From RN, call `execCmd` after the WebView has focus; a native focus change
    between two commands collapses the selection.
16. **Sanitizer**: never bypass `setContent`; `file://` URLs outside `journal_media` and all
    `on*`/`style:url()` attributes are stripped, so debugging "my image disappeared" should start
    with a `sanitizeEditorHtml` diff.

### 8.10 Acceptance checklist (parity)

1. New entry → type CJK text → back → reopen: content, caret-free layout and ruled background
   identical; title default matches `YYYY年M月D日 星期X` when left blank.
2. Bold/italic/underline/strike + 3 alignments + undo/redo; `<font>` never appears in saved HTML
   after a size change (normaliser runs).
3. Fonts: 手写体 renders from the bundled TTF (no network), 宋体/黑体 fall back to system faces.
4. Insert photo from the picker: appears at the caret; saved HTML contains
   `journal-media://local/<entry>/…`, DB has no `data:image/`; reopen shows the image; tapping it
   opens the preview dialog.
5. Sticker: insert 3 emoji, drag one near the screen edge (no system-back exit), resize, rotate,
   delete via the red ×; HTML carries `data-left/top/rotate/kind`.
6. Sticker library: import a translucent PNG → stored ≤ 256 KB with alpha; tap inserts a 112 px
   sticker; long-press delete only removes it from the library.
7. Doodle: draw with each of the 6 tools, erase part of a stroke (structure splits, undo restores),
   undo/redo limit 40, clear, 确认 → doodle survives reopen (`.doodle-data` node) and is still
   editable; 导出 → PNG `<img>` in the body.
8. Empty-content protection: select-all + delete → back → dialog appears with the exact strings;
   取消 restores the previous content and exits; 继续保存 persists the empty body.
9. Autosave: type and wait 350 ms → a DB write occurs; background the app → save; no duplicate
   media files from a single image insert.
10. Rotation / keyboard: rotating and opening the IME keeps the caret visible and does not
    double-scroll; the paper still fills the viewport.

### 8.11 Residual risks / open questions

- **Custom scheme removal** is the largest behavioural change: everything that used
  `journal-media://` *inside the WebView* (scheme interception + 403 blocking) must become either
  data URIs or `file://` with relaxed file access. DB/backup strings stay the same, so no migration.
- **Gesture exclusion** needs native code; without it, dragging a sticker to the screen edge can
  trigger Android's back gesture mid-drag (a known Compose bug that was fixed natively).
- **Image compression** moves out of `Bitmap` into either a native module or WebView canvas; the
  two paths differ slightly in EXIF handling (`BitmapFactory` ignores orientation, canvas honours
  it depending on `createImageBitmap` options) — pick one and pin it in tests.
- **`react-native-webview` version drift** around `injectedJavaScriptBeforeContentLoaded` ordering
  and `onMessage` payload size limits should be pinned and smoke-tested on the target device.
- The Compose screen has **no delete-entry UI and no dirty indicator**; if the RN redesign adds
  them, they are new product surface, not parity work.
