/**
 * 状态同步：发送端定时加密上传，接收端按游标拉取。
 *
 * 状态类信息不再走「要一次、回一次」：小狗端/主人端各自把手里的快照发到
 * 服务器暂存，对方上线后直接拉取。直连命令只作为页面上的兜底，不在这里发。
 */
import {AppState, type AppStateStatus} from 'react-native';
import type {PairSummary} from '../data/pairTypes';
import {qiDevicePermissions, qiGuard, qiLocation, qiUsageStats} from '../native/QiDevice';
import {qiLimits} from '../native/QiLimits';
import {
  ackState,
  loadStagingCursor,
  pollState,
  saveStagingCursor,
  sendState,
} from './staging';
import {writeState, type StateKind} from './stateCache';

const STATUS_INTERVAL_MS = 60_000;
const HEAVY_INTERVAL_MS = 15 * 60_000;
const LOCATION_INTERVAL_MS = 15 * 60_000;
let lastLocationAt = 0;

function startOfDay(now = Date.now()): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function logError(where: string, error: unknown): void {
  console.warn(`[state-sync] ${where}`, error);
}

async function publishOne(
  pair: PairSummary,
  kind: StateKind,
  data: unknown,
): Promise<boolean> {
  try {
    await sendState(pair, kind, data);
    return true;
  } catch (error) {
    logError(`send ${kind}`, error);
    return false;
  }
}

/** 发布一轮状态；heavy=true 时额外收集小狗端的使用时长/权限/限制/轨迹。 */
export async function publishStates(
  pair: PairSummary,
  options: {heavy?: boolean} = {},
): Promise<{sent: number; failed: number}> {
  let sent = 0;
  let failed = 0;
  const tracks: Promise<boolean>[] = [];

  const add = (kind: StateKind, data: unknown) => {
    if (data === undefined) {
      return;
    }
    tracks.push(
      publishOne(pair, kind, data).then(ok => {
        if (ok) {
          sent += 1;
        } else {
          failed += 1;
        }
        return ok;
      }),
    );
  };

  try {
    add('status', await qiGuard.status());
  } catch (error) {
    logError('guard.status', error);
  }

  add('profile', {
    ownerName: pair.ownerName,
    puppyName: pair.puppyName,
    myRole: pair.myRole,
    at: Date.now(),
  });

  if (Date.now() - lastLocationAt >= LOCATION_INTERVAL_MS) {
    try {
      const fix = await qiLocation.getLastKnown();
      if (fix?.ok) {
        lastLocationAt = Date.now();
        add('location', fix);
      }
    } catch (error) {
      logError('location', error);
    }
  }

  if (options.heavy && pair.myRole === 'PUPPY') {
    try {
      const day = await qiUsageStats.dayStats(startOfDay());
      const range = await qiUsageStats.rangeStats(7).catch(() => null);
      if (day?.ok || range?.ok) {
        add('usage', {day: day?.ok ? day : null, range: range?.ok ? range : null});
      }
    } catch (error) {
      logError('usage', error);
    }
    try {
      add('permissions', await qiDevicePermissions.snapshot());
    } catch (error) {
      logError('permissions', error);
    }
    try {
      add('applimit', await qiLimits.getRules());
    } catch (error) {
      logError('applimit', error);
    }
    try {
      const now = Date.now();
      const trail = await qiUsageStats.sessions(now - 12 * 3600_000, now);
      if (trail?.ok) {
        add('trail', trail);
      }
    } catch (error) {
      logError('trail', error);
    }
  }

  await Promise.allSettled(tracks);
  return {sent, failed};
}

/** 拉取并落盘一轮；返回本轮处理条数。 */
export async function pullStates(pair: PairSummary): Promise<number> {
  const cursor = await loadStagingCursor();
  const page = await pollState(pair, cursor, 25);
  const ids = page.items.map(item => item.id);
  for (const item of page.items) {
    await writeState(item.kind, item.data, 'staging', item.at).catch(
      error => logError(`cache ${item.kind}`, error),
    );
  }
  if (page.page.cursor > cursor) {
    await saveStagingCursor(page.page.cursor);
  }
  if (ids.length) {
    await ackState(ids).catch(error => logError('ack', error));
  }
  return page.page.items.length;
}

export interface StateSyncHandle {
  stop: () => void;
  publishNow: (heavy?: boolean) => Promise<void>;
}

/**
 * 启动状态同步：立即发布一轮 + 拉取循环；前台每 60s 发布状态，重数据 15min。
 * PUPPY 才发布使用时长/权限/应用限制/轨迹；MASTER 的状态由自己端发布。
 */
export function startStateSync(pair: PairSummary): StateSyncHandle {
  let stopped = false;
  let publishing = false;
  let polling = false;
  let statusTimer: ReturnType<typeof setInterval> | null = null;
  let heavyTimer: ReturnType<typeof setInterval> | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let heavyCountdown = 4; // 每 4 次状态发布做一次重数据

  const publishNow = async (heavy = false) => {
    if (stopped || publishing) {
      return;
    }
    publishing = true;
    try {
      await publishStates(pair, {heavy});
    } finally {
      publishing = false;
    }
  };

  const poll = async () => {
    if (stopped || polling) {
      return;
    }
    polling = true;
    try {
      await pullStates(pair);
    } catch (error) {
      logError('pull', error);
    } finally {
      polling = false;
      if (!stopped) {
        pollTimer = setTimeout(poll, 1_000);
      }
    }
  };

  void publishNow(true);
  void poll();

  statusTimer = setInterval(() => {
    heavyCountdown -= 1;
    const heavy = heavyCountdown <= 0;
    if (heavy) {
      heavyCountdown = 4;
    }
    void publishNow(heavy);
  }, STATUS_INTERVAL_MS);

  heavyTimer = setInterval(() => {
    void publishNow(true);
  }, HEAVY_INTERVAL_MS);

  const onAppState = (next: AppStateStatus) => {
    if (next === 'active') {
      void publishNow(true);
    }
  };
  const subscription = AppState.addEventListener('change', onAppState);

  return {
    stop: () => {
      stopped = true;
      if (statusTimer) {
        clearInterval(statusTimer);
      }
      if (heavyTimer) {
        clearInterval(heavyTimer);
      }
      if (pollTimer) {
        clearTimeout(pollTimer);
      }
      subscription.remove();
    },
    publishNow: (heavy = false) => publishNow(heavy),
  };
}
