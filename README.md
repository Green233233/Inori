# 祈（Inorinal）

<p align="center">
  <img src="docs/images/app-icon.png" alt="祈应用图标" width="128" />
</p>

<p align="center">
  <strong>一款安静、本地优先的 Android 手账日记应用</strong><br/>
  记录天气与心情 · 富文本书写 · 涂鸦与贴纸 · 分类收藏 · 本地备份
</p>

<p align="center">
  <img src="docs/images/hero-banner.png" alt="祈产品氛围图：纸质手账与温柔配色" width="100%" />
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPLv3-blue.svg" alt="GPLv3" /></a>
  <a href="https://developer.android.com/"><img src="https://img.shields.io/badge/Platform-Android%2029%2B-3DDC84.svg" alt="Android 29+" /></a>
  <a href="#版本更新日志"><img src="https://img.shields.io/badge/Version-Alpha%20v0.2.3-orange.svg" alt="Alpha v0.2.3" /></a>
</p>

---

## 目录

- [写在前面](#写在前面)
- [产品定位](#产品定位)
- [功能一览](#功能一览)
- [界面印象](#界面印象)
- [技术架构](#技术架构)
- [隐私与数据](#隐私与数据)
- [构建与运行](#构建与运行)
- [项目结构](#项目结构)
- [开源许可](#开源许可)
- [致谢](#致谢)
- [版本更新日志](#版本更新日志)
- [参与贡献](#参与贡献)

---

## 写在前面

「祈」不是又一个把日记塞进云端、再用算法推送「今日灵感」的效率工具。它更接近一本随身携带的纸质手账：你可以慢慢写，可以随手涂两笔，可以贴一张自己导入的贴纸，也可以什么都不做，只是把今天的天气和心情记下来。

项目英文名 **Inorinal** 来自 inori（祈）与 journal 的结合。应用内品牌名称为「祈」。关于页里有一句很私人的献词——那是作者写给最亲爱的人的。我们把这份温柔保留在开源仓库里，也希望使用者在自己的日常中，找到同样安静的角落。

当前版本为 **Alpha v0.2.3**。功能已可用，但仍属于早期迭代：交互会继续打磨，稳定性会继续加强，欢迎 Issue 与 Pull Request。

---

## 产品定位

| 维度 | 说明 |
|------|------|
| 平台 | Android 10（API 29）及以上 |
| 数据 | 本地 Room 数据库 + 本地媒体目录，默认不上云 |
| 编辑 | WebView 富文本编辑器（文字 / 涂鸦 / 照片 / 贴纸） |
| 界面 | Jetpack Compose Material 3，浅色 / 深色 / 跟随系统 |
| 备份 | ZIP 导出 / 导入，含条目媒体与用户贴纸库 |
| 许可 | GNU General Public License v3.0 |

「祈」适合这样的人：

- 想把日记留在自己手机里，而不是交给某个账号体系；
- 喜欢手账感：纸张背景、贴纸、涂鸦，而不是纯 Markdown 冷淡排版；
- 需要分类、收藏、搜索，但仍希望界面克制、不嘈杂；
- 希望应用本身开源，协议清晰，可以审计、可以二次分发（在 GPL-3.0 约束下）。

---

## 功能一览

### 日记与组织

- **首页时间线**：按日期浏览手账卡片，展示标题摘要、天气、心情与分类。
- **分类浏览**：日常、旅行、学习等分类筛选，进入分类条目列表。
- **收藏**：一键收藏重要篇目，在「收藏」页集中回看。
- **搜索**：按关键字检索标题与正文相关内容。
- **元信息**：每篇可设置天气、心情、分类；标题支持默认按日期生成。

### 富文本编辑器

编辑器基于内置 WebView（`assets/editor`），与 Compose 工具栏通过 `EditorBridge` 桥接：

- **文字**：加粗、斜体、下划线、对齐、字体族、字号、颜色等。
- **涂鸦**：Atrament + Rough.js 驱动的涂鸦层，支持笔刷、橡皮、撤销重做、合并到正文。
- **照片**：从相册导入图片，插入日记并纳入条目媒体管理。
- **贴纸**：
  - 内置表情贴纸；
  - 可从本地导入图片贴纸（压缩至约 256KB 以下）；
  - 支持拖动、缩放、旋转与删除；
  - 贴纸可自由放置在日记任意位置；
  - 「已导入贴纸」库跨日记复用；长按可从库中移除（不影响已写入正文的贴纸）。

### 备份与恢复

- 在「我的」中导出全部条目为 ZIP；
- 备份包含 `manifest.json`、条目媒体 `media/...`，以及用户贴纸库 `stickers/...`；
- 导入时可跳过已存在条目，尽量安全合并。

### 体验细节

- 窄屏（约 300–500dp 宽度）布局适配；
- 系统返回与顶栏返回会尝试保存；
- **空内容覆盖保护**：若检测到本有内容的手账即将被存成空白，会弹出确认对话框，避免异常情况下静默清空。

---

## 界面印象

> 下列配图用于说明产品气质与信息架构，部分为示意合成图；实机界面以安装包为准。

### 首页

首页强调「一本本摊开的日子」：日期、标题、天气与心情一目了然，底部导航收敛为首页 / 分类 / 收藏 / 我的。

<p align="center">
  <img src="docs/images/screenshot-home.png" alt="首页时间线示意" width="320" />
</p>

### 编辑页

编辑页像一张铺开的纸。底部工具栏在「文字、涂鸦、照片、贴纸」之间切换；贴纸以绝对定位叠在纸面上，可随时再选中调整。

<p align="center">
  <img src="docs/images/screenshot-editor.png" alt="编辑器与贴纸示意" width="320" />
</p>

### 架构鸟瞰

本地优先：Compose UI 负责导航与面板，Room 负责条目元数据，WebView 负责正文画布，文件系统负责图片与贴纸库，备份以 ZIP 打包上述内容。

<p align="center">
  <img src="docs/images/architecture-overview.png" alt="架构示意：列表、编辑器、本地备份" width="100%" />
</p>

---

## 技术架构

### 总体分层

```
┌──────────────────────────────────────────────┐
│  UI（Jetpack Compose · Material 3）          │
│  Home / Category / Favorites / Profile / Editor │
├──────────────────────────────────────────────┤
│  ViewModel · Repository · Room（JournalEntry）│
├──────────────────────────────────────────────┤
│  EditorBridge ←→ WebView（editor.html/js/css）│
│  Atrament · Rough.js · Moveable.js           │
├──────────────────────────────────────────────┤
│  JournalMediaStore · UserStickerStore        │
│  JournalBackupManager（ZIP import/export）   │
└──────────────────────────────────────────────┘
```

### 关键技术选型

- **语言 / UI**：Kotlin、Jetpack Compose、Navigation Compose
- **持久化**：Room、DataStore（主题与设置类偏好）
- **编辑器**：Android WebView + 自托管前端资源
- **涂鸦**：[Atrament.js](https://github.com/meltingice/atrament.js)、[Rough.js](https://github.com/rough-stuff/rough)
- **贴纸变换**：[Moveable](https://github.com/daybrush/moveable)（vendored 于 `app/src/main/assets/editor/vendor/`）
- **构建**：Android Gradle Plugin、KSP（Room）

### 编辑器要点

正文 HTML 保存在 Room 的 `content` 字段中。图片在保存路径上会尽量迁移为 `journal-media://` 本地引用，避免巨大的 Base64 长期堆积。贴纸以 `.journal-sticker` 节点写入 HTML，位置通过 `left` / `top`（及 data 属性）持久化。用户贴纸库独立存放在应用私有目录 `filesDir/user_stickers/`，与单篇条目解耦。

自动保存采用防抖；退出时再拉取一次最新内容。针对「非空日记被异常写成空 HTML」的情况，退出保存前会弹出红色「继续保存」与「取消」选项：取消将强制恢复受保护内容并退出。

---

## 隐私与数据

- 日记、图片、贴纸默认保存在应用私有存储中。
- 应用**不包含**强制账号登录，也**不以云同步作为默认能力**。
- 导出备份由用户主动触发；请妥善保管 ZIP 文件，其中可能含有个人文字与图片。
- 卸载应用通常会删除私有数据（除非系统备份策略另有规定）；重要内容请定期导出。

我们鼓励把「数据主权」当作产品原则：开源可审计，本地可导出，备份可迁移。

---

## 构建与运行

### 环境要求

- Android Studio Ladybug / 更新版本（或等价 JDK 17+ / 项目配置的 JDK）
- Android SDK Platform 36（见 `compileSdk`）
- 推荐真机或 API 29+ 模拟器

### 调试构建

```bash
./gradlew :app:assembleDebug
```

Windows 示例输出目录（本仓库将 Gradle `buildDirectory` 重定向到本地 AppData，减轻 OneDrive 锁文件问题）：

`%LOCALAPPDATA%\Inorinal\gradle-build\app\outputs\apk\debug\`

### 发行构建

```bash
./gradlew :app:assembleRelease
```

若使用 Android Studio「Generate Signed Bundle / APK」，建议将输出目录设置在 OneDrive 之外，例如：

`%LOCALAPPDATA%\Inorinal\release\`

Release 构建默认关闭 `lintVital` 阻断（`checkReleaseBuilds = false`），以避免 Windows 下 lint 缓存 jar 被占用导致的偶发失败。你仍可单独运行 lint 任务做静态检查。

### 安装

```bash
adb install -r app-debug.apk
```

---

## 项目结构

```
Inorinal/
├── app/
│   ├── build.gradle.kts
│   └── src/main/
│       ├── assets/editor/          # WebView 编辑器与 vendor
│       ├── java/com/green/inorinal/
│       │   ├── backup/             # ZIP 备份
│       │   ├── data/               # Room / ViewModel
│       │   ├── editor/             # EditorBridge
│       │   ├── media/              # 条目媒体与用户贴纸库
│       │   └── ui/                 # Compose 界面
│       └── res/
├── docs/images/                    # 自述文档配图
├── LICENSE                         # GPL-3.0
├── CHANGELOG.md
└── README.md
```

---

## 开源许可

本项目以 **GNU General Public License v3.0** 发布，详见根目录 [`LICENSE`](LICENSE)。

简要理解（非正式法律建议）：

- 你可以自由使用、研究、修改和分发本软件；
- 若你分发修改后的版本，一般需要以 GPL-3.0 开源对应源代码，并保留版权与许可声明；
- 本软件不提供担保。

第三方组件（如 Atrament、Rough、Moveable、AndroidX 等）各有其许可证；应用内「开源许可证」页面亦有汇总。二次分发时请一并遵守这些依赖的许可义务。

---

## 致谢

- 所有在日记与手账传统中默默书写的人；
- Jetpack Compose、Room 与 Android 开源社区；
- 编辑器所使用的优秀前端开源项目维护者；
- 以及每一位愿意提交 Issue、补丁或只是安静使用「祈」的朋友。

<p align="center"><em>以本软件献给我最亲爱的小不点儿～</em></p>

---

## 版本更新日志

完整历史见 [`CHANGELOG.md`](CHANGELOG.md)。以下摘录首个公开发行版要点。

### Alpha v0.2.3（首个公开 GitHub Release）

- 可交互贴纸：导入、拖动、缩放、旋转、删除；自由定位
- 用户贴纸库：≤256KB 压缩、跨日记复用、长按删库、备份导入导出
- 编辑器稳健性：修复脚本编码损坏导致的正文清空 / 字体失效
- 空内容覆盖保护对话框
- 窄屏布局与图片插入相关修复的延续
- 构建：缓解 OneDrive / lint 缓存锁文件问题

### Alpha v0.2.1

- 涂鸦引擎重建与一系列 P0 稳健性修复

### 更早

- 日记核心、分类收藏、备份与编辑器基建

---

## 参与贡献

欢迎通过 GitHub Issue 报告缺陷或提出想法。提交 PR 前请：

1. 说明动机与复现 / 验证方式；
2. 保持改动聚焦，避免无关格式化大爆炸；
3. 若改动编辑器 JS，请注意 **UTF-8 编码**，贴纸 emoji 等建议使用 `\u` 转义，以免在部分 Windows 工具链下再次损坏脚本；
4. 遵守 GPL-3.0。

安全相关问题请负责任地披露，避免在公开 Issue 中粘贴可导致大规模隐私泄露的样本数据。

---

## 路线图（非承诺）

Alpha 阶段可能探索的方向包括：更细的排版样式、贴纸与文字环绕的可选模式、导出为图片 / PDF、更完善的备份校验与冲突策略、无障碍与更大字体模式等。路线图会随使用者反馈调整，不构成交付承诺。

---

**仓库：** [github.com/Green233233/Inorinal](https://github.com/Green233233/Inorinal)  
**当前版本：** Alpha v0.2.3  
**许可证：** GPL-3.0
