# Glass Icons

应用内全部图形图标来自 [Nucleo Glass Icons](https://nucleoapp.com/svg-glass-icons)，在构建时栅格化，不在运行时渲染 SVG 滤镜。

## 为什么栅格化

Nucleo 图标由多层渐变、mask、filter 组成。逐图标在 RN 里跑 SVG filter 会带来昂贵的离屏合成；因此 `scripts/generate-glass-icons.mjs` 用 headless Edge 把整张图标表渲染一次，再用 `sharp` 切成 PNG。

- 浅色 `light/`：白色玻璃，用于深色背景、深色卡片与高饱和色块；
- 深色 `dark/`：炭黑玻璃，用于浅色背景；
- 每个 PNG 96×96，运行时按 17–46dp 缩放；
- 颜色由容器决定：分类块、统计块、活跃 tab 使用对应 accent 背景，图标本身保持中性玻璃。

## 生成

```bash
cd react-native
npm run icons:generate
npm run icons:check
```

需要本机 Edge（或用 `EDGE_PATH` 指定 Chromium 路径）。生成结果提交在 `src/assets/glass-icons/`，日常构建不需要再跑生成脚本。

## 语义映射

| key | Nucleo 组件 | 用途 |
|---|---|---|
| home | IconHouse | 首页 tab |
| category | IconGrid | 分类 tab |
| favorite | IconHeart | 收藏 / 喜欢 |
| profile | IconUser | 我的 tab / 头像 |
| search | IconMagnifier | 搜索 |
| close | IconDeleteX | 关闭 |
| add | IconSparkle | 新建（“新发现”语义） |
| back | IconArrowBoldLeft | 返回 |
| more | IconDotsVertical | 更多 |
| delete | IconDeleteX | 删除 |
| edit | IconPen | 编辑 |
| settings | IconGear | 设置 |
| info | IconCircleInfo | 信息 / 关于 |
| cloudUpload | IconCloudUpload | 导出 |
| cloudDownload | IconCloudDownload | 导入 |
| refresh | IconRefresh | 检查更新 |
| file | IconFile | 许可 / 文件 |
| book | IconBookOpen | 关于 / 空态 |
| flame | IconFlame | 连续天数 |
| star | IconStar | 收藏（旧装饰） |
| check / circle | IconCircleCheck / IconCircleDots | 单选 |
| chevronRight | IconArrowBoldRight | 行尾 |
| categoryAll | IconGrid2 | 全部分类 |
| categoryDaily | IconCalendar | 日常 |
| categoryWork | IconSuitcase | 工作 |
| categoryGoal | IconRoadmap | 目标 |
| categoryInspiration | IconSparkle | 灵感 |
| categoryEmotion | IconHeart | 情绪 |
| weatherSun / Rain / Cloud / Night | IconBrightnessIncrease / IconSunCloudShowers / IconCloudSun / IconCloudMoon | 天气 |
| moodHappy / Sad / Neutral | IconFaceGrin / IconFaceWorried / IconThinkingHead | 心情 |
| text / doodle / photo / sticker | IconNote / IconPen / IconImage / IconMagicWandSparkle | 编辑器工具 |
| undo / redo | IconArrowBoldLeft / IconArrowBoldRight | 撤销 / 重做 |

## 许可

Nucleo Glass Icons 的使用遵循 [Nucleo license](https://nucleoapp.com/license)。应用「开放源代码许可」页已加入 Nucleo Glass 条目。若后续许可证要求变化，替换为 MIT 的 Icons8 Liquid Glass 时保持同一栅格化/映射流程即可。
