/**
 * 祈 的账号/配对本地状态。
 *
 * 状态落在 `files/qi/state.json`（非机密），账号令牌单独走 Keystore 加密存储，
 * 与原有日记数据完全隔离，升级不会影响任何日记文件。
 */
import {native, joinPath, paths} from '../native/InorinalNative';
import {qiCrypto, qiSecrets} from '../native/QiNative';
import type {Appearance, AutoRule, QiState} from './pairTypes';
import {DEFAULT_APPEARANCE} from './pairTypes';
import type {PowerTier} from '../config';
import {DEFAULT_SERVER_URL} from '../config';

export const CONSENT_VERSION = 1;
const TOKEN_KEY = 'account.token';

function statePath(): string {
  return joinPath(paths.files, 'qi', 'state.json');
}

export const DEFAULT_QI_STATE: QiState = {
  serverUrl: DEFAULT_SERVER_URL,
  pin: '',
  username: null,
  deviceId: '',
  pair: null,
  pendingBindingCode: null,
  displayName: null,
  avatarStyle: 'role',
  avatarImagePath: null,
  consentVersion: 0,
  relayCursor: 0,
  allowOverlay: true,
  allowUsage: true,
  autoRules: [],
  appearance: DEFAULT_APPEARANCE,
  consentAt: null,
  journalOnly: false,
  powerTier: 'BALANCED',
};

let stateCache: QiState | null = null;

function normalizeAppearance(value: unknown): Appearance {
  const raw = (value ?? {}) as Partial<Appearance>;
  const frames: Appearance['frame'][] = ['default', 'rose', 'mint', 'gold'];
  return {
    frame: frames.includes(raw.frame as Appearance['frame'])
      ? (raw.frame as Appearance['frame'])
      : 'default',
    greeting: typeof raw.greeting === 'string' ? raw.greeting.slice(0, 40) : '',
    widgetTitle:
      typeof raw.widgetTitle === 'string' && raw.widgetTitle.trim()
        ? raw.widgetTitle.slice(0, 16)
        : DEFAULT_APPEARANCE.widgetTitle,
    widgetBody:
      typeof raw.widgetBody === 'string' && raw.widgetBody.trim()
        ? raw.widgetBody.slice(0, 40)
        : DEFAULT_APPEARANCE.widgetBody,
  };
}

function normalizeRules(value: unknown): AutoRule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const tiers: PowerTier[] = ['SAVER', 'BALANCED', 'REALTIME'];
  return value
    .map((raw): AutoRule | null => {
      if (!raw || typeof raw !== 'object') {
        return null;
      }
      const item = raw as Partial<AutoRule>;
      const start = typeof item.start === 'string' ? item.start : '';
      const end = typeof item.end === 'string' ? item.end : '';
      if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
        return null;
      }
      const tier = tiers.includes(item.tier as PowerTier) ? (item.tier as PowerTier) : 'SAVER';
      return {
        id: typeof item.id === 'string' && item.id ? item.id : `rule_${start}_${end}`,
        label: typeof item.label === 'string' ? item.label : '自动规则',
        start,
        end,
        tier,
        enabled: item.enabled !== false,
      };
    })
    .filter((rule): rule is AutoRule => rule !== null)
    .slice(0, 12);
}

function normalize(raw: any): QiState {
  const base = {...DEFAULT_QI_STATE, ...(raw && typeof raw === 'object' ? raw : {})};
  return {
    ...base,
    serverUrl: String(base.serverUrl || DEFAULT_SERVER_URL),
    pin: String(base.pin || ''),
    username: base.username ? String(base.username) : null,
    deviceId: String(base.deviceId || ''),
    pair: base.pair && typeof base.pair === 'object' ? base.pair : null,
    pendingBindingCode: base.pendingBindingCode
      ? String(base.pendingBindingCode)
      : null,
    displayName: base.displayName ? String(base.displayName) : null,
    avatarStyle:
      base.avatarStyle === 'initial' || base.avatarStyle === 'photo'
        ? base.avatarStyle
        : 'role',
    avatarImagePath: base.avatarImagePath
      ? String(base.avatarImagePath)
      : null,
    consentVersion: Number(base.consentVersion) || 0,
    relayCursor: Number(base.relayCursor) || 0,
    allowOverlay: base.allowOverlay !== false,
    allowUsage: base.allowUsage !== false,
    autoRules: normalizeRules(base.autoRules),
    appearance: normalizeAppearance(base.appearance),
    consentAt: Number(base.consentAt) || null,
    journalOnly: base.journalOnly === true,
    powerTier:
      base.powerTier === 'SAVER' || base.powerTier === 'REALTIME'
        ? base.powerTier
        : 'BALANCED',
  };
}

export async function loadQiState(): Promise<QiState> {
  if (stateCache) {
    return stateCache;
  }
  let parsed: any = null;
  try {
    const text = await native.readText(statePath());
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  stateCache = normalize(parsed);
  if (!stateCache.deviceId) {
    stateCache = {...stateCache, deviceId: await newDeviceId()};
    await saveQiState(stateCache);
  }
  return stateCache;
}

export async function saveQiState(next: QiState): Promise<void> {
  stateCache = normalize(next);
  await native.makeDir(joinPath(paths.files, 'qi')).catch(() => false);
  await native.writeText(statePath(), JSON.stringify(stateCache));
}

export async function patchQiState(patch: Partial<QiState>): Promise<QiState> {
  const current = await loadQiState();
  const next = normalize({...current, ...patch});
  await saveQiState(next);
  return next;
}

export async function loadToken(): Promise<string | null> {
  try {
    return await qiSecrets.get(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function saveToken(token: string | null): Promise<void> {
  if (token) {
    await qiSecrets.set(TOKEN_KEY, token);
  } else {
    await qiSecrets.remove(TOKEN_KEY);
  }
}

/** Human-readable, stable device id (8-64 chars, `[A-Za-z0-9_-]`). */
export async function newDeviceId(): Promise<string> {
  try {
    const raw = await qiCrypto.randomBytes(9);
    const compact = raw.replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
    if (compact.length >= 8) {
      return `qi${compact}`;
    }
  } catch {
    // fall through to the time-based id
  }
  return `qi${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
