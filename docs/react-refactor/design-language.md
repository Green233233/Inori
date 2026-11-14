# 视觉语言：轻拟物 + 毛玻璃 + 暖色撞色

本文件记录 `react` 分支最终采用的视觉方向、设计 token 与性能取舍，作为
`ui-spec.md` / `profile-spec.md` / `editor-spec.md` 在配色与材质方面的补充。
早期版本曾采用扁平色块，现已整体替换。

## 目标与约束

- **轻拟物**：卡片、按钮、日期块像微微浮起的纸片/亚克力片，而不是纯色平面。
- **毛玻璃**：顶栏、底栏、编辑工具栏、底部弹层、对话框呈现半透明磨砂质感。
- **有活力的撞色**：珊瑚红、蜜橘、芥末黄、松绿、莓紫等暖色大胆并置，避免灰扑扑。
- **不做 AI 味蓝紫科技风**：不使用蓝紫渐变、霓虹光晕、玻璃拟态常见的青紫辉光；
  深色主题使用可可棕 / 森林绿 / 深莓紫，底色偏暖。
- **性能优先**：不引入实时模糊（RenderEffect / RenderScript / BlurView），
  用静态纹理 + 半透明 + elevation 模拟景深，保证滚动和 WebView 输入流畅。

## 色板

三套配色，每套含浅色/深色两版（`src/theme/palette.ts`）：

| 风格 | 浅色主色 | 浅色点缀 | 深色主色 | 深色底色 |
| --- | --- | --- | --- | --- |
| 樱花粉 SAKURA | `#D6435B` 珊瑚红 | `#F08A3C` 蜜橘 / `#2A9D8F` 松绿 | `#FF8B9B` | `#21141A` 可可 |
| 薄荷绿 MINT | `#128F78` 松石绿 | `#E4572E` 朱砂 / `#F2B705` 芥末 | `#6FE0C0` | `#12201B` 森林 |
| 长春花 PERIWINKLE | `#8C3F63` 莓紫 | `#2A9D8F` 松绿 / `#F2B705` 芥末 | `#F2A9C6` | `#22141F` 深莓 |

配套 token：

- `background` 暖纸底色（米白 / 奶油 / 象牙）
- `surface` 更亮的卡片纸色
- `surfaceVariant` 次级纸色
- `primaryContainer` 用于日期块、头像、About 图标等实色色块
- `outline` 低对比暖灰描边

分类色块使用固定的暖色 accent（`CATEGORY_ACCENT`）：全部松绿、日常芥末、
工作朱砂、目标松石、灵感珊瑚、情绪莓紫。统计色块同理：日记珊瑚、连续蜜橘、
收藏芥末。

## 材质 token

`buildSurfaces(colors, isDark)` 派生：

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `raised` | 纸底向白混 82% | surface 向白混 6% | 卡片、底板 |
| `raisedAlt` | surfaceVariant 向白混 55% | surface 向黑混 14% | 次级块 |
| `sunken` | 纸底向暖棕混 10% | 纸底向黑混 24% | 按下/凹陷、搜索框 |
| `glass` | surface→primary 3.5% + alpha 56% | 同色 + alpha 66% | 顶栏/底栏 |
| `glassStrong` | 同色 + alpha 92% | 同色 + alpha 94% | 弹层/对话框/工具栏 |
| `highlight` | `rgba(255,255,255,.94)` | `rgba(255,255,255,.11)` | 上/左边高光 |
| `shadow` | `rgba(120,78,62,.22)` | `rgba(0,0,0,.55)` | 下/右边阴影 |
| `ambientA/B` | primary / secondary 低透明 | 同色更低透明 | 环境光斑 |

## 组件实现

- `AmbientBackground`：一张 256px 径向光晕 PNG（`src/assets/glow.png`）用
  `tintColor` 染成主题色，叠 2~3 次形成柔和环境光；不使用渐变库或动画。
- `SoftCard`：1px 上/左高光 + 1px 下/右阴影 + elevation 1~2 + 顶部 38% 微高光；
  按下时翻转为凹陷（背景 `sunken`、elevation 0、描边互换）。
- `GlassSurface`：半透明底色 + 64px 磨砂噪点纹理（`src/assets/frost.png`，
  `resizeMode="repeat"`）+ 顶部高光 + 底边细线 + elevation。
  只用于少数条/面板/弹层，不铺在列表卡片上。
- 顶栏/底栏去掉左右和外侧描边，只留底/顶细线，避免出现“白色相框”。
- 底部弹层与对话框使用 `glassStrong`（92%+），保证文字可读；背景内容只轻微透出。

## 性能取舍

- Android 的 `shadowColor/Offset` 不可靠，统一用 `elevation` + 双色描边表达轻拟物。
- 不使用实时高斯模糊：省掉逐帧离屏渲染和 RenderScript/RenderEffect 兼容分支。
- 磨砂纹理为 64×64 PNG 平铺，内存占用极小；光晕为单张 256×256 PNG。
- 玻璃面板只在顶栏、底栏、编辑工具栏、Sheet、Dialog 出现，数量有限；
  列表卡片仅 elevation，无 blur、无动画。
- 所有按压反馈均为颜色/ elevation 变化，不做弹簧/缩放动画。

## 相关文件

- `src/theme/palette.ts`（色板 + surface tokens）
- `src/theme/AppThemeProvider.tsx`（注入 colors/surfaces）
- `src/components/Surfaces.tsx`（AmbientBackground / SoftCard / GlassSurface）
- `src/assets/glow.png`、`src/assets/frost.png`
- 各屏幕与 `JournalCard`、`TopBar`、`Ui` 的样式
