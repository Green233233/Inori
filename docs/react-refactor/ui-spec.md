# UI Spec — 祈 / Inorinal (Jetpack Compose → React Native)

> **视觉风格修订（2026-11）**：本文件 §1.1 的颜色表是 Compose 原版 token，用作布局/尺寸/交互参考。
> RN 最终实现已改为 **Apple Music「新发现」式鲜明撞色 + 轻量玻璃 + Glass Icons**，色板、材质 token、动效与性能取舍以
> [`design-language.md`](design-language.md)、[`DESIGN.md`](../../DESIGN.md) 为准；下文的布局、间距、交互与功能行为仍然有效。

Scope: branch `react`. Read in full: `HomeScreen`, `MainTabScreen`, `CategoryScreen`, `CategoryEntriesScreen`, `FavoritesScreen`, `JournalCard`, `AppLayout`, `Color`, `Theme`, `Type`, `IconDrawables`, `HtmlText`, `MainActivity`, `res/values/{strings,themes,colors}.xml`; plus `AppNavigation`, `JournalEntry`, `JournalDao`, `ProfileScreen` for cross-cutting facts. No app source modified. Values below are transcribed, not inferred; where Compose behavior does not map 1:1 to RN the risk is flagged in §9. `L` = light, `D` = dark. All colors `#RRGGBB`, opaque unless an alpha is stated.

## 1. Design tokens

### 1.1 Color schemes (M3 roles × style × mode)

| Role | SAKURA L | SAKURA D | MINT L | MINT D | PERIWINKLE L | PERIWINKLE D |
|---|---|---|---|---|---|---|
| primary | `#C06070` | `#FFB6C1` | `#429E9D` | `#80CBC4` | `#6F6BC7` | `#CCCCFF` |
| onPrimary | `#FFFFFF` | `#1F1215` | `#FFFFFF` | `#121F1D` | `#FFFFFF` | `#141323` |
| primaryContainer | `#FFD9DD` | `#5C2329` | `#B2DFDB` | `#1A3B3A` | `#CCCCFF` | `#3C397A` |
| onPrimaryContainer | `#5C2329` | `#FFD9DD` | `#1A3B3A` | `#B2DFDB` | `#23215A` | `#E2E0FF` |
| secondary | `#FFE6E6` | `#E8919C` | `#E0F2F1` | `#357A79` | `#B8C7FF` | `#B8C7FF` |
| onSecondary | `#333333` | `#1F1215` | `#333333` | `#121F1D` | `#333333` | `#141323` |
| secondaryContainer | `#FFE6E6` | `#3D252A` | `#E0F2F1` | `#253D3A` | `#F0EFFF` | `#2A2946` |
| onSecondaryContainer | `#5C2329` | `#FFE6E6` | `#1A3B3A` | `#E0F2F1` | `#23215A` | `#F0EFFF` |
| tertiary | `#FFC0CB` | `#FFC0CB` | `#87CEEB` | `#87CEEB` | `#E2E0FF` | `#E2E0FF` |
| onTertiary | `#333333` | `#1F1215` | `#333333` | `#121F1D` | `#333333` | `#141323` |
| background | `#FAF7F2` | `#1F1215` | `#FAF7F2` | `#121F1D` | `#FAF7F2` | `#141323` |
| onBackground | `#333333` | `#F5E6E8` | `#333333` | `#E0F2F1` | `#333333` | `#ECEAFF` |
| surface | `#FAFAFA` | `#2A1A1E` | `#FAFAFA` | `#1A2A28` | `#FAFAFA` | `#1C1B2F` |
| onSurface | `#333333` | `#F5E6E8` | `#333333` | `#E0F2F1` | `#333333` | `#ECEAFF` |
| surfaceVariant | `#FFE6E6` | `#3D252A` | `#E0F2F1` | `#253D3A` | `#F0EFFF` | `#2A2946` |
| onSurfaceVariant | `#665658` | `#D4B8BC` | `#3F4948` | `#B2DFDB` | `#55536D` | `#D0CCF2` |
| outline | `#9C8C8E` | `#7E6E70` | `#6F7978` | `#6F7978` | `#777491` | `#8582A8` |
| error | `#BA1A1A` | `#FFB4AB` | `#BA1A1A` | `#FFB4AB` | `#BA1A1A` | `#FFB4AB` |
| onError | `#FFFFFF` | `#690005` | `#FFFFFF` | `#690005` | `#FFFFFF` | `#690005` |

Notes: `background` is rice-white `#FAF7F2` in **all** light styles and `surface` is `#FAFAFA` in all light styles; `secondary` deliberately collapses into the `surfaceVariant` family (decorative, low contrast). The 4th style `SYSTEM` (`"跟随系统"`) uses Android 12+ dynamic Material You (`dynamicLight/DarkColorScheme`) and falls back to SAKURA below API 31 — RN cannot reproduce dynamic color (§9).

### 1.2 Semantic / decorative colors

| Token | Hex | Use |
|---|---|---|
| `FavoriteRed` | `#E57373` | `HeartIcon` default tint |
| `StarYellow` | `#FFD54F` | 收藏 stat icon, `StarIcon` |
| `FireOrange` | `#FF8A65` | 连续 streak stat icon |
| `SkyBlue` | `#87CEEB` | MINT tertiary |
| `DarkGrey` | `#333333` | default tint of `WeatherIcon`/`MoodIcon` |

### 1.3 Typography

`Typography` overrides **only** `bodyLarge` (16/24, +0.5, Normal); everything else is Material 3 default. Styles actually used here:

| Style | Size / line height / tracking | Weight | Where |
|---|---|---|---|
| titleMedium (M3 default) | 16 / 24 / +0.15 | 500 | card title, width ≥ 340 |
| titleSmall (M3 default) | 14 / 20 / +0.1 | 500 | card title, width < 340 |
| bodyMedium (M3 default) | 14 / 20 / +0.25 | 400 | Home search field |
| card title override | as above | **600** | `JournalCard` |
| card preview | 12/16 (narrow) · 13/18 | 400 | explicit sp |
| brand "祈" | 20 sp (narrow) · 24 sp | **700** | Home top bar |
| Home empty text | 15 sp | 400 | empty state |
| date day | 24 / 28 / 34 sp, lineHeight == fontSize | 500 | date block |
| date month | 11 sp (narrow) · 12 sp | 500 | date block |
| category label / count | 16 sp / 13 sp | 500 / 400 | 分类 |
| status-pill text | 10 sp | 400 | card meta |
| nav label | 10 sp (narrow) · 11 sp | 400 | bottom bar |
| top-bar titles | M3 default 22 sp | **700** | 分类/收藏/个人中心 |
| Favorites empty text | 14 sp (narrow) · 16 sp | 400 | 收藏 |
| profile name / tagline | 18–22 sp / 13–14 sp | 700 / 400 | 我的 |
| stat value | 16 sp (narrow) · 20 sp | — | 我的 |

### 1.4 Layout tokens (`AppWindowSize`, width-driven, 300–500 dp)

Bands: `isNarrow` = width < 340 · `isCompact` = width < 360 · `isRegular` = 360–419 · `isComfortable` = ≥ 420. The predicates are nested, so **narrow also satisfies compact** (all `isCompact` branches apply below 360).

| Token | < 340 | < 360 | 360–419 | ≥ 420 |
|---|---|---|---|---|
| `contentPadding` | 10 | 12 | 16 | 20 |
| `listSpacing` | 8 | 10 | 12 | 12 |
| `cardInnerPaddingHorizontal` | 10 | 12 | 16 | 16 |
| `cardInnerPaddingVertical` | 10 | 12 | 14 | 14 |
| `cardMinHeight` | 92 | 98 | 104 | 104 |
| `cardDateWidth` | 36 | 44 | 52 | 52 |
| `cardDateFontSp` | 24 | 28 | 34 | 34 |
| `cardDateGap` | 8 | 10 | 14 | 14 |
| `fabBottomInset` | 88 | 104 | 104 | 104 |
| `sectionGap` | 20 | 24 | 32 | 32 |
| `avatarSize` / `avatarIconSize` | 76 / 60 | 88 / 70 | 100 / 80 | 100 / 80 |

Boolean tokens:

| Token | true | false |
|---|---|---|
| `cardActionSize` (narrow) | 40 | 48 |
| `cardCorner` (compact) | 16 | 18 |
| `emptyIconSize` (narrow) | 48 | 60 |
| `brandTitleSp` (narrow) | 20 | 24 |
| `navLabelSp` (narrow) | 10 | 11 |
| `profileNameSp` (narrow) | 18 | 22 |
| `statValueSp` (narrow) | 16 | 20 |

Remaining `AppLayout` tokens (other screens, keep for parity): `aboutHeroSp` 36/42/48, `aboutIconSize` 88/104/120, `aboutTopSpacer` 24/32/60, `imagePreviewHeight` 280/340/420, `stickerColumns` 4/4/5, `stickerCell` 40/44/52, `stickerEmojiSp` 22 (compact) / 28, `sheetHorizontalPadding` 14/20, `toolbarPanelPadding` 6/8.

### 1.5 Radii, elevation, misc

| Element | Radius | Elevation |
|---|---|---|
| Journal card | 16 dp (< 360) / 18 dp | 2 dp |
| Category card | 12 dp | 1 dp |
| Status pill | `RoundedCornerShape(50)` = fully rounded | — |
| Search field | 20 dp | — |
| FAB / avatar | `CircleShape` | M3 default (6 dp) for FAB |
| Profile export/import buttons | 12 dp | — |
| Bottom-nav indicator | M3 default pill | `tonalElevation = 3 dp` |

Chrome: `enableEdgeToEdge()`; transparent status/nav bars (`themes.xml`), dark bar icons only in dark mode (`isAppearanceLightStatusBars = !useDarkTheme`).

## 2. Navigation

One `NavHost`, `startDestination = "main"`, one shared `JournalViewModel` for the whole graph.

### 2.1 Bottom tabs (`main`)

| # | Label | Selected icon | Unselected icon |
|---|---|---|---|
| 0 | `"首页"` | `Icons.Filled.Home` (`home`) | `Icons.Outlined.Home` (outlined `home`) |
| 1 | `"分类"` | `Icons.Filled.Dashboard` (`dashboard`) | `Icons.Outlined.Dashboard` |
| 2 | `"收藏"` | `Icons.Filled.Favorite` (`favorite`) | `Icons.Outlined.FavoriteBorder` (`favorite-border`) |
| 3 | `"我的"` | `Icons.Filled.Person` (`person`) | `Icons.Outlined.Person` |

`NavigationBar(containerColor = surface, tonalElevation = 3.dp)`; selected icon+text `primary`, unselected `onSurfaceVariant`, `indicatorColor = primary @ 10%`; label `maxLines = 1`. Selected index is `rememberSaveable` `Int`, default `0` (survives rotation and process death while `main` stays on the stack).

### 2.2 Full-screen routes

| Route | Arg | Screen | Top bar | Notes |
|---|---|---|---|---|
| `main` | — | `MainTabScreen` | per-tab | hosts the bottom bar |
| `category/{category}` | String enum name | `CategoryEntriesScreen` | back arrow | invalid name → `ALL` |
| `editor/{entryId}` | String | `EditorScreen` | back = save | `"new"` sentinel → `null` (create) |
| `settings` | — | `SettingsScreen` | back arrow | 设置 |
| `about` | — | `AboutScreen` | back arrow | 关于 |
| `licenses` | — | `OpenSourceLicensesScreen` | back arrow | 开放源代码许可 |

Entry points: card tap → `editor/{id}`; Home top-bar `+` and FAB → `editor/new`; category row → `category/{NAME}`; Profile 设置 → `settings`, 关于 → `about`; About 开放源代码许可 → `licenses`.

### 2.3 Back behavior

System back and every top-bar back on a full-screen route call `popBackStack()`; returning to `main` preserves the selected tab index because the `main` entry is never recreated. From `main`, system back exits the app (no in-app handler). Editor back **saves first** (`contentDescription = "返回并保存"`) and an empty-overwrite guard dialog (`"即将覆盖为空内容"`, `"继续保存"` / `"取消"`) prevents silent data loss. RN mapping: bottom-tab navigator (4 screens kept mounted) + native stack for the 5 full-screen routes.

## 3. Screen-by-screen

### 3.1 MainTab shell

`Scaffold(bottomBar = NavigationBar, containerColor = background)`; content is `when (selectedTab)`. Tabs 1–3 are wrapped in `Box(Modifier.padding(innerPadding))`; Home receives `modifier = Modifier.padding(innerPadding)` and then adds **its own** `Scaffold` + `innerPadding` → Home content is inset twice (bottom bar + own top bar). ⚠️ Reproduce deliberately or fix consciously (§9).

### 3.2 Home (`HomeScreen`, tab 0)

Top app bar: `CenterAlignedTopAppBar`, `containerColor = background`.

| Slot | Content |
|---|---|
| navigationIcon | search toggle `IconButton`: `Search` with `"搜索"`, or `Close` with `"关闭搜索"` |
| title | not searching → `Text("祈", fontSize = brandTitleSp, Bold, onSurface)`; searching → search field |
| actions | `IconButton(Add, contentDescription = "新建日记")`, **hidden while searching** |

Search field: `BasicTextField`, single line, `bodyMedium`, text `onSurface`, `fillMaxWidth`, background `surface`, radius 20 dp, padding 12 dp horizontal / 8 dp vertical; placeholder `"搜索日记"` in `onSurfaceVariant` when empty. Closing search calls `setSearchQuery("")`. Query drives `searchResults`: blank → all entries, else DAO `title LIKE %q% OR content LIKE %q%`, no debounce, no loading state. Ordering is `createdAt DESC`, not the entry `date`.

FAB: `FloatingActionButton`, `CircleShape`, `primaryContainer` / `onPrimaryContainer`, icon `Add` at 30 dp, `contentDescription = "新建日记"`. On tap: `scale.snapTo(1.18f)` then `spring(DampingRatioMediumBouncy)` → `1f`, then `onNewEntry()`.

List: `LazyColumn`, `contentPadding = start/top/end: contentPadding, bottom: fabBottomInset`, `spacedBy(listSpacing)`, `key = entry.id`.

Empty state (shown whenever `entries.isEmpty()`): centered column, icon `Search` if the query is non-blank else `EditNote`, size `emptyIconSize`, tint `onSurfaceVariant @ 45%`; 14 dp gap; 15 sp `onSurfaceVariant`: `"没有找到相关日记"` (searching) / `"还没有日记，开始记录吧"`; 24 dp side padding. One widget serves both "no data" and "no match".

Delete dialog (owned here): title `"删除日记"`, body `"确定要删除「{title}」吗？此操作不可撤销。"`, confirm `"删除"` (error color), dismiss `"取消"`.

### 3.3 Category (`CategoryScreen`, tab 1)

`TopAppBar` title `"分类"` (Bold, `onSurface`), `containerColor = surface`. Body `LazyColumn`: horizontal `contentPadding`, `spacedBy(listSpacing)`, `contentPadding vertical = listSpacing`.

Row = `Card(fillMaxWidth, radius 12, containerColor = surfaceVariant, elevation 1)` + `Row(padding 16 dp, SpaceBetween)`. Left cluster: icon 24 dp, `tint = primary`, `contentDescription = label`; 12 dp gap; `Text(label, 16 sp, Medium, onSurface)`. Right cluster: `Text("${count} 篇", 13 sp, onSurfaceVariant)` — the string becomes `"加载中"` until `entriesLoaded` flips on the first `allEntries` emission; 4 dp gap; `ChevronRight` 20 dp `onSurfaceVariant`. Whole row `clickable { onCategoryClick(category) }`. All icons are `primary` — there are **no per-category colors**. Counts are computed in memory via `groupingBy { it.category }`; `ALL` uses `allEntries.size`.

### 3.4 Category entries (route `category/{category}`)

`TopAppBar` `containerColor = background`, title Bold `onSurface` per category: `ALL "全部"` · `DAILY "日常"` · `WORK "工作"` · `GOAL "目标"` · `INSPIRATION "灵感"` · `EMOTION "情绪"`. Back `IconButton(ArrowBack, contentDescription = "返回", tint = onSurface)`.

Body: `ALL` → all entries, else filter `entry.category == category` (in memory, live). Empty → centered `Text("该分类下暂无日记", onSurfaceVariant)`. Else `LazyColumn` with horizontal `contentPadding`, `spacedBy(listSpacing)`, `contentPadding vertical = 12 dp`, `key = id`. Same `JournalCard` wiring as Home. No FAB, no search, no count.

### 3.5 Favorites (`FavoritesScreen`, tab 2)

`TopAppBar` title `"收藏"` (Bold, `onSurface`), `containerColor = background`. Source is the dedicated flow `favoriteEntries` (DAO `isFavorite = 1 ORDER BY createdAt DESC`), not a client-side filter.

Empty: centered column — `FavoriteBorder` at `emptyIconSize`, tint `onSurfaceVariant @ 50%`; 16 dp gap; `Text("收藏的日记将显示在这里", 14 sp (narrow) / 16 sp, onSurfaceVariant)`; side padding `contentPadding`. No action button.

List: `LazyColumn`, horizontal `contentPadding`, `spacedBy(listSpacing)`, `contentPadding vertical = 12 dp`, `key = id`. No FAB, no count, no search. Unfavoriting removes the row immediately (no undo/snackbar).

### 3.6 Profile (`ProfileScreen`, tab 3)

`TopAppBar("个人中心", Bold, onSurface, containerColor = surface)`; scrolling centered column with `contentPadding`. Avatar circle `avatarSize` with `primary @ 15%` background and `ProfileAvatarIcon` (`account-circle`) at `avatarIconSize`, tint `primary`. Name `"日记爱好者"` (Bold, `profileNameSp`). Tagline `"记录生活中的每一个美好瞬间"` (13/14 sp, `onSurfaceVariant`, 92 % width, centered, max 2 lines). Stats row `SpaceEvenly`: `EditNote` `"日记"` count (primary) · `LocalFireDepartment` `"连续"` `"${n}天"` (`#FF8A65`) · `Star` `"收藏"` count (`#FFD54F`). Buttons `"导出条目"` / `"导入条目"` — stacked with 12 dp gap when `isCompact`, side by side otherwise. Menu: `"设置"` (Settings), `"数据备份"` (CloudUpload → export), `"关于"` (Info). Toasts `"导出成功"`, `"导出失败: {msg}"`, `"导入失败: {msg}"`; default filename `祈_日记备份_{epochMillis}.zip`.

## 4. JournalCard

### 4.1 Container

`Card(fillMaxWidth, defaultMinSize(minHeight = cardMinHeight), shape = cardCorner, elevation 2 dp, containerColor = Transparent)`. Inner `Box` background stack, in order: (1) `surface @ 0.96`; (2) radial gradient of the **complement** of the live `primary` — `C = (1 - R, 1 - G, 1 - B)` — with colors `[C@10%, C@4.5%, transparent]` (evenly spaced stops 0 / 0.5 / 1), no explicit center (card center), `radius = 560 px`. SAKURA light example: `primary #C06070` → `C = #3F9F8F`. RN: `RadialGradient` centered on the card with radius `560 / PixelRatio.get()` dp. Content `Row(padding start = cardInnerPaddingHorizontal, top/bottom = cardInnerPaddingVertical, end = isNarrow ? 2 : 8, CenterVertically)`; the whole card is `combinedClickable(onClick, onLongClick)`.

### 4.2 Date block

Column `width = cardDateWidth`, centered. Line 1: `date.dayOfMonth` as string, size `cardDateFontSp` (lineHeight == fontSize), weight 500, `onSurface`. Line 2: `"${date.monthValue}月"` (e.g. `"11月"`), 11 sp (narrow) / 12 sp, 500, `onSurfaceVariant`. No year, no weekday, no zero padding. Then `Spacer(width = cardDateGap)`.

### 4.3 Title / preview

Middle `Column(weight 1f, Center)`. Title: `entry.title.ifBlank { "未命名日记" }`, `titleSmall` (narrow) / `titleMedium`, weight **600**, `onSurface`, 1 line, ellipsis. Preview: `preview.ifBlank { "暂无正文" }`, 12/16 (narrow) or 13/18, `onSurfaceVariant` at alpha **0.58** when blank else **0.86**, max 2 lines, ellipsis; `preview = htmlToPlainText(entry.content).trim()`. Then `Spacer(6 dp narrow / 8 dp)`.

### 4.4 Meta row

`Row(spacedBy 4 dp narrow / 6 dp)`, three pills: weather `WeatherIcon(weather.normalized(), 13 dp narrow / 15 dp, tint = primary)`; mood `MoodIcon(mood.normalized(), 13/15 dp, tint = primary)`; category text only when **`!isNarrow`** (hidden < 340 dp), 10 sp. `StatusPill` = `Surface(fully rounded, color = primary @ 9%, contentColor = onSurfaceVariant)` with padding 5/2 dp (compact) or 7/3 dp. `categoryLabel`: DAILY `"日常"` · WORK `"工作"` · GOAL `"目标"` · INSPIRATION `"灵感"` · EMOTION `"情绪"` · ALL → `null` (no pill).

### 4.5 Actions

Right `Box`: `IconButton(size = cardActionSize 40/48, contentDescription = "更多操作")` with `MoreVert`, tint `onSurfaceVariant`; also opened by long-press. `DropdownMenu`: (1) leading `Favorite` when `isFavorite` else `FavoriteBorder`, text `"取消收藏"` / `"收藏"`; (2) leading `Delete` tinted `error`, text `"删除"` tinted `error`, **only when `onDeleteClick != null`** (all three call sites pass it). The menu closes before the callback fires.

### 4.6 Delete confirmation

Owned by each hosting screen (Home / CategoryEntries / Favorites), identical: `AlertDialog`, title `"删除日记"`, body `"确定要删除「{title}」吗？此操作不可撤销。"` using the **raw** title (no `"未命名日记"` fallback, so an empty title renders `「」`), confirm `"删除"` in `error`, dismiss `"取消"`.

### 4.7 Preview derivation — `htmlToPlainText`

Input is the stored rich-text HTML, already truncated to 500 chars by the list query. Preserve this exact order:

1. `html.isBlank()` → `""`.
2. Replace `data:image/<payload>` runs (case-insensitive; stop at `"`, `'`, `;`, whitespace or `>`) with a space.
3. Remove `<script>…</script>` blocks (dot-all, case-insensitive) → space.
4. Remove `<style>…</style>` blocks → space.
5. Remove every `<img …>` tag → space.
6. Remove `<canvas>…</canvas>` blocks → space.
7. Replace an unterminated trailing `<…` (`<[^>]*$`) → space.
8. Replace leading junk before the first tag (`^[^<\[]*>`) → space.
9. `Html.fromHtml(sanitized, FROM_HTML_MODE_COMPACT).toString()` — inserts `\n` between block elements.
10. Replace leftover `<[^>]+>` → space; replace a stray leading `>` (`^[^<]*>`) → space.
11. NBSP `U+00A0` → space; collapse `\s+` → single space; `trim()`.

Result: one single-line string (no paragraph breaks). Step 9 is load-bearing: a naive tag-strip yields different previews because `<br>`/`<div>` boundaries become spaces only through it.

## 5. Category data (`CategoryScreen`, exact)

| # | Enum | Label here | Icon (Material) | Count source | Tap |
|---|---|---|---|---|---|
| 0 | `ALL` | `"全部"` | `MenuBook` (auto-mirrored, filled) | `allEntries.size` | → `category/ALL` |
| 1 | `DAILY` | `"日常"` | `WbSunny` | `count(DAILY)` | → `category/DAILY` |
| 2 | `WORK` | `"工作"` | `Work` | `count(WORK)` | → `category/WORK` |
| 3 | `GOAL` | `"目标"` | `TrackChanges` | `count(GOAL)` | → `category/GOAL` |
| 4 | `INSPIRATION` | `"灵感"` | `Lightbulb` | `count(INSPIRATION)` | → `category/INSPIRATION` |
| 5 | `EMOTION` | `"情感"` | `Favorite` | `count(EMOTION)` | → `category/EMOTION` |

Icons are 24 dp, `tint = primary`, `contentDescription = label`; counts render as `"{n} 篇"` (13 sp) or `"加载中"`. Label inconsistency: `"情感"` here vs `"情绪"` in CategoryEntriesScreen / JournalCard / EditorScreen — pick one canonical value for the rebuild.

## 6. Favorites behavior

Source is a dedicated DAO flow (`isFavorite = 1`, `createdAt DESC`), not a client filter. Toggle comes from the card menu `"收藏"` / `"取消收藏"` (or long-press → same item) → `toggleFavorite(entry)` flips `isFavorite` and bumps `updatedAt`; both flows re-emit. Consequence: an unfavorited card disappears instantly, with no undo and no snackbar. Empty state text `"收藏的日记将显示在这里"` with a large outlined heart at 50 % alpha and no action button. No per-tab count in the app bar (the Profile tab shows the `favoriteCount` stat). Deleting here deletes everywhere (single source of truth).

## 7. Weather / mood / icon mapping

`WeatherIcon`/`MoodIcon` normalize first, then dispatch, defaulting to a safe fallback.

### 7.1 Weather (`Weather`)

| Enum | displayName | a11y / contentDescription | Icon (Material) | RN glyph |
|---|---|---|---|---|
| `SUNNY` | `"晴天"` | `"晴天"` | outlined `WbSunny` | `wb-sunny` |
| `RAINY` | `"雨天"` | `"雨天"` | outlined `WaterDrop` | `water-drop` |
| `CLOUDY` | `"阴天"` | `"多云"` | outlined `Cloud` | `cloud` |
| `NIGHT_CLEAR` | `"夜晚"` | `"晴朗夜晚"` | outlined `NightsStay` | `nights-stay` |
| `SNOWY` (deprecated) | `"雪天"` | normalizes to CLOUDY | outlined `Cloud` | `cloud` |
| fallback | — | — | `Cloudy` | `cloud` |

`normalized()`: `SNOWY → CLOUDY`, else identity. Editor offers SUNNY, CLOUDY, RAINY, NIGHT_CLEAR only.

### 7.2 Mood (`Mood`)

| Enum | displayName | a11y | Icon (Material) | RN glyph |
|---|---|---|---|---|
| `HAPPY` | `"开心"` | `"开心"` | outlined `SentimentVerySatisfied` | `sentiment-very-satisfied` |
| `CALM` | `"无感"` | `"平静"` | outlined `SentimentNeutral` | `sentiment-neutral` |
| `SAD` | `"伤心"` | `"难过"` | outlined `SentimentVeryDissatisfied` | `sentiment-very-dissatisfied` |
| `EXCITED` (deprecated) | `"兴奋"` | → HAPPY | as HAPPY | — |
| `PROUD` (deprecated) | `"自豪"` | → HAPPY | as HAPPY | — |
| `EMOTIONAL` (deprecated) | `"感动"` | → CALM | as CALM | — |
| fallback | — | — | `SentimentNeutral` | `sentiment-neutral` |

`normalized()`: `EXCITED|PROUD → HAPPY`, `EMOTIONAL → CALM`, else identity. Editor offers HAPPY, CALM, SAD. Note the display-vs-a11y mismatches (`阴天`/`多云`, `夜晚`/`晴朗夜晚`, `无感`/`平静`, `伤心`/`难过`).

### 7.3 Other icons

| Wrapper | Vector | Default tint | contentDescription |
|---|---|---|---|
| `ProfileAvatarIcon` | outlined `AccountCircle` | `#C06070` | `"用户头像"` |
| `AppIdentityIcon` | outlined `AutoStories` | `#C06070` | `"祈日记"` |
| `HeartIcon` | filled `Favorite` | `#E57373` | `null` |
| `StarIcon` | filled `Star` | `#FFD54F` | `null` |

Everything in scope is a Material vector icon — no bitmaps or custom-drawn glyphs — so the RN rebuild can use a Material icon set without authoring SVGs. Only `Icons.Outlined.Dashboard` lacks a faithful outlined counterpart (approximate).

## 8. Edge cases, loading, accessibility

**Loading / empty.** Home never reads `entriesLoaded`, so on cold start `"还没有日记，开始记录吧"` flashes before the first DB emission; CategoryScreen avoids this with `"加载中"`, while CategoryEntries and Favorites have the same flash risk. All flows are `stateIn(WhileSubscribed(5000), emptyList())`, so data stays warm across a 5 s resubscribe window. No skeletons, spinners, pull-to-refresh or error UI exists in these screens.

**Data.** Ordering is `createdAt DESC`, not the user-visible `date`, so back-dated or imported entries can look out of order. List content is `substr(content, 1, 500)`: previews can cut mid-tag (handled by the trailing-tag regex) and never exceed ~500 source chars. Preview is memoized on `content` only. Favorite/delete writes are fire-and-forget with no optimistic UI or error surface.

**Layout / interaction.** Double vertical inset on Home (MainTab padding + Home Scaffold padding) shrinks the viewport, and the FAB sits inside that Scaffold so it floats above the bottom bar rather than overlapping it. The search field lives in the `CenterAlignedTopAppBar` **title** slot with `fillMaxWidth`, so its usable width is bounded by the nav icon and actions slots and long queries can clip. Search has no debounce and queries per keystroke. The category pill disappears below 340 dp; weather/mood pills remain. Card end padding collapses to 2 dp on narrow widths to keep the 40 dp hit target. Home's `+` action is hidden while searching (only the FAB remains). No haptics, shared-element transitions or list animations — the only motion is the FAB spring plus Material ripples.

**Accessibility.** Each card is one `combinedClickable` target with no `contentDescription` or role, so the long-press menu is only discoverable via the `"更多操作"` button. Menu leading icons pass `null` but their text is read. The delete dialog is a standard M3 `AlertDialog` (focus-trapped, dismissible by back/outside tap). Weather/mood icons expose `"晴天"`, `"多云"`, `"晴朗夜晚"`, `"开心"`, `"平静"`, `"难过"` — TalkBack reads the glyph but not the display names. Decorative icons pass `null` (empty-state icons, chevrons, `HeartIcon`, `StarIcon`). Button descriptions: `"搜索"`, `"关闭搜索"`, `"新建日记"`, `"更多操作"`, `"返回"`, `"返回并保存"`. The `fontSizeSp` setting (14/16/18/20) applies to the editor body only; these screens use fixed sp sizes and ignore it.

## 9. React Native implementation notes & risks

1. **Runtime-derived gradient.** The card tint is computed from the live `primary` (`1 - channel`), not an asset — it changes hue per style and per mode. Implement as a palette function.
2. **`SYSTEM` color style** (dynamic Material You) is unreproducible; decide fallback SAKURA or hide the option before shipping settings.
3. **`htmlToPlainText` step 9** (`Html.fromHtml` compact mode) is load-bearing. Port with a small HTML entity + block-boundary decoder, then reuse steps 10–11 verbatim; a plain tag-strip changes previews.
4. **Double inset on Home** and the FAB's relationship to the tab bar are the likeliest visual mismatch; replicate the padding math explicitly instead of leaning on safe-area insets.
5. **One width-token hook.** `contentPadding`, `cardCorner` and the 340 dp category-pill cutoff must all come from a single `useAppWindowSize()` so breakpoints cannot drift (340 / 360 / 420).
6. **Label divergence**: `"情感"` vs `"情绪"` (CategoryScreen vs everywhere else), plus the `"阴天"`/`"多云"` and `"伤心"`/`"难过"` display-vs-a11y pairs. Copy verbatim only if byte-identical UI is required.
7. **Data-layer facts** (`createdAt DESC`, `substr(content,1,500)`, title-or-content `LIKE` search) live in the DAO; the RN data layer must replicate them or ordering and previews will differ.
8. **Empty-state flash** on cold start affects 3 screens; gate on a `loaded` flag rather than porting the bug.
9. **Outlined-vs-filled tab icons**: `Dashboard` has no exact outlined Material counterpart, and `FavoriteBorder` is the outlined heart — verify silhouettes at 24 dp.
10. **Editor is out of scope here** (web-based rich editor: stickers, doodle, fonts), but its category/weather/mood pickers, font chips and empty-save guard are surfaces the RN shell must still own.

## v0.6.0 新增页面与交互契约

| 页面 | 入口 | 关键交互 |
|---|---|---|
| 绑定 / 配对 | 登录后 | 角色二选一 → 生成/输入 8 位码 → 双端核对 6 位 SAS → 确认绑定；等待对方时 2.5s 轮询（仅前台） |
| 主页（双端） | Tab 1 | 角色态 hero（在线点 + 同伴名 + 校验状态 + 最近同步）；主人端「和好券 / 日记」双按钮 + 管控与查看 5 行；小狗端「我的权限」4 行 + 装扮问候语 |
| 设备管控中心 | 主人端主页 | hero（在线/电量/档位）+ 6 动作块（查看屏幕/使用时长/定位/通知/全屏消息/守护状态）+ 数据查看卡（常驻拒绝理由） |
| 权限管控中心 | 小狗端主页·我的 | 10 行权限（设备管理器/无障碍/使用情况/悬浮窗/电池优化/通知使用权/精确闹钟/定位/照片/随时查看屏幕）+ 审计日志 |
| 响应配置 | 我的·隐私与权限 | 三档功耗分段、使用时长/全屏消息开关、通知转发白名单（包名增删）；关闭后主人端收到明确拒绝理由 |
| 自动规则 | 我的·隐私与权限 | 名称 + 起止时间 + 档位；跨夜窗口；开关/删除；顶部「正在生效」横幅；由守护服务心跳内评估，无额外定时器 |
| 装扮 | 我的·联结 | 头像光环四色、主页问候语、桌面小组件标题/副标题 + 实时预览；仅本机可见不同步 |
| 共享空间 | 双端主页 | 便签/里程碑二选一发布、下拉刷新、作者 pill（我/TA）、仅可删自己的 |
| 任务与指令 | 主人端主页 / 小狗端主页 | 主人下达任务（标题+说明）；小狗报备（文字）；主人验收/打回；状态三态统计 |
| 定时规则 | 双端主页 | 时间 + 重复星期 + 内容；同步到双方，不唤醒屏幕 |
| 相册分享 | 双端主页 | 系统选择器挑图 → 加密分块上传 → 双方可看；仅本人可删 |
| 通知转发 | 主人端主页 / 小狗端响应配置 | 小狗端通知（脱敏数字与长串）经加密中继到主人端；黑名单在配置页维护 |
| 和好券 | Tab 2 | 主人签发（和好券/考试免罚券）、小狗派发奖励券；小狗核销；奖励券由主人填奖励内容；券码 7 字母 + · + 7 数字，核销不可撤销 |
| TA 的日记（只读） | 日记列表 TA 条目 | 原生块渲染（文字/图片/列表/贴纸），点图进全局查看器；不使用 WebView |

统一约束：单主操作、单强调色，无新增渐变/模糊；动画只走合成器属性且 ≤200ms；图标按钮必带 `accessibilityLabel`；长列表用 FlatList 虚拟化；所有失败路径给中文可读理由（不静默）。
