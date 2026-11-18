import {type} from './typography';

/**
 * 全局显示大小（DPI 四档）。
 *
 * 做法是调整字号标度的基准值：`type` 里的每一档按系数重新计算
 * `fontSize` / `lineHeight`，再让根组件按 key 重挂载，页面里所有
 * `type.body`、`type.caption` 的引用都会拿到新值。
 *
 * 说明：少数在模块加载时就展开进 `StyleSheet.create` 的样式（例如
 * `{...type.body}`）不会跟随，这类地方比例很小，不影响整体可读性。
 */
export type UiScale = 'small' | 'medium' | 'large' | 'xlarge';

export const UI_SCALE_ORDER: UiScale[] = ['small', 'medium', 'large', 'xlarge'];

export const UI_SCALE_LABEL: Record<UiScale, string> = {
  small: '偏小',
  medium: '中等',
  large: '偏大',
  xlarge: '特大',
};

const FACTOR: Record<UiScale, number> = {
  small: 0.92,
  medium: 1,
  large: 1.1,
  xlarge: 1.2,
};

type TypeKey = keyof typeof type;

const BASE: Record<TypeKey, {fontSize?: number; lineHeight?: number}> =
  Object.fromEntries(
    Object.entries(type).map(([key, value]) => [
      key,
      {...(value as {fontSize?: number; lineHeight?: number})},
    ]),
  ) as Record<TypeKey, {fontSize?: number; lineHeight?: number}>;

let current: UiScale = 'medium';

function apply(scale: UiScale): void {
  const factor = FACTOR[scale] ?? 1;
  (Object.keys(BASE) as TypeKey[]).forEach(key => {
    const base = BASE[key];
    const target = type[key] as {fontSize?: number; lineHeight?: number};
    if (typeof base.fontSize === 'number') {
      target.fontSize = Math.round(base.fontSize * factor);
    }
    if (typeof base.lineHeight === 'number') {
      target.lineHeight = Math.round(base.lineHeight * factor);
    }
  });
  current = scale;
}

export function applyUiScale(scale: UiScale): void {
  if (scale === current) {
    return;
  }
  apply(scale);
}

export function currentUiScale(): UiScale {
  return current;
}
