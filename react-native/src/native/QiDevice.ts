/**
 * Typed wrapper around the 祈 device modules (`QiDevicePermissions`, `QiGuard`,
 * `QiUsageStats`, `QiScreenshot`, `QiLocation`, `QiNotificationRelay`,
 * `QiOverlay`, `QiAudit`).
 *
 * Mirrors the style of `QiNative.ts`: every call is a Promise, module lookups
 * happen once, and a clear error is thrown if the installed APK predates this
 * module set.
 *
 * Two behaviours are worth knowing before using this file:
 *  - `guard.onTick` is the adaptive long-poll heartbeat. The native service
 *    decides the interval, this wrapper only forwards it; the JS side must then
 *    perform the actual poll and report back with `guard.reportResult`.
 *  - screen capture is deliberately rate-limited (3/hour) and announced on the
 *    device by the native side. A rejected `capture()` is normal, not a bug.
 */
import {NativeEventEmitter, NativeModules} from 'react-native';

// --------------------------------------------------------------------- types

export type PermissionKey =
  | 'deviceAdmin'
  | 'accessibility'
  | 'usageAccess'
  | 'overlay'
  | 'batteryUnrestricted'
  | 'notificationListener'
  | 'exactAlarm'
  | 'location'
  | 'photoShare'
  | 'screenCaptureStanding';

export const PERMISSION_KEYS: readonly PermissionKey[] = [
  'deviceAdmin',
  'accessibility',
  'usageAccess',
  'overlay',
  'batteryUnrestricted',
  'notificationListener',
  'exactAlarm',
  'location',
  'photoShare',
  'screenCaptureStanding',
];

export interface PermissionEntry {
  key: PermissionKey;
  granted: boolean;
}

export interface PermissionStatus extends PermissionEntry {
  revocable: boolean;
}

export interface PermissionRevokeResult {
  key: PermissionKey;
  /** Always false today: every revoke needs the user to confirm in Settings. */
  revoked: boolean;
  launched: boolean;
  needsUserAction: boolean;
}

export type PowerTier = 'saver' | 'balanced' | 'realtime';

export interface GuardStatus {
  running: boolean;
  /** Tier actually in effect (may be downgraded to `saver` on low battery). */
  tier: PowerTier;
  /** Tier the user asked for. */
  requestedTier: PowerTier;
  waitMs: number;
  screenOn: boolean;
  charging: boolean;
  batteryPercent: number;
  idleMinutes: number;
  startedAt: number;
  lastTickAt: number;
  nextPollAt: number;
  projectionActive: boolean;
  foreground: boolean;
  /** Unlock events counted since the guard process started. */
  userPresents: number;
  failures: number;
  lastEventElapsed: number;
}

export interface GuardTick {
  waitMs: number;
  tier: PowerTier;
  screenOn: boolean;
  charging: boolean;
  batteryPercent: number;
  idleMinutes: number;
  at: number;
}

export type UsageInterval = 'best' | 'daily';

export interface UsageItem {
  pkg: string;
  label: string;
  minutes: number;
  sessions?: number;
}

export interface UsageBlock {
  from: number;
  to: number;
  days: number;
  totalMinutes: number;
  items: UsageItem[];
  top: UsageItem[];
  unfinishedSessions?: number;
}

export interface UsageAggregate {
  today: UsageBlock;
  week: UsageBlock;
  events: UsageBlock;
  top: UsageItem[];
  generatedAt: number;
}

export interface ScreenshotStatus {
  apiLevel: number;
  standingEnabled: boolean;
  standingActive: boolean;
  usedThisHour: number;
  limitPerHour: number;
  hasConsent: boolean;
  canCapture: boolean;
  needsActivityForConsent: boolean;
}

export interface ScreenshotResult {
  ok: boolean;
  base64: string;
  width: number;
  height: number;
  bytes: number;
  at: number;
  standing: boolean;
  usedThisHour: number;
}

export interface StandingResult {
  apiLevel: number;
  standing: boolean;
  note: string;
}

export interface PermissionResult {
  granted: boolean;
  apiLevel: number;
  standing: boolean;
}

export interface LocationFix {
  ok: boolean;
  lat?: number;
  lng?: number;
  accuracy?: number;
  time?: number;
  provider?: string;
  ageMs?: number;
  fresh: boolean;
  networkAttempted: boolean;
  reason?: string;
}

export interface GeocodeResult {
  ok: boolean;
  address?: string;
  city?: string;
  country?: string;
  reason?: string;
}

export interface LocationStatus {
  fine: boolean;
  coarse: boolean;
  gpsEnabled: boolean;
  networkEnabled: boolean;
  networkFixEnabled: boolean;
  lastNetworkAt: number;
  networkGateMs: number;
}

export interface RelayEvent {
  at: number;
  pkg: string;
  title: string;
  text: string;
}

export interface RelayStatus {
  enabled: boolean;
  connected: boolean;
  queued: number;
  blocklistSize: number;
}

export interface OverlayStatus {
  visible: boolean;
  canDrawOverlays: boolean;
  maxDurationMs: number;
}

export interface AuditRecord {
  seq: number;
  at: number;
  type: string;
  detail: string;
  prevHash: string;
  hash: string;
}

export interface AuditAppendResult {
  seq: number;
  hash: string;
  at: number;
}

export interface AuditExport {
  path: string;
  base64: string;
  count: number;
  sha256: string;
}

export interface AuditChain {
  valid: boolean;
  brokenAt: number;
  count: number;
}

// ------------------------------------------------------------------ modules

type PermissionsApi = {
  getSnapshot(): Promise<PermissionEntry[]>;
  getStatus(key: string): Promise<PermissionStatus>;
  openSettings(key: string): Promise<boolean>;
  openSettingsFor(keys: string[]): Promise<boolean>;
  /** 直达系统「应用信息 → 权限」页，小狗端首页卡片一次点到位。 */
  openAppSettings(): Promise<boolean>;
  revoke(key: string): Promise<PermissionRevokeResult>;
};

type GuardApi = {
  start(): Promise<boolean>;
  stop(): Promise<boolean>;
  getStatus(): Promise<GuardStatus>;
  setTier(tier: string): Promise<PowerTier>;
  /** 传 JSON 字符串：原生侧签名是 String，直接传数组会被桥拒绝。 */
  setAutoRules(rulesJson: string): Promise<number>;
  getAutoRules(): Promise<{rules: string; active: string}>;
  notifyActivity(): Promise<boolean>;
  reportResult(ok: boolean, detail: string): Promise<number>;
  consumePendingSync(): Promise<string | null>;
  lockNow(): Promise<boolean>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

type UsageApi = {
  queryUsageStats(interval: string, days: number): Promise<UsageBlock>;
  queryEvents(days: number): Promise<UsageBlock>;
  aggregate(): Promise<UsageAggregate>;
};

type ScreenshotApi = {
  requestPermission(): Promise<PermissionResult>;
  setStandingCapture(enabled: boolean): Promise<StandingResult>;
  capture(): Promise<ScreenshotResult>;
  getStatus(): Promise<ScreenshotStatus>;
};

type LocationApi = {
  getLastKnown(): Promise<LocationFix>;
  /** 主动取一次定位（用户点「定位」时用），内部会短暂请求一次网络/GPS。 */
  locate(): Promise<LocationFix>;
  reportOnce(allowNetwork: boolean): Promise<LocationFix>;
  reverseGeocode(latitude: number, longitude: number): Promise<GeocodeResult>;
  setNetworkFixEnabled(enabled: boolean): Promise<boolean>;
  getStatus(): Promise<LocationStatus>;
};

type NotificationRelayApi = {
  drain(limit: number): Promise<RelayEvent[]>;
  setBlocklist(packages: string[]): Promise<number>;
  getBlocklist(): Promise<string[]>;
  getStatus(): Promise<RelayStatus>;
};

type OverlayApi = {
  show(message: string, timeoutMs: number): Promise<boolean>;
  hide(): Promise<boolean>;
  getStatus(): Promise<OverlayStatus>;
};

type AuditApi = {
  append(type: string, detail: string): Promise<AuditAppendResult>;
  read(limit: number, offset: number): Promise<AuditRecord[]>;
  export(): Promise<AuditExport>;
  verifyChain(): Promise<AuditChain>;
};

type WidgetApi = {
  update(title: string, body: string): Promise<number>;
};

type ReminderApi = {
  schedule(
    id: string,
    hour: number,
    minute: number,
    daysCsv: string,
    message: string,
    fullscreen: boolean,
  ): Promise<boolean>;
  cancel(id: string): Promise<boolean>;
  rescheduleAll(): Promise<boolean>;
};

const permissionsModule = NativeModules.QiDevicePermissions as
  | PermissionsApi
  | undefined;
const guardModule = NativeModules.QiGuard as GuardApi | undefined;
const usageModule = NativeModules.QiUsageStats as UsageApi | undefined;
const screenshotModule = NativeModules.QiScreenshot as
  | ScreenshotApi
  | undefined;
const locationModule = NativeModules.QiLocation as LocationApi | undefined;
const relayModule = NativeModules.QiNotificationRelay as
  | NotificationRelayApi
  | undefined;
const overlayModule = NativeModules.QiOverlay as OverlayApi | undefined;
const auditModule = NativeModules.QiAudit as AuditApi | undefined;
const widgetModule = NativeModules.QiWidget as WidgetApi | undefined;
const reminderModule = NativeModules.QiReminder as ReminderApi | undefined;

function missing(name: string): never {
  throw new Error(`${name} 未注册：请重新构建 Android 应用`);
}

function requirePermissions(): PermissionsApi {
  return permissionsModule ?? missing('QiDevicePermissions');
}

function requireGuard(): GuardApi {
  return guardModule ?? missing('QiGuard');
}

function requireUsage(): UsageApi {
  return usageModule ?? missing('QiUsageStats');
}

function requireScreenshot(): ScreenshotApi {
  return screenshotModule ?? missing('QiScreenshot');
}

function requireLocation(): LocationApi {
  return locationModule ?? missing('QiLocation');
}

function requireRelay(): NotificationRelayApi {
  return relayModule ?? missing('QiNotificationRelay');
}

function requireOverlay(): OverlayApi {
  return overlayModule ?? missing('QiOverlay');
}

function requireAudit(): AuditApi {
  return auditModule ?? missing('QiAudit');
}

function requireWidget(): WidgetApi {
  return widgetModule ?? missing('QiWidget');
}

function requireReminder(): ReminderApi {
  return reminderModule ?? missing('QiReminder');
}

/** True when the installed APK ships every device module. */
export const qiDeviceAvailable =
  !!permissionsModule &&
  !!guardModule &&
  !!usageModule &&
  !!screenshotModule &&
  !!locationModule &&
  !!relayModule &&
  !!overlayModule &&
  !!auditModule;

// --------------------------------------------------------------- namespaces

export const qiDevicePermissions = {
  snapshot: (): Promise<PermissionEntry[]> =>
    requirePermissions().getSnapshot(),
  status: (key: PermissionKey): Promise<PermissionStatus> =>
    requirePermissions().getStatus(key),
  /** Opens the exact system screen for this permission. */
  openSettings: (key: PermissionKey): Promise<boolean> =>
    requirePermissions().openSettings(key),
  openSettingsFor: (keys: PermissionKey[]): Promise<boolean> =>
    requirePermissions().openSettingsFor(keys),
  /** 直达系统「应用信息 → 权限」页。 */
  openAppSettings: (): Promise<boolean> =>
    requirePermissions().openAppSettings(),
  /** Only device admin can actually be removed (with user confirmation). */
  revoke: (key: PermissionKey): Promise<PermissionRevokeResult> =>
    requirePermissions().revoke(key),
};

export const qiGuard = {
  start: (): Promise<boolean> => requireGuard().start(),
  stop: (): Promise<boolean> => requireGuard().stop(),
  status: (): Promise<GuardStatus> => requireGuard().getStatus(),
  setTier: (tier: PowerTier): Promise<PowerTier> =>
    requireGuard().setTier(tier),
  /** 把自动规则镜像到守护服务；返回规则条数。 */
  setAutoRules: (rulesJson: string): Promise<number> =>
    requireGuard().setAutoRules(rulesJson),
  /** 读取守护服务里已镜像的规则与当前命中项。 */
  getAutoRules: (): Promise<{rules: string; active: string}> =>
    requireGuard().getAutoRules(),
  /** Marks activity so the idle cadence resets. */
  notifyActivity: (): Promise<boolean> => requireGuard().notifyActivity(),
  /** Reports the long-poll outcome; returns the consecutive failure count. */
  reportResult: (ok: boolean, detail = ''): Promise<number> =>
    requireGuard().reportResult(ok, detail),
  /** One-shot catch-up reason ('boot' | 'connectivity' | ...) or null. */
  consumePendingSync: (): Promise<string | null> =>
    requireGuard().consumePendingSync(),
  lockNow: (): Promise<boolean> => requireGuard().lockNow(),

  /**
   * Adaptive long-poll heartbeat. Returns an unsubscribe function; safe to call
   * when the native module is missing (returns a no-op).
   */
  onTick(listener: (tick: GuardTick) => void): () => void {
    const native = NativeModules.QiGuard;
    if (!native) {
      return () => {};
    }
    const emitter = new NativeEventEmitter(native);
    // RN types this listener as `(...args: readonly Object[])`, so the payload is
    // widened to Object here and narrowed back to GuardTick for callers.
    const subscription = emitter.addListener('qiGuardTick', (tick: Object) =>
      listener(tick as unknown as GuardTick),
    );
    return () => subscription.remove();
  },
};

export const qiUsageStats = {
  queryUsageStats: (
    interval: UsageInterval = 'daily',
    days = 1,
  ): Promise<UsageBlock> => requireUsage().queryUsageStats(interval, days),
  queryEvents: (days = 7): Promise<UsageBlock> =>
    requireUsage().queryEvents(days),
  /** One round trip for 今日 / 近 7 天 / Top 8. */
  aggregate: (): Promise<UsageAggregate> => requireUsage().aggregate(),
};

export const qiScreenshot = {
  /** On API 34+ every capture needs this again; on 29-33 it can be standing. */
  requestPermission: (): Promise<PermissionResult> =>
    requireScreenshot().requestPermission(),
  setStandingCapture: (enabled: boolean): Promise<StandingResult> =>
    requireScreenshot().setStandingCapture(enabled),
  /** 720p JPEG q70, announced on-device, at most 3 times per hour. */
  capture: (): Promise<ScreenshotResult> => requireScreenshot().capture(),
  status: (): Promise<ScreenshotStatus> => requireScreenshot().getStatus(),
};

export const qiLocation = {
  /** Passive/last-known only: costs no battery. */
  getLastKnown: (): Promise<LocationFix> => requireLocation().getLastKnown(),
  /** 用户点了「定位」：先复用 5 分钟内的旧点，否则只请求一次网络/GPS。 */
  locate: (): Promise<LocationFix> => requireLocation().locate(),
  /** One fix now; network is gated to once per 30 minutes. */
  reportOnce: (allowNetwork = false): Promise<LocationFix> =>
    requireLocation().reportOnce(allowNetwork),
  reverseGeocode: (
    latitude: number,
    longitude: number,
  ): Promise<GeocodeResult> =>
    requireLocation().reverseGeocode(latitude, longitude),
  setNetworkFixEnabled: (enabled: boolean): Promise<boolean> =>
    requireLocation().setNetworkFixEnabled(enabled),
  status: (): Promise<LocationStatus> => requireLocation().getStatus(),
};

export const qiNotificationRelay = {
  /** Drains up to `limit` queued events and removes them from the queue. */
  drain: (limit = 50): Promise<RelayEvent[]> => requireRelay().drain(limit),
  setBlocklist: (packages: string[]): Promise<number> =>
    requireRelay().setBlocklist(packages),
  getBlocklist: (): Promise<string[]> => requireRelay().getBlocklist(),
  status: (): Promise<RelayStatus> => requireRelay().getStatus(),
};

export const qiOverlay = {
  /** Full-screen message, hard-capped at 30 s, always dismissible. */
  show: (message: string, timeoutMs = 15_000): Promise<boolean> =>
    requireOverlay().show(message, timeoutMs),
  hide: (): Promise<boolean> => requireOverlay().hide(),
  status: (): Promise<OverlayStatus> => requireOverlay().getStatus(),
};

export const qiAudit = {
  append: (type: string, detail: string): Promise<AuditAppendResult> =>
    requireAudit().append(type, detail),
  read: (limit = 50, offset = 0): Promise<AuditRecord[]> =>
    requireAudit().read(limit, offset),
  export: (): Promise<AuditExport> => requireAudit().export(),
  verifyChain: (): Promise<AuditChain> => requireAudit().verifyChain(),
};

export const qiWidget = {
  /** Pushes the current pairing summary to the home-screen widget. */
  update: (title: string, body: string): Promise<number> =>
    requireWidget().update(title, body),
};

export const qiReminder = {
  schedule: (
    id: string,
    hour: number,
    minute: number,
    daysCsv: string,
    message: string,
    fullscreen: boolean,
  ): Promise<boolean> =>
    requireReminder().schedule(id, hour, minute, daysCsv, message, fullscreen),
  cancel: (id: string): Promise<boolean> => requireReminder().cancel(id),
  rescheduleAll: (): Promise<boolean> => requireReminder().rescheduleAll(),
};

function requireNotice(): any {
  const mod = NativeModules.QiNotice;
  if (!mod) {
    throw new Error('当前设备不支持通知');
  }
  return mod;
}

export const qiNotice = {
  /** 双向事件通知：任务、和好券、定时规则。`fullscreen` 由系统决定是否全屏。 */
  post: (
    id: string,
    title: string,
    body: string,
    fullscreen = false,
  ): Promise<boolean> => requireNotice().post(id, title, body, fullscreen),
  cancel: (id: string): Promise<boolean> => requireNotice().cancel(id),
};

export const qiDevice = {
  permissions: qiDevicePermissions,
  guard: qiGuard,
  usage: qiUsageStats,
  screenshot: qiScreenshot,
  location: qiLocation,
  notifications: qiNotificationRelay,
  overlay: qiOverlay,
  audit: qiAudit,
  widget: qiWidget,
  reminders: qiReminder,
  notice: qiNotice,
};
