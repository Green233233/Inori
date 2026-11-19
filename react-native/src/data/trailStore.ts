import {native, joinPath, paths} from '../native/InorinalNative';

/**
 * 「小狗轨迹」用到的位置采样。
 *
 * 两个来源：
 *  - `trail.json`：主人主动取过一次位置时由 JS 记一笔（两点直线距离超过
 *    MOVE_THRESHOLD_M 才算一次出行，避免坐在原地被记成一堆移动）；
 *  - `puppy-trail.json`：小狗端守护服务在心跳里按功耗档位（2/10/30 分钟）
 *    用 last-known 采的点，由 Kotlin 直接追加（格式 `{points:[{t,lat,lng}]}`）。
 *
 * 读取时把两份按时间合并、去重、截到 200 条；写入仍然只碰 `trail.json`，
 * 保证小狗端采的点不会被 JS 覆盖，也不会被重复回写。
 */
export type TrailPoint = {
  at: number;
  lat: number;
  lng: number;
  address?: string | null;
};

export type TrailMove = {
  from: TrailPoint;
  to: TrailPoint;
  distanceM: number;
};

const THRESHOLD_M = 500;
const MAX_POINTS = 200;
const FILE = 'trail.json';
const PUPPY_FILE = 'puppy-trail.json';

/** 两份来源里同一时刻、同一位置的点视为重复（时间容差 2 分钟）。 */
const DEDUPE_MS = 120_000;
const DEDUPE_DEG = 1e-5;

type StoredPoint = {
  t?: number;
  at?: number;
  lat?: number;
  lng?: number;
  address?: string | null;
};

function trailPath(): string {
  return joinPath(paths.files, 'qi', FILE);
}

function puppyTrailPath(): string {
  return joinPath(paths.files, 'qi', PUPPY_FILE);
}

function normalizePoints(raw: unknown): TrailPoint[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const points: TrailPoint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const point = item as StoredPoint;
    const at = Number(point.at ?? point.t);
    const lat = Number(point.lat);
    const lng = Number(point.lng);
    if (
      !Number.isFinite(at) ||
      at <= 0 ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      continue;
    }
    points.push({
      at,
      lat,
      lng,
      address:
        typeof point.address === 'string' && point.address.trim()
          ? point.address
          : null,
    });
  }
  return points;
}

function parsePoints(raw: string | null | undefined): TrailPoint[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as {points?: unknown};
    return normalizePoints(parsed?.points);
  } catch {
    return [];
  }
}

async function loadOwn(): Promise<TrailPoint[]> {
  try {
    return parsePoints(await native.readText(trailPath()));
  } catch {
    return [];
  }
}

async function loadPuppy(): Promise<TrailPoint[]> {
  try {
    return parsePoints(await native.readText(puppyTrailPath()));
  } catch {
    return [];
  }
}

function sameSpot(a: TrailPoint, b: TrailPoint): boolean {
  return (
    Math.abs(a.at - b.at) <= DEDUPE_MS &&
    Math.abs(a.lat - b.lat) <= DEDUPE_DEG &&
    Math.abs(a.lng - b.lng) <= DEDUPE_DEG
  );
}

/** 合并两份来源：按时间排序、去掉重复点、只留最近 MAX_POINTS 条。 */
function mergePoints(lists: TrailPoint[][]): TrailPoint[] {
  const merged: TrailPoint[] = [];
  for (const list of lists) {
    for (const point of list) {
      if (merged.some(existing => sameSpot(existing, point))) {
        continue;
      }
      merged.push(point);
    }
  }
  merged.sort((a, b) => a.at - b.at);
  return merged.slice(-MAX_POINTS);
}

async function saveAll(points: TrailPoint[]): Promise<void> {
  await native.makeDir(joinPath(paths.files, 'qi')).catch(() => false);
  await native.writeText(
    trailPath(),
    JSON.stringify({points: points.slice(-MAX_POINTS)}),
  );
}

export async function loadTrail(): Promise<TrailPoint[]> {
  const [own, puppy] = await Promise.all([loadOwn(), loadPuppy()]);
  return mergePoints([own, puppy]);
}

/** 记一个位置点；同一分钟内重复点会被忽略，避免页面反复打开灌水。 */
export async function recordTrailPoint(point: TrailPoint): Promise<void> {
  const points = await loadOwn();
  const last = points[points.length - 1];
  if (last && point.at - last.at < 60_000) {
    return;
  }
  points.push(point);
  await saveAll(points);
}

/** 清空轨迹：自己的文件写空数组，小狗端后台采样文件一并删除。 */
export async function clearTrail(): Promise<void> {
  await saveAll([]);
  await native.deletePath(puppyTrailPath()).catch(() => false);
}

function distanceM(a: TrailPoint, b: TrailPoint): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 相邻采样点里位移超过 500 米的，算一次「出行」。 */
export function trailMoves(points: TrailPoint[]): TrailMove[] {
  const moves: TrailMove[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const distance = distanceM(points[i - 1], points[i]);
    if (distance >= THRESHOLD_M) {
      moves.push({from: points[i - 1], to: points[i], distanceM: distance});
    }
  }
  return moves;
}
