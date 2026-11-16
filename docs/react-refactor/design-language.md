# 视觉语言：Apple Music「新发现」式鲜明撞色 + 轻量玻璃

本分支（`react`）的视觉方向以 Apple Music CN「新发现」页为参考，但不复制其商标、Logo 或专辑资产。目标是：**黑底编辑感、明亮饱和度、青春撞色、克制的玻璃层**；同时明显避开「蓝紫 AI 科技风」和上一版的暖米色纸感。

设计契约见根目录 [`DESIGN.md`](../../DESIGN.md)；Apple Music 参考重建稿见 [`docs/design-references/apple-music-cn-new.DESIGN.md`](../design-references/apple-music-cn-new.DESIGN.md)。

## 核心原则

1. **黑/白是舞台，颜色是内容**：深色 `#050507`、浅色 `#F5F5F7`；高饱和红、蓝、青、黄绿只用于分类、日期、统计、主 CTA 与 hero。
2. **编辑式大标题**：页面标题 30–34px/700，左对齐；分区标题 20px/700；正文 15/20；说明 12/16；导航标签 11/14。
3. **玻璃是 chrome，不是背景**：浮动 dock、顶栏、工具 dock、Sheet、Dialog 才使用半透明玻璃；列表卡片是实色 surface + 1px separator。
4. **轻量但可读的 Glass Icons**：Nucleo Glass 的 42 个图标在构建时栅格化为浅/深两套 PNG；颜色由所在色块提供。极小尺寸的辅助信息改用文字 pill，避免玻璃图标缩成圆点。
5. **动效只服务反馈与空间关系**：按压、tab、路由、sheet、收藏、列表入场；全部 transform/opacity、原生驱动、可被系统 reduce-motion 关闭。

## 色板

| 语义 | 深色 | 浅色 |
|---|---|---|
| canvas | `#050507` | `#F5F5F7` |
| surface | `#121216` | `#FFFFFF` |
| elevated | `#1C1C22` | `#FFFFFF` |
| ink | `#F5F5F7` | `#111114` |
| muted | `#A1A1AA` | `#6E6E73` |
| separator | `rgba(255,255,255,.12)` | `rgba(0,0,0,.08)` |
| primary | `#FF2D55` | `#FA2D48` |
| blue | `#0A84FF` | `#007AFF` |
| cyan | `#32D7FF` | `#00B8D9` |
| lime | `#C6FF3D` | `#65C400` |
| yellow | `#FFD60A` | `#F5C200` |
| green | `#28CD41` | `#1DB954` |

分类：全部蓝、日常黄、工作橙、目标绿、灵感粉、情绪青。统计：日记红、连续青、收藏黄绿。

## 形状与间距

- 圆角：8 小控件 / 12 小卡 / 16–18 卡片 / 20 hero / 26–28 浮动 dock / 999 pill。
- 间距：4、8、12、16、20、24、28、32、40；页面 gutter 16（窄屏 12）。
- 深度：深色主要靠 surface 层级和 separator；浅色可用极轻 elevation，但不使用暖色投影或双层拟物描边。

## 玻璃

`GlassSurface` = 半透明 fill + 静态 frost texture + 1px 高光边。**不使用实时 backdrop blur**：Apple Music 的 `blur(60px)` 在 RN/Android 上会带来持续离屏合成成本，本项目用静态纹理模拟。玻璃只出现在导航、工具 dock、Sheet、Dialog 和少量顶栏。

## 动效

参数集中在 `src/theme/motion.ts`：

| 场景 | 动效 | 参数 |
|---|---|---|
| 底部 tab | Liquid tab indicator | spring，indicator translateX |
| 卡片按下 | 轻缩放 | 140ms，scale 0.975 |
| 收藏 | 心形弹跳 | spring 1→1.28→1 |
| 页面 push/pop | Back Parallax | 300/220ms，translateX + 底层 scale |
| 搜索 | 淡入下滑 | 180ms |
| Sheet | scrim + translateY | 240ms，native driver |
| 列表首次出现 | Stagger Settle | 40ms 间隔，最多 6 项 |
| 骨架 | opacity pulse | 900ms，load 后停止 |
| 统计 | count-in | 450ms，一次 |

所有循环动画在卸载时停止；reduce-motion 下改为短淡入/静态。

## 性能约束

- 不引入实时模糊、不在动画里改 layout/paint、不做 scroll 驱动的 JS 动画。
- 图标是构建时 PNG，不运行时渲染 SVG filter。
- 列表动效只做首屏一次；长列表不逐项常驻动画。
- 视觉验收与性能验收同时通过才算完成。
