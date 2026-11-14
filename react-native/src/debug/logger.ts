/**
 * Lightweight debug log (port of debug/DebugLog.kt behaviour):
 * - only writes while debug mode is enabled
 * - 2 MB per file, 7-day retention, app-private external files dir
 * - records technical events only, never journal titles/content/search text
 */
import {native, joinPath, paths} from '../native/InorinalNative';

let enabled = false;
let currentFile: string | null = null;
let initialized = false;

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function todayName(): string {
  const d = new Date();
  return `debug-${d.getFullYear()}${String(d.getMonth() + 1).padStart(
    2,
    '0',
  )}${String(d.getDate()).padStart(2, '0')}.log`;
}

async function init(): Promise<void> {
  if (initialized || !paths.logs) {
    return;
  }
  initialized = true;
  await native.makeDir(paths.logs).catch(() => false);
  try {
    const files = await native.listDir(paths.logs);
    const now = Date.now();
    for (const file of files) {
      if (!file.isDirectory && now - file.lastModified > RETENTION_MS) {
        await native.deletePath(file.path).catch(() => false);
      }
    }
  } catch {
    // ignore
  }
}

export function setDebugEnabled(value: boolean): void {
  enabled = value;
  if (value) {
    init();
  }
}

export function isDebugEnabled(): boolean {
  return enabled;
}

export async function logEvent(
  name: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  if (!enabled || !paths.logs) {
    return;
  }
  await init();
  try {
    const file = joinPath(paths.logs, todayName());
    currentFile = file;
    const payload = detail ? ` ${JSON.stringify(detail).slice(0, 1000)}` : '';
    const line = `${new Date().toISOString()} ${name}${payload}\n`;
    const exists = await native.exists(file);
    if (exists) {
      const text = await native.readText(file).catch(() => '');
      if (text.length + line.length > MAX_FILE_BYTES) {
        return;
      }
    }
    await native.appendText(file, line);
  } catch {
    // logging must never break the app
  }
}

export async function clearLogs(): Promise<void> {
  if (!paths.logs) {
    return;
  }
  try {
    const files = await native.listDir(paths.logs);
    for (const file of files) {
      if (!file.isDirectory) {
        await native.deletePath(file.path).catch(() => false);
      }
    }
  } catch {
    // ignore
  }
  currentFile = null;
}

export function currentLogPath(): string {
  return currentFile ?? joinPath(paths.logs, todayName());
}
