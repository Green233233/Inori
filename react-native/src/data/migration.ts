/**
 * One-time, read-only migration of journal entries created by the previous
 * Compose/Room build (same applicationId). The old database is never modified.
 */
import {native, joinPath, paths} from '../native/InorinalNative';
import {loadIndex, saveEntry} from './storage';
import {
  JournalEntry,
  normalizeCategory,
  normalizeMood,
  normalizeWeather,
  todayIso,
} from './types';

function markerPath(): string {
  return joinPath(paths.journal(), 'legacy-migrated.json');
}

export async function migrateLegacyEntries(): Promise<number> {
  try {
    if (await native.exists(markerPath())) {
      return 0;
    }
  } catch {
    return 0;
  }

  let rows: any[] = [];
  try {
    const result = await native.readLegacyEntries();
    rows = Array.isArray(result) ? result : [];
  } catch {
    rows = [];
  }

  let imported = 0;
  if (rows.length > 0) {
    const existing = new Set((await loadIndex()).map(item => item.id));
    for (const raw of rows) {
      const id = String(raw?.id ?? '');
      if (!id || existing.has(id) || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
        continue;
      }
      try {
        let content = String(raw.content ?? '');
        if (content.includes('data:image/')) {
          const stored = await native.toStoredHtml(id, content);
          content = stored.html;
        }
        const entry: JournalEntry = {
          id,
          title: String(raw.title ?? ''),
          content,
          date: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date ?? ''))
            ? String(raw.date)
            : todayIso(),
          weather: normalizeWeather(raw.weather),
          mood: normalizeMood(raw.mood),
          category: normalizeCategory(raw.category),
          isFavorite: raw.isFavorite === true,
          imageUrl: raw.imageUrl ? String(raw.imageUrl) : null,
          createdAt: Number(raw.createdAt) || Date.now(),
          updatedAt: Number(raw.updatedAt) || Date.now(),
        };
        await saveEntry(entry);
        existing.add(id);
        imported += 1;
      } catch {
        // Skip malformed rows; a backup import remains available.
      }
    }
  }

  try {
    await native.writeText(
      markerPath(),
      JSON.stringify({at: Date.now(), imported, scanned: rows.length}),
    );
  } catch {
    // A failed marker only means we may retry on the next launch.
  }
  return imported;
}
