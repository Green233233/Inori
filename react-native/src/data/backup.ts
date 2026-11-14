/**
 * ZIP backup export/import, compatible with the Compose app's format:
 *   manifest.json (top-level ARRAY), media/<entryId>/<file>, stickers/<file>
 * Manifest keys are camelCase enum names, dates are YYYY-MM-DD, media refs
 * inside `content` are rewritten journal-media:// -> media/.
 */
import JSZip from 'jszip';
import {native, joinPath, paths} from '../native/InorinalNative';
import {
  JournalEntry,
  Mood,
  Weather,
  Category,
  normalizeWeather,
  normalizeMood,
  normalizeCategory,
  todayIso,
} from './types';
import {
  extractMediaRefs,
  isSafeEntryId,
  isSafeFileName,
  restoreBackupHtml,
  stripEditorState,
  toBackupHtml,
} from './html';
import {getEntry, loadIndex, saveEntry} from './storage';

const MAX_ARCHIVE_FILES = 5000;
const MAX_BACKUP_ENTRIES = 10000;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_MEDIA_FILE_BYTES = 20 * 1024 * 1024;
const MAX_STICKER_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_MEDIA_BYTES = 128 * 1024 * 1024;
const MAX_TITLE_LENGTH = 500;
const MAX_CONTENT_LENGTH = 10_000_000;

export interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
}

export function importResultMessage(result: ImportResult): string {
  return `导入完成：新增 ${result.imported} 篇，跳过 ${result.skipped} 篇，失败 ${result.failed} 篇`;
}

function randomId(): string {
  // Format-compatible with UUIDs used by the Compose app.
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 32; i += 1) {
    out += hex[Math.floor(Math.random() * 16)];
    if (i === 7 || i === 11 || i === 15 || i === 19) {
      out += '-';
    }
  }
  return out;
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

interface ParsedRow {
  entry: JournalEntry;
}

function parseRow(raw: any, failedRef: {value: number}): ParsedRow | null {
  if (!raw || typeof raw !== 'object') {
    failedRef.value += 1;
    return null;
  }
  const idCandidate = typeof raw.id === 'string' ? raw.id.trim() : '';
  const id = idCandidate === '' ? randomId() : idCandidate;
  if (!isSafeEntryId(id)) {
    failedRef.value += 1;
    return null;
  }
  const content = typeof raw.content === 'string' ? raw.content : '';
  if (content.length > MAX_CONTENT_LENGTH) {
    failedRef.value += 1;
    return null;
  }
  let title = typeof raw.title === 'string' ? raw.title : '';
  if (title.trim() === '') {
    title = '未命名日记';
  }
  title = title.slice(0, MAX_TITLE_LENGTH);
  const dateRaw = typeof raw.date === 'string' ? raw.date.trim() : '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : todayIso();
  const weather: Weather = normalizeWeather(raw.weather);
  const mood: Mood = normalizeMood(raw.mood);
  const category: Category = normalizeCategory(raw.category);
  const isFavorite = raw.isFavorite === true;
  const imageUrl =
    typeof raw.imageUrl === 'string' && raw.imageUrl.trim() !== ''
      ? raw.imageUrl
      : null;
  const createdAt = numeric(raw.createdAt) ?? Date.now();
  const updatedAt = numeric(raw.updatedAt) ?? Date.now();
  return {
    entry: {
      id,
      title,
      content,
      date,
      weather,
      mood,
      category,
      isFavorite,
      imageUrl,
      createdAt,
      updatedAt,
    },
  };
}

export async function exportBackup(): Promise<void> {
  const summaries = await loadIndex();
  const zip = new JSZip();
  const manifest: any[] = [];
  const seenMedia = new Set<string>();

  for (const summary of summaries) {
    const entry = await getEntry(summary.id);
    if (!entry) {
      continue;
    }
    const refs = extractMediaRefs(entry.content);
    for (const ref of refs) {
      const key = `${ref.entryId}/${ref.fileName}`;
      if (seenMedia.has(key)) {
        continue;
      }
      seenMedia.add(key);
      try {
        const base64 = await native.readBase64(
          joinPath(paths.mediaRoot(), ref.entryId, ref.fileName),
        );
        if (base64) {
          zip.file(`media/${ref.entryId}/${ref.fileName}`, base64, {
            base64: true,
          });
        }
      } catch {
        // Missing media is skipped, matching the Android export.
      }
    }
    manifest.push({
      id: entry.id,
      title: entry.title,
      content: stripEditorState(toBackupHtml(entry.content)),
      date: entry.date,
      weather: entry.weather,
      mood: entry.mood,
      category: entry.category,
      isFavorite: entry.isFavorite,
      ...(entry.imageUrl ? {imageUrl: entry.imageUrl} : {}),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    });
  }

  try {
    const stickers = await native.listStickers();
    for (const sticker of stickers) {
      if (!isSafeFileName(sticker.fileName)) {
        continue;
      }
      try {
        const base64 = await native.stickerBase64(sticker.fileName);
        if (base64) {
          zip.file(`stickers/${sticker.fileName}`, base64, {base64: true});
        }
      } catch {
        // ignore unreadable sticker
      }
    }
  } catch {
    // stickers are optional
  }

  zip.file('manifest.json', JSON.stringify(manifest));
  const base64 = await zip.generateAsync({
    type: 'base64',
    compression: 'DEFLATE',
    compressionOptions: {level: 6},
  });
  const fileName = `祈_日记备份_${Date.now()}.zip`;
  await native.saveDocument(base64, fileName, 'application/zip');
}

export interface ImportOptions {
  overwrite?: boolean;
}

async function importLegacyJson(text: string): Promise<ImportResult> {
  const failedRef = {value: 0};
  let rows: any[] = [];
  try {
    const parsed = JSON.parse(text);
    rows = Array.isArray(parsed) ? parsed : [];
  } catch {
    failedRef.value += 1;
  }
  if (rows.length > MAX_BACKUP_ENTRIES) {
    failedRef.value += rows.length - MAX_BACKUP_ENTRIES;
    rows = rows.slice(0, MAX_BACKUP_ENTRIES);
  }
  const existing = new Set((await loadIndex()).map(item => item.id));
  let imported = 0;
  let skipped = 0;
  for (const raw of rows) {
    const parsed = parseRow(raw, failedRef);
    if (!parsed) {
      continue;
    }
    if (existing.has(parsed.entry.id)) {
      skipped += 1;
      continue;
    }
    try {
      await saveEntry({
        ...parsed.entry,
        content: stripEditorState(parsed.entry.content),
        updatedAt: Date.now(),
      });
      imported += 1;
    } catch {
      failedRef.value += 1;
    }
  }
  return {imported, skipped, failed: failedRef.value};
}

export async function importBackup(
  options: ImportOptions = {},
): Promise<ImportResult> {
  const overwrite = options.overwrite === true;
  const doc = await native.pickDocument();
  const isZipName = /\.zip$/i.test(doc.name);
  let zip: JSZip | null = null;

  if (isZipName) {
    zip = await JSZip.loadAsync(await native.readBase64(doc.path), {
      base64: true,
    });
  } else {
    try {
      const text = await native.readText(doc.path);
      if (text.slice(0, 2) === 'PK') {
        zip = await JSZip.loadAsync(await native.readBase64(doc.path), {
          base64: true,
        });
      } else {
        return importLegacyJson(text);
      }
    } catch {
      zip = await JSZip.loadAsync(await native.readBase64(doc.path), {
        base64: true,
      });
    }
  }

  const files = Object.values(zip.files).filter(file => !file.dir);
  if (files.length > MAX_ARCHIVE_FILES) {
    throw new Error('备份包含过多文件');
  }

  const manifestFile = zip.file('manifest.json');
  let manifestText = '';
  if (manifestFile) {
    manifestText = await manifestFile.async('string');
    if (manifestText.length > MAX_MANIFEST_BYTES) {
      throw new Error('备份清单过大');
    }
  }

  const failedRef = {value: 0};
  let rows: any[] = [];
  try {
    const parsed = manifestText === '' ? [] : JSON.parse(manifestText);
    rows = Array.isArray(parsed) ? parsed : [];
  } catch {
    failedRef.value += 1;
  }
  if (rows.length > MAX_BACKUP_ENTRIES) {
    failedRef.value += rows.length - MAX_BACKUP_ENTRIES;
    rows = rows.slice(0, MAX_BACKUP_ENTRIES);
  }

  // Sticker library (failures are silent, matching the Android import).
  for (const file of files) {
    const match = /^stickers\/([^/]+)$/.exec(file.name);
    if (!match) {
      continue;
    }
    const fileName = match[1];
    if (!isSafeFileName(fileName) || fileName === '.' || fileName === '..') {
      continue;
    }
    try {
      const bytes = await file.async('uint8array');
      if (bytes.length === 0 || bytes.length > MAX_STICKER_FILE_BYTES) {
        continue;
      }
      const base64 = await file.async('base64');
      await native.writeStickerBase64(fileName, base64);
    } catch {
      // ignore
    }
  }

  const existingIds = new Set((await loadIndex()).map(item => item.id));
  let imported = 0;
  let skipped = 0;
  let totalMediaBytes = 0;

  for (const raw of rows) {
    const parsed = parseRow(raw, failedRef);
    if (!parsed) {
      continue;
    }
    const entry = parsed.entry;
    if (!overwrite && existingIds.has(entry.id)) {
      skipped += 1;
      continue;
    }
    const stagedMedia = files.filter(file => {
      const match = /^media\/([^/]+)\/([^/]+)$/.exec(file.name);
      return (
        match !== null &&
        match[1] === entry.id &&
        isSafeFileName(match[2]) &&
        match[2] !== '.' &&
        match[2] !== '..'
      );
    });
    let hasStagedMedia = false;
    try {
      for (const file of stagedMedia) {
        const match = /^media\/([^/]+)\/([^/]+)$/.exec(file.name)!;
        const fileName = match[2];
        const bytes = await file.async('uint8array');
        totalMediaBytes += bytes.length;
        if (
          bytes.length === 0 ||
          bytes.length > MAX_MEDIA_FILE_BYTES ||
          totalMediaBytes > MAX_TOTAL_MEDIA_BYTES
        ) {
          continue;
        }
        const base64 = await file.async('base64');
        await native.writeBase64(
          joinPath(paths.entryMedia(entry.id), fileName),
          base64,
        );
        hasStagedMedia = true;
      }

      let content = entry.content;
      if (hasStagedMedia) {
        content = restoreBackupHtml(content);
      }
      content = stripEditorState(content);
      if (content.includes('data:image/')) {
        const stored = await native.toStoredHtml(entry.id, content);
        content = stored.html;
      }
      await saveEntry({
        ...entry,
        content,
        updatedAt: Date.now(),
      });
      imported += 1;
      existingIds.add(entry.id);
    } catch {
      failedRef.value += 1;
    }
  }

  return {imported, skipped, failed: failedRef.value};
}
