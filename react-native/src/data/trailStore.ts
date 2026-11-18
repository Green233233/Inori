import {native, joinPath, paths} from '../native/InorinalNative';

/**
 * 「小狗轨迹」用到的位置采样。
 *
 * 只在主人主动取过一次位置时记一笔（不后台定位、不加定时器），
 * 因此它是「问过的点」而不是连续的 GPS 轨迹；两点直线距离超过
 * MOVE_THRESHOLD_M 才算一次出行，避免坐在原地被记成一堆移动。
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

function trailPath(): string {
  return joinPath(paths.files, 'qi', FILE);
}

async function loadAll(): Promise<TrailPoint[]> {
  try {
    const raw = await native.readText(trailPath());
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as {points?: TrailPoint[]};
    return Array.isArray(parsed.points) ? parsed.points : [];
  } catch {
    return [];
  }
}

async function saveAll(points: TrailPoint[]): Promise<void> {
  await native.makeDir(joinPath(paths.files, 'qi')).catch(() => false);
  await native.writeText(
    trailPath(),
    JSON.stringify({points: points.slice(-MAX_POINTS)}),
  );
}

export async function loadTrail(): Promise<TrailPoint[]> {
  return loadAll();
}

/** 记一个位置点；同一分钟内重复点会被忽略，避免页面反复打开灌水。 */
export async function recordTrailPoint(point: TrailPoint): Promise<void> {
  const points = await loadAll();
  const last = points[points.length - 1];
  if (last && point.at - last.at < 60_000) {
    return;
  }
  points.push(point);
  await saveAll(points);
}

export async function clearTrail(): Promise<void> {
  await saveAll([]);
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
