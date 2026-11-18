/**
 * 与「对方做了某事」相关的系统通知。
 *
 * 只有在前台 JS 存活期间才能发现新数据（大厅长轮询 / 手动刷新），因此这里
 * 不引入任何定时器：谁刷新到新数据，谁负责弹一次通知。游标存在
 * files/qi/alerts.json，只记 id，用来去重——重装或清数据后最多重弹一次。
 */
import {native, joinPath, paths} from '../native/InorinalNative';
import {qiNotice} from '../native/QiDevice';
import {listCoupons} from '../data/couponApi';
import type {Coupon, Role} from '../data/pairTypes';
import {loadTasks, type QiTask} from './tasks';

interface AlertState {
  tasks: string[];
  coupons: string[];
}

const MAX_SEEN = 200;
const cache: {state?: AlertState} = {};

function statePath(): string {
  return joinPath(paths.files, 'qi', 'alerts.json');
}

async function loadState(): Promise<AlertState> {
  if (cache.state) {
    return cache.state;
  }
  let state: AlertState = {tasks: [], coupons: []};
  try {
    const raw = await native.readText(statePath());
    const parsed = JSON.parse(raw) as Partial<AlertState>;
    state = {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks.slice(-MAX_SEEN) : [],
      coupons: Array.isArray(parsed.coupons) ? parsed.coupons.slice(-MAX_SEEN) : [],
    };
  } catch {
    // 首次运行没有文件。
  }
  cache.state = state;
  return state;
}

async function saveState(state: AlertState): Promise<void> {
  cache.state = state;
  await native.makeDir(joinPath(paths.files, 'qi')).catch(() => false);
  await native.writeText(statePath(), JSON.stringify(state));
}

async function post(id: string, title: string, body: string): Promise<void> {
  try {
    await qiNotice.post(id, title, body, false);
  } catch {
    // 通知权限没给时静默失败，不影响业务。
  }
}

/** 主人下达新任务 / 小狗报备了任务。 */
async function scanTasks(role: Role): Promise<number> {
  const state = await loadState();
  const seen = new Set(state.tasks);
  const tasks = await loadTasks();
  let fresh = 0;
  for (const task of tasks) {
    if (seen.has(`${task.id}:${task.status}`)) {
      continue;
    }
    const mine = role === 'MASTER' ? task.createdBy !== undefined && task.status !== 'open' : task.status === 'open';
    const notifyMaster = role === 'MASTER' && task.status === 'submitted';
    const notifyPuppy = role === 'PUPPY' && task.status === 'open';
    if (!notifyMaster && !notifyPuppy) {
      continue;
    }
    void mine;
    const title = role === 'PUPPY' ? '主人给你派了任务' : '小狗报备了任务';
    await post(`task:${task.id}:${task.status}`, title, task.title);
    seen.add(`${task.id}:${task.status}`);
    fresh += 1;
  }
  if (fresh > 0) {
    await saveState({...state, tasks: Array.from(seen).slice(-MAX_SEEN)});
  }
  return fresh;
}

/** 对方签发了一张券。奖励券由小狗签发、其余由主人签发。 */
async function scanCoupons(role: Role): Promise<number> {
  const state = await loadState();
  const seen = new Set(state.coupons);
  let items: Coupon[] = [];
  try {
    const page = await listCoupons({status: 'unused', limit: 20});
    items = page.items;
  } catch {
    return 0;
  }
  let fresh = 0;
  for (const coupon of items) {
    if (seen.has(coupon.code)) {
      continue;
    }
    const fromPeer =
      (role === 'PUPPY' && coupon.type !== 'reward') ||
      (role === 'MASTER' && coupon.type === 'reward');
    if (!fromPeer) {
      continue;
    }
    const title = coupon.type === 'reward' ? '小狗给你发了一张奖励券' : '主人给你签发了一张券';
    await post(`coupon:${coupon.code}`, title, `${coupon.typeLabel} · ${coupon.code}`);
    seen.add(coupon.code);
    fresh += 1;
  }
  if (fresh > 0) {
    await saveState({...state, coupons: Array.from(seen).slice(-MAX_SEEN)});
  }
  return fresh;
}

/**
 * 刷新后调用一次：发现对方的新动作就弹通知。
 * 失败一律吞掉——通知只是锦上添花，不能影响同步本身。
 */
export async function scanAlerts(role: Role): Promise<{tasks: number; coupons: number}> {
  const tasks = await scanTasks(role).catch(() => 0);
  const coupons = await scanCoupons(role).catch(() => 0);
  return {tasks, coupons};
}

/** 本地刚做完动作时清掉游标，避免自己收到自己的通知。 */
export async function markTaskSeen(task: QiTask): Promise<void> {
  const state = await loadState();
  const key = `${task.id}:${task.status}`;
  if (state.tasks.includes(key)) {
    return;
  }
  await saveState({...state, tasks: [...state.tasks, key].slice(-MAX_SEEN)});
}

export async function markCouponSeen(code: string): Promise<void> {
  const state = await loadState();
  if (state.coupons.includes(code)) {
    return;
  }
  await saveState({...state, coupons: [...state.coupons, code].slice(-MAX_SEEN)});
}
