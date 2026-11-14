# 祈 / Inorinal — React Native 重构版

本目录是「祈」的 **React Native 0.88（TypeScript）** 重构版，对应仓库 `react` 分支，版本 **Alpha v0.5.1-react**（versionCode 7，包名 `com.green.inorinal`）。

界面采用**轻拟物 + 毛玻璃质感**与**鲜活暖色撞色**设计，保留原 Compose 版的全部功能与信息架构：

- 首页时间线（搜索 / 新建 / 收藏 / 长按菜单 / 删除确认）
- 分类浏览（全部 / 日常 / 工作 / 目标 / 灵感 / 情绪）
- 收藏、我的（统计、导出/导入备份、设置、关于）
- WebView 富文本编辑器：文字样式、涂鸦（Atrament/Rough）、照片、贴纸库与自由贴纸、空内容覆盖保护
- 本地 JSON 条目库 + 媒体目录；ZIP 备份与 Compose 版互通；旧版 Room 数据只读迁移

## 视觉与性能

- 轻拟物：`SoftCard` 用 1px 高光/阴影描边 + 低 elevation，按下切换为凹陷面。
- 毛玻璃：`GlassSurface` 用半透明底色 + 64×64 静态磨砂纹理；用于顶栏、底栏、编辑工具栏、Sheet 与 Dialog。
- 撞色：珊瑚红、蜜橘、芥末黄、松绿、莓紫；分类与统计使用固定暖色块。
- **不启用实时模糊**：避免 RenderEffect/BlurView 的逐帧离屏开销；靠纹理与透明层表达磨砂质感。
- 详细设计 token 见 [`docs/react-refactor/design-language.md`](../docs/react-refactor/design-language.md)。

## 目录

```
App.tsx                     导航栈 + 主题/数据 Provider
src/components/             图标、卡片、顶栏、对话框、Toast
src/data/                   类型、HTML、存储、备份、迁移、数据 Provider
src/editor/bridgeShim.ts    WebView ↔ RN 消息桥 shim
src/native/                 Kotlin 原生模块的 TypeScript 封装
src/screens/                各页面
src/theme/                  配色、布局 token、Material 图标码点
android/app/src/main/assets/editor/   复用的 WebView 编辑器资源
android/app/src/main/assets/fonts/    LXGW 文楷 + Material Icons
android/app/src/main/java/com/inorinal/nativebridge/   原生桥模块
```

## 开发

```bash
npm install
npm start                    # Metro
adb reverse tcp:8081 tcp:8081
npm run android              # 或 npx react-native run-android
```

## 构建

需要 JDK 21（`android/gradle.properties` 已指向 Android Studio 的 JBR）、Android SDK Platform 37 / Build-Tools 37、NDK 27.1。

```bash
cd android
./gradlew :app:assembleDebug    # 内置 JS bundle，可独立安装
./gradlew :app:assembleRelease  # 内置 JS bundle + Hermes 字节码，可直接安装
```

构建目录重定向到 `C:/rn-build`（可用 `INORINAL_BUILD_ROOT` 覆盖），CMake 中间产物在
`C:/rn-cxx`（可用 `INORINAL_CXX_ROOT` 覆盖），避免 OneDrive 文件锁与 Windows 260 字符路径限制。

## 数据

- `files/journal/entries/<id>.json`：单篇日记（完整 HTML）
- `files/journal/index.json`：列表元数据与搜索文本
- `files/journal_media/<entryId>/<sha256>.<ext>`：正文媒体（去重）
- `files/user_stickers/`：贴纸库
- `files/settings.json`：颜色风格 / 主题模式 / 字体大小 / 调试模式

编辑器正文中的媒体引用使用 `journal-media://local/<entryId>/<file>`，与 Compose 版一致；备份 ZIP 中改写为 `media/<entryId>/<file>`。

## 已知差异

- 「跟随系统」配色风格回退为樱花粉（动态取色不可移植）
- 分类页使用统一文案「情绪」
- 视觉为轻拟物 + 模拟毛玻璃 + 暖色撞色（不使用实时模糊，改用静态磨砂纹理与半透明层控制性能开销）

## 许可

GPL-3.0，详见仓库根目录 `LICENSE`。
