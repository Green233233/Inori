# 更新日志（Changelog）

本文件记录「祈 / Inorinal」的用户可见变更。版本号采用 `Alpha vX.Y.Z` 形式；Git 标签建议为 `vX.Y.Z`。

图片仅作示意，实机界面以安装包为准。

<p align="center">
  <img src="docs/images/hero-banner.png" alt="祈" width="80%" />
</p>

---

## [Alpha v0.5.1-react] — 2026-11-14

**React Native 界面重构版（`react` 分支）**

### 变更

- 界面层由 Jetpack Compose 迁移到 **React Native 0.88 + TypeScript**，保持首页 / 分类 / 收藏 / 我的四个标签页、全屏路由与编辑器布局
- 全新**轻拟物 + 毛玻璃 + 暖色撞色**视觉：柔和双层描边与轻阴影卡片、半透明磨砂顶栏/底栏/面板、珊瑚 / 蜜橘 / 芥末黄 / 松绿 / 莓紫撞色色块；保留樱粉 / 薄荷 / 长春花三套配色与浅色/深色模式，刻意避开蓝紫科技渐变
- 性能取舍：毛玻璃以静态磨砂纹理 + 半透明层模拟，不启用实时模糊，避免滚动与输入掉帧
- 数据层：Room → 应用私有目录 **JSON 条目 + 元数据索引 + 媒体目录**；新增旧版 Room 数据只读迁移（升级后首次启动自动导入）
- 备份：ZIP 格式与 Compose 版保持兼容（`manifest.json` 数组、`media/`、`stickers/`），支持导出/导入
- 编辑器：复用原 `assets/editor` WebView 前端（Atrament / Rough / Moveable）与 LXGW 文楷字体；通过 RN ↔ WebView 消息桥驱动，保留文字样式、涂鸦、照片、贴纸、贴纸库与空内容覆盖保护
- 媒体保存改为 **SHA-256 去重落盘**，修复原实现中重复保存产生孤儿文件的问题
- 原生依赖精简：自建 Kotlin 桥接模块（文件 / 媒体压缩 / 图片选择 / SAF / 迁移）+ `react-native-webview` + JSZip

### 已知差异

- 设置中的「跟随系统」配色风格在 RN 版回退为樱花粉（Android 12 动态取色不可移植）
- 分类页统一使用「情绪」文案（Compose 版分类页为「情感」）
- 界面背景与卡片由渐变/纸质纹理改为轻拟物玻璃质感与暖色撞色

### 构建信息

- `versionName`：`Alpha v0.5.1-react`
- `versionCode`：`7`
- 应用包名：`com.green.inorinal`

---

## [Alpha v0.2.3] — 2026-08-04

**首个公开发布（GitHub Release）**

### 新增

- **可交互贴纸**
  - 支持导入本地图片作为贴纸
  - 选中后可拖动、等比缩放、旋转
  - 选中框旁提供圆形删除按钮
  - 贴纸采用绝对定位，可放置在日记任意位置（文字区域或空白处）
- **用户贴纸库**
  - 导入贴纸默认压缩到约 256KB 以下，进入「已导入贴纸」
  - 跨日记复用；长按可从库中删除（不影响已写入正文的贴纸）
  - 「导出条目」备份 ZIP 增加 `stickers/`，导入时恢复贴纸库
- **空内容覆盖保护**
  - 当非空手账即将被保存为空内容时弹出确认框
  - 「继续保存」（红色）允许清空；「取消」强制恢复受保护内容并退出
- **文档与许可**
  - 仓库采用 GPL-3.0
  - 新增详细 README 与本更新日志，附产品配图

### 修复

- 修复 `editor.js` 贴纸 emoji 编码损坏导致的严重回归：贴纸无法插入、打开日记内容被清空、字体工具全部失效
- 字号规范化时保留字体族与文字颜色，避免改字号冲掉样式
- 缓解近距离贴纸被合并为同一调整框的问题（关闭 Moveable 分组）
- 构建：规避 OneDrive 下 `app/release` 目录锁；关闭 release `lintVital` 以避免 Windows 下 lint 缓存 jar 占用失败

### 依赖 / 第三方

- 编辑器引入 Moveable（见应用内开源许可证页与 `assets/editor/vendor/moveable.min.js`）

### 构建信息

- `versionName`：`Alpha v0.2.3`
- `versionCode`：`6`

<p align="center">
  <img src="docs/images/screenshot-editor.png" alt="编辑器与贴纸" width="280" />
</p>

---

## [Alpha v0.2.1] — 2026-06

### 变更摘要

- 涂鸦引擎重建（Atrament + Rough 相关能力强化）
- 一批 P0 稳健性修复（保存、媒体与编辑器桥接等）

---

## [更早版本] — 2026-06 起

### 奠基能力

- 日记 CRUD、天气 / 心情 / 分类
- 首页、分类、收藏、我的、关于
- Compose Material 3 主题（浅色 / 深色 / 跟随系统）
- WebView 富文本编辑器初版
- 照片插入与本地媒体存储
- ZIP 备份导入导出
- 窄屏（约 300–500dp）布局适配与图片插入修复（后续提交延续）

<p align="center">
  <img src="docs/images/screenshot-home.png" alt="首页" width="280" />
</p>

---

## 版本对照

| 版本 | versionCode | 说明 |
|------|-------------|------|
| Alpha v0.5.1-react | 7 | React Native 重构；轻拟物 + 毛玻璃 + 暖色撞色界面；数据层迁移 |
| Alpha v0.2.3 | 6 | 首个公开 GitHub Release；贴纸库与空保存保护 |
| Alpha v0.2.1 | 5 | 涂鸦重建与稳健性 |
| 更早 | — | 核心日记与备份 |

---

## 升级说明

从 Alpha v0.2.3（Compose）升级到 Alpha v0.5.1-react：

1. 建议先在旧版「我的 → 导出条目」导出一次 ZIP 备份；
2. 安装新包（同包名覆盖安装，旧数据库会保留）；
3. 首次启动会自动尝试从旧版 Room 数据库迁移日记与媒体；若迁移不完整，可在「我的 → 导入条目」中导入刚才的 ZIP；
4. RN 版不再读取 Room，旧数据库只读保留，可随时回退旧版本。

从旧 Alpha 升级到 v0.2.3：

1. 安装新包（建议先导出备份）
2. 旧日记中的浮动贴纸会在打开时尝试迁移为绝对定位
3. 新导入的贴纸会出现在「已导入贴纸」；旧备份若不含 `stickers/` 则仅恢复条目与媒体

---

以本软件献给我最亲爱的小不点儿～
