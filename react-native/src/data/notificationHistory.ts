/**
 * 通知转发历史（主人端本地缓存）。
 *
 * 数据来自小狗端的通知队列（通过端到端加密命令拉取），这里只做去重、排序与
 * 上限截断，不落服务器。清空只影响本机。
 */
import {native, joinPath, paths} from '../native/InorinalNative';

export interface NotificationRecord {
  at: number;
  pkg: string;
  title: string;
  text: string;
}

const MAX_ITEMS = 300;

function filePath(): string {
  return joinPath(paths.files, 'qi', 'notifications.json');
}

function normalize(raw: any): NotificationRecord[] {
  if (!raw || !Array.isArray(raw.items)) {
    return [];
  }
  return raw.items
    .filter((item: any) => item && typeof item === 'object')
    .map((item: any): NotificationRecord => ({
      at: Number(item.at) || 0,
      pkg: String(item.pkg ?? ''),
      title: String(item.title ?? ''),
      text: String(item.text ?? ''),
    }))
    .sort((a: NotificationRecord, b: NotificationRecord) => b.at - a.at)
    .slice(0, MAX_ITEMS);
}

export async function loadNotifications(): Promise<NotificationRecord[]> {
  try {
    return normalize(JSON.parse(await native.readText(filePath())));
  } catch {
    return [];
  }
}

export async function mergeNotifications(
  incoming: NotificationRecord[],
): Promise<NotificationRecord[]> {
  const existing = await loadNotifications();
  const seen = new Set(existing.map(item => `${item.at}|${item.pkg}|${item.text}`));
  const merged = [...existing];
  for (const item of incoming) {
    const key = `${item.at}|${item.pkg}|${item.text}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }
  merged.sort((a, b) => b.at - a.at);
  const trimmed = merged.slice(0, MAX_ITEMS);
  await native.makeDir(joinPath(paths.files, 'qi')).catch(() => false);
  await native.writeText(filePath(), JSON.stringify({items: trimmed}));
  return trimmed;
}

export async function clearNotifications(): Promise<void> {
  await native.writeText(filePath(), JSON.stringify({items: []})).catch(() => undefined);
}
