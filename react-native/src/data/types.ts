/** Domain model ported from data/JournalEntry.kt (Kotlin enum names kept). */

export type Weather = 'SUNNY' | 'CLOUDY' | 'RAINY' | 'NIGHT_CLEAR';
export type Mood = 'HAPPY' | 'CALM' | 'SAD';
export type Category =
  | 'ALL'
  | 'DAILY'
  | 'WORK'
  | 'GOAL'
  | 'INSPIRATION'
  | 'EMOTION';

export interface JournalEntry {
  id: string;
  title: string;
  content: string;
  /** ISO_LOCAL_DATE: YYYY-MM-DD */
  date: string;
  weather: Weather;
  mood: Mood;
  category: Category;
  isFavorite: boolean;
  imageUrl?: string | null;
  createdAt: number;
  updatedAt: number;
  /** 祈 v0.6.0：共享/私密与作者（旧数据缺省视为本人共享）。 */
  visibility?: 'private' | 'pair';
  authorDeviceId?: string;
  revision?: number;
  deletedAt?: number | null;
}

/** Lightweight row kept in index.json for fast list rendering/search. */
export interface EntrySummary {
  id: string;
  title: string;
  date: string;
  weather: Weather;
  mood: Mood;
  category: Category;
  isFavorite: boolean;
  imageUrl?: string | null;
  createdAt: number;
  updatedAt: number;
  preview: string;
  searchText: string;
  /** 对方的日记在本地只读镜像中出现：带作者与只读标记。 */
  visibility?: 'private' | 'pair';
  authorDeviceId?: string;
  readOnly?: boolean;
}

export const WEATHER_LABEL: Record<Weather, string> = {
  SUNNY: '晴天',
  CLOUDY: '阴天',
  RAINY: '雨天',
  NIGHT_CLEAR: '夜晚',
};

/** TalkBack descriptions in the Compose app differ from display names. */
export const WEATHER_A11Y: Record<Weather, string> = {
  SUNNY: '晴天',
  CLOUDY: '多云',
  RAINY: '雨天',
  NIGHT_CLEAR: '晴朗夜晚',
};

export const MOOD_LABEL: Record<Mood, string> = {
  HAPPY: '开心',
  CALM: '无感',
  SAD: '伤心',
};

export const MOOD_A11Y: Record<Mood, string> = {
  HAPPY: '开心',
  CALM: '平静',
  SAD: '难过',
};

export const CATEGORY_LABEL: Record<Category, string> = {
  ALL: '全部',
  DAILY: '日常',
  WORK: '工作',
  GOAL: '目标',
  INSPIRATION: '灵感',
  EMOTION: '情绪',
};

/** CategoryScreen used "情感" for EMOTION (label divergence); one canonical
 * label ("情绪") is used here, matching JournalCard/Editor/CategoryEntries. */
export const CATEGORY_ICON = {
  ALL: 'categoryAll',
  DAILY: 'categoryDaily',
  WORK: 'categoryWork',
  GOAL: 'categoryGoal',
  INSPIRATION: 'categoryInspiration',
  EMOTION: 'categoryEmotion',
} as const satisfies Record<Category, string>;

export const CATEGORY_ORDER: Category[] = [
  'ALL',
  'DAILY',
  'WORK',
  'GOAL',
  'INSPIRATION',
  'EMOTION',
];

export const SELECTABLE_WEATHER: Weather[] = [
  'SUNNY',
  'CLOUDY',
  'RAINY',
  'NIGHT_CLEAR',
];
export const SELECTABLE_MOOD: Mood[] = ['HAPPY', 'CALM', 'SAD'];
export const SELECTABLE_CATEGORY: Category[] = [
  'DAILY',
  'WORK',
  'GOAL',
  'INSPIRATION',
  'EMOTION',
];

const LEGACY_WEATHER: Record<string, Weather> = {
  SNOWY: 'CLOUDY',
};
const LEGACY_MOOD: Record<string, Mood> = {
  EXCITED: 'HAPPY',
  PROUD: 'HAPPY',
  EMOTIONAL: 'CALM',
};

export function normalizeWeather(value: unknown): Weather {
  const raw = String(value ?? '');
  if (LEGACY_WEATHER[raw]) {
    return LEGACY_WEATHER[raw];
  }
  return (SELECTABLE_WEATHER as string[]).includes(raw)
    ? (raw as Weather)
    : 'SUNNY';
}

export function normalizeMood(value: unknown): Mood {
  const raw = String(value ?? '');
  if (LEGACY_MOOD[raw]) {
    return LEGACY_MOOD[raw];
  }
  return (SELECTABLE_MOOD as string[]).includes(raw) ? (raw as Mood) : 'HAPPY';
}

export function normalizeCategory(value: unknown): Category {
  const raw = String(value ?? '');
  if (raw === 'ALL') {
    return 'DAILY';
  }
  return (SELECTABLE_CATEGORY as string[]).includes(raw)
    ? (raw as Category)
    : 'DAILY';
}

export type ColorStyle = 'SAKURA' | 'MINT' | 'PERIWINKLE' | 'SYSTEM';
export type ThemeMode = 'LIGHT' | 'DARK' | 'SYSTEM';

export const COLOR_STYLE_LABEL: Record<ColorStyle, string> = {
  SAKURA: '草莓波普',
  MINT: '青柠电流',
  PERIWINKLE: '电光蓝调',
  SYSTEM: '跟随系统',
};

export const THEME_MODE_LABEL: Record<ThemeMode, string> = {
  LIGHT: '浅色',
  DARK: '深色',
  SYSTEM: '跟随系统',
};

export const COLOR_STYLE_ORDER: ColorStyle[] = [
  'SAKURA',
  'MINT',
  'PERIWINKLE',
  'SYSTEM',
];
export const THEME_MODE_ORDER: ThemeMode[] = ['LIGHT', 'DARK', 'SYSTEM'];

export interface AppSettings {
  colorStyle: ColorStyle;
  themeMode: ThemeMode;
  fontSize: number;
  debugMode: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  colorStyle: 'SAKURA',
  themeMode: 'SYSTEM',
  fontSize: 16,
  debugMode: false,
};

export function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const WEEKDAYS = [
  '星期日',
  '星期一',
  '星期二',
  '星期三',
  '星期四',
  '星期五',
  '星期六',
];

export function defaultEntryTitle(date = new Date()): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${
    WEEKDAYS[date.getDay()]
  }`;
}

export function parseEntryDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) {
    return new Date();
  }
  return new Date(y, m - 1, d);
}

export function dateLabel(iso: string): {day: string; month: string} {
  const date = parseEntryDate(iso);
  return {
    day: String(date.getDate()),
    month: `${date.getMonth() + 1}月`,
  };
}
