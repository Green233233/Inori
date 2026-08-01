# Doodle Engine Protocol

## Local Dependencies

- Atrament-compatible classic entry: `app/src/main/assets/editor/vendor/atrament.js`. It exposes `window.Atrament` and mode constants for Android WebView `file://` loading.
- Rough rendering entry: `app/src/main/assets/editor/vendor/rough.js`. It exposes the same `rough.canvas(...).curve(...)` surface used by the editor and can be replaced by the official Rough.js 4.6.6 browser bundle without code changes.
- The editor must load only local assets. `EditorBridge` keeps WebView network loading disabled.

## Data Schema

The persisted doodle payload is embedded in the editor HTML as a hidden `.doodle-data` node:

```json
{
  "version": 1,
  "canvas": {
    "width": 360,
    "height": 720,
    "dpr": 3
  },
  "strokes": [
    {
      "id": "timestamp-random",
      "type": "stroke",
      "tool": "pencil",
      "points": [
        { "x": 12.5, "y": 18.25, "time": 0, "pressure": 0.5 }
      ],
      "color": "#000000",
      "width": 3,
      "roughness": 1.4,
      "atramentOptions": {
        "smoothing": 0.85,
        "adaptiveStroke": true
      },
      "createdAt": 1785556800000
    }
  ],
  "bitmapLayers": [],
  "updatedAt": 1785556800000
}
```

## H5 API

- `toggleDoodleMode(active)`
- `setBrush(tool)` where `tool` can be `pencil`, `pen`, `marker`, `watercolor`, `highlighter`, or `eraser`
- `setBrushSize(size)`
- `setBrushColor(color)`
- `setBrushRoughness(roughness)`
- `undoDoodle()`, `redoDoodle()`, `clearDoodle()`
- `getDoodleJson()`, `loadDoodleJson(json)`
- `exportDoodleImage()`
- `insertDoodleImage()`
- `getDoodleState()`

## Android Bridge API

- `AndroidBridge.onContentChanged(html)` receives editor HTML after content changes.
- `AndroidBridge.onDoodleStateChanged(stateJson)` receives undo/redo/tool state.
- `AndroidBridge.onImageClicked(dataUrl)` opens native image preview.
- `AndroidBridge.requestImageInsert()` opens the native image picker.

## Compatibility

- Old entries without `.doodle-data` load normally and start with an empty doodle state.
- Existing merged doodle images remain ordinary HTML images.
- New structured doodles are saved inside the existing `content` field, so Room schema migration is not required for this iteration.
- Backup export/import keeps doodle data because it already serializes the full HTML content.
# 涂鸦引擎本地化说明

## 本地依赖版本

- Atrament.js: 5.1.0，ESM 构建，本地文件 `app/src/main/assets/editor/vendor/atrament.esm.js`。
- Rough.js: 4.6.6，浏览器 IIFE 构建，本地文件 `app/src/main/assets/editor/vendor/rough.js`。

## 涂鸦 JSON schema

涂鸦数据建议以单个文档对象保存：

```json
{
  "version": 1,
  "width": 1080,
  "height": 1920,
  "background": "transparent",
  "strokes": [
    {
      "id": "stroke-uuid",
      "tool": "pen|marker|eraser|rough-shape",
      "color": "#000000",
      "size": 4,
      "opacity": 1,
      "points": [{ "x": 0, "y": 0, "t": 0, "p": 0.5 }],
      "rough": { "shape": "line|rectangle|ellipse", "seed": 1 }
    }
  ]
}
```

字段含义：`version` 用于迁移，`width`/`height` 是画布基准尺寸，`strokes` 按绘制顺序保存。普通笔迹使用 `points`，Rough.js 图形可在 `rough` 中保存形状和随机种子。

## H5 API

- `initDoodle(options)`: 初始化画布、依赖和默认工具。
- `setTool(tool, options)`: 切换画笔、橡皮或图形工具。
- `loadDoodle(json)`: 从 JSON 恢复涂鸦。
- `exportDoodle()`: 导出当前涂鸦 JSON。
- `clearDoodle()`: 清空当前画布。
- `undoDoodle()` / `redoDoodle()`: 撤销和重做。

## Android Bridge API

- `AndroidDoodleBridge.onReady()`: H5 初始化完成后通知 Android。
- `AndroidDoodleBridge.onChanged(json)`: 涂鸦变化时回传最新 JSON 或摘要。
- `AndroidDoodleBridge.requestSave(json)`: 用户触发保存时提交数据。
- `AndroidDoodleBridge.onError(message)`: H5 捕获异常时上报错误信息。

Android 侧可通过 `evaluateJavascript` 调用 H5 API，例如 `loadDoodle(...)`、`setTool(...)` 和 `exportDoodle()`。

## 兼容策略

- 优先加载本地 vendor 文件，避免运行时依赖外网 CDN。
- JSON schema 通过 `version` 做显式迁移；未知字段应保留，未知工具可降级为普通路径或跳过渲染。
- 坐标按画布基准尺寸保存，渲染时按实际视口缩放，降低设备分辨率差异影响。
- 保存失败或 Bridge 不可用时，H5 应保留内存中的最新 JSON，并提示 Android 侧重试。
