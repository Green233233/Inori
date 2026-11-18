/**
 * Local-first persistence. Entries live as one JSON file each (files/journal/
 * entries/<id>.json) plus a metadata index used by the list screens; media is
 * stored by the native module under files/journal_media/<id>/.
 */
import {native, joinPath, paths} from '../native/InorinalNative';
import {
  AppSettings,
  Category,
  DEFAULT_SETTINGS,
  EntrySummary,
  JournalEntry,
  normalizeCategory,
  normalizeMood,
  normalizeWeather,
} from './types';
import {htmlToPlainText, isSafeEntryId, previewOf} from './html';

let indexCache: EntrySummary[] | null = null;
let initialized = false;
let writeChain: Promise<unknown> = Promise.resolve();

async function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task);
  writeChain = run.catch(() => undefined);
  return run;
}

async function ensureInitialized(): Promise<void> {
  if (initialized) {
    return;
  }
  await Promise.all([
    native.makeDir(paths.journal()).catch(() => false),
    native.makeDir(paths.entries()).catch(() => false),
    native.makeDir(paths.mediaRoot()).catch(() => false),
    native.makeDir(paths.stickerRoot()).catch(() => false),
  ]);
  initialized = true;
}

function normalizeSummary(raw: any): EntrySummary | null {
  if (!raw || typeof raw !== 'object' || !isSafeEntryId(String(raw.id))) {
    return null;
  }
  return {
    id: String(raw.id),
    title: String(raw.title ?? ''),
    date: String(raw.date ?? ''),
    weather: normalizeWeather(raw.weather),
    mood: normalizeMood(raw.mood),
    category: normalizeCategory(raw.category),
    isFavorite: raw.isFavorite === true,
    imageUrl: raw.imageUrl ? String(raw.imageUrl) : null,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
    preview: String(raw.preview ?? ''),
    searchText: String(raw.searchText ?? ''),
    visibility: raw.visibility === 'private' ? 'private' : 'pair',
    authorDeviceId: raw.authorDeviceId ? String(raw.authorDeviceId) : undefined,
    readOnly: raw.readOnly === true,
  };
}

function sortSummaries(list: EntrySummary[]): EntrySummary[] {
  return [...list].sort((a, b) => b.createdAt - a.createdAt);
}

export async function loadIndex(): Promise<EntrySummary[]> {
  await ensureInitialized();
  if (indexCache) {
    return indexCache;
  }
  try {
    const text = await native.readText(paths.index());
    const parsed = JSON.parse(text);
    indexCache = Array.isArray(parsed)
      ? parsed
          .map(normalizeSummary)
          .filter((item): item is EntrySummary => item !== null)
      : [];
  } catch {
    indexCache = [];
  }
  indexCache = sortSummaries(indexCache);
  return indexCache;
}

async function writeIndex(list: EntrySummary[]): Promise<void> {
  indexCache = sortSummaries(list);
  await native.writeText(paths.index(), JSON.stringify(indexCache));
}

export async function getEntry(id: string): Promise<JournalEntry | null> {
  if (!isSafeEntryId(id)) {
    return null;
  }
  try {
    const text = await native.readText(
      joinPath(paths.entries(), `${id}.json`),
    );
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    return {
      id,
      title: String(raw.title ?? ''),
      content: String(raw.content ?? ''),
      date: String(raw.date ?? ''),
      weather: normalizeWeather(raw.weather),
      mood: normalizeMood(raw.mood),
      category: normalizeCategory(raw.category),
      isFavorite: raw.isFavorite === true,
      imageUrl: raw.imageUrl ? String(raw.imageUrl) : null,
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now(),
      visibility: raw.visibility === 'private' ? 'private' : 'pair',
      authorDeviceId: raw.authorDeviceId ? String(raw.authorDeviceId) : undefined,
      revision: Number(raw.revision) || 1,
      deletedAt: Number(raw.deletedAt) || null,
    };
  } catch {
    return null;
  }
}

export interface SaveOptions {
  /** Skip index/preview recomputation when only metadata changed? (unused) */
  silent?: boolean;
}

export async function saveEntry(
  entry: JournalEntry,
  _options: SaveOptions = {},
): Promise<JournalEntry> {
  await ensureInitialized();
  if (!isSafeEntryId(entry.id)) {
    throw new Error('Invalid journal entry id');
  }
  return serialize(async () => {
    const content = entry.content ?? '';
    const summary: EntrySummary = {
      id: entry.id,
      title: entry.title,
      date: entry.date,
      weather: entry.weather,
      mood: entry.mood,
      category: entry.category,
      isFavorite: entry.isFavorite,
      imageUrl: entry.imageUrl ?? null,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      preview: previewOf(content),
      searchText: htmlToPlainText(content).slice(0, 200000),
      visibility: entry.visibility === 'private' ? 'private' : 'pair',
      authorDeviceId: entry.authorDeviceId,
      readOnly: false,
    };
    const json = JSON.stringify({
      id: entry.id,
      title: entry.title,
      content,
      date: entry.date,
      weather: entry.weather,
      mood: entry.mood,
      category: entry.category,
      isFavorite: entry.isFavorite,
      imageUrl: entry.imageUrl ?? null,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      visibility: entry.visibility === 'private' ? 'private' : 'pair',
      authorDeviceId: entry.authorDeviceId,
      revision: entry.revision ?? 1,
      deletedAt: entry.deletedAt ?? null,
    });
    await native.writeText(
      joinPath(paths.entries(), `${entry.id}.json`),
      json,
    );
    const current = await loadIndex();
    const rest = current.filter(item => item.id !== summary.id);
    await writeIndex([...rest, summary]);
    return {...entry, content};
  });
}

export async function deleteEntry(id: string): Promise<void> {
  if (!isSafeEntryId(id)) {
    return;
  }
  await serialize(async () => {
    await native
      .deletePath(joinPath(paths.entries(), `${id}.json`))
      .catch(() => false);
    const current = await loadIndex();
    await writeIndex(current.filter(item => item.id !== id));
    await native.deleteEntryMedia(id).catch(() => false);
  });
}

export async function setFavorite(
  id: string,
  isFavorite: boolean,
): Promise<void> {
  const entry = await getEntry(id);
  if (!entry) {
    return;
  }
  await saveEntry({...entry, isFavorite, updatedAt: Date.now()});
}

export interface Stats {
  total: number;
  favorite: number;
  streak: number;
}

export function computeStats(entries: EntrySummary[]): Stats {
  const dates = new Set(entries.map(entry => entry.date).filter(Boolean));
  let streak = 0;
  const cursor = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  if (!dates.has(iso(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (dates.has(iso(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return {
    total: entries.length,
    favorite: entries.filter(item => item.isFavorite).length,
    streak,
  };
}

export function filterByQuery(
  entries: EntrySummary[],
  query: string,
): EntrySummary[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return entries;
  }
  return entries.filter(
    item =>
      item.title.toLowerCase().includes(q) ||
      item.searchText.toLowerCase().includes(q),
  );
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const text = await native.readText(paths.settings());
    const raw = JSON.parse(text);
    const colorStyle = ['SAKURA', 'MINT', 'PERIWINKLE', 'SYSTEM'].includes(
      raw.colorStyle,
    )
      ? raw.colorStyle
      : DEFAULT_SETTINGS.colorStyle;
    const themeMode = ['LIGHT', 'DARK', 'SYSTEM'].includes(raw.themeMode)
      ? raw.themeMode
      : DEFAULT_SETTINGS.themeMode;
    const fontSize =
      typeof raw.fontSize === 'number' ? raw.fontSize : DEFAULT_SETTINGS.fontSize;
    const defaultFont =
      raw.defaultFont === 'sans' || raw.defaultFont === 'round'
        ? raw.defaultFont
        : DEFAULT_SETTINGS.defaultFont;
    const defaultBrush =
      raw.defaultBrush === 'marker' || raw.defaultBrush === 'pencil'
        ? raw.defaultBrush
        : DEFAULT_SETTINGS.defaultBrush;
    return {
      colorStyle,
      themeMode,
      fontSize,
      defaultFont,
      defaultBrush,
      debugMode: raw.debugMode === true,
    };
  } catch {
    return {...DEFAULT_SETTINGS};
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await native.writeText(paths.settings(), JSON.stringify(settings));
}

export function categoriesCount(
  entries: EntrySummary[],
): Record<Category, number> {
  const counts: Record<Category, number> = {
    ALL: entries.length,
    DAILY: 0,
    WORK: 0,
    GOAL: 0,
    INSPIRATION: 0,
    EMOTION: 0,
  };
  for (const entry of entries) {
    if (entry.category !== 'ALL') {
      counts[entry.category] += 1;
    }
  }
  return counts;
}

