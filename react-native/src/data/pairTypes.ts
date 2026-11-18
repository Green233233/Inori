/** 祈 v0.6.0 领域类型：角色、配对、权限、券、任务与遥测。 */
import type {PowerTier} from '../config';

export type Role = 'MASTER' | 'PUPPY';
export type QiStage =
  | 'loading'
  | 'consent'
  | 'journal'
  | 'auth'
  | 'pairing'
  | 'ready';

export interface PairSummary {
  pairId: string;
  myRole: Role;
  ownerName: string;
  puppyName: string;
  myDeviceId: string;
  peerDeviceId: string | null;
  peerPubkey: string | null;
  peerPlatform: string | null;
  verified: boolean;
  createdAt: string;
  unpairedAt: string | null;
  peerOnline: boolean;
  peerLastSeen: string | null;
  peerBattery: number | null;
  peerPowerTier: PowerTier | null;
}

/**
 * 小狗端「自动规则」：到点自动切换功耗档位，并把当前命中的规则显示出来。
 * 规则只改档位，不做任何联网或唤醒，避免为了自动化反而更费电。
 */
export interface AutoRule {
  id: string;
  label: string;
  /** HH:MM，24 小时制；start > end 表示跨夜。 */
  start: string;
  end: string;
  tier: PowerTier;
  enabled: boolean;
}

/**
 * 小狗端「装扮」：只影响自己的观感与桌面小组件文案，不涉及权限与同步。
 * frame 是头像光环的配色，greeting 是主页上那句给自己的话。
 */
export interface Appearance {
  frame: 'default' | 'rose' | 'mint' | 'gold';
  greeting: string;
  widgetTitle: string;
  widgetBody: string;
}

export const DEFAULT_APPEARANCE: Appearance = {
  frame: 'default',
  greeting: '',
  widgetTitle: '祈',
  widgetBody: '打开祈完成联结',
};

export interface QiState {
  serverUrl: string;
  pin: string;
  username: string | null;
  deviceId: string;
  pair: PairSummary | null;
  pendingBindingCode: string | null;
  /** 个人资料（主人 / 小狗各自的本机设定）。 */
  displayName: string | null;
  avatarStyle: 'role' | 'initial' | 'photo';
  avatarImagePath: string | null;
  consentVersion: number;
  /** 已消费的 relay 游标；用于断点续传命令与结果。 */
  relayCursor: number;
  /** 小狗端响应策略：关闭后对应命令会被拒绝并向主人明确报错。 */
  allowOverlay: boolean;
  allowUsage: boolean;
  /** 小狗端自动规则（主人端不展示）。 */
  autoRules: AutoRule[];
  appearance: Appearance;
  consentAt: number | null;
  journalOnly: boolean;
  powerTier: PowerTier;
}

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

export interface PermissionGrant {
  key: PermissionKey;
  granted: boolean;
  grantedAt?: number;
  revokedAt?: number;
  source?: 'system' | 'user';
}

export interface Coupon {
  id: number;
  code: string;
  normalizedCode: string;
  type: 'hehao' | 'exam' | 'reward';
  typeLabel: string;
  createdAt: string;
  createdAtDisplay: string | null;
  serial: string;
  signatureShort: string;
  status: 'unused' | 'used';
  usedAt: string | null;
  usedAtDisplay: string | null;
  usedByDevice: string | null;
  noteCipher: string | null;
  usedNoteCipher: string | null;
}

export type TaskState = 'issued' | 'submitted' | 'accepted' | 'rejected';

export interface Task {
  id: string;
  title: string;
  detail: string;
  deadline?: string | null;
  rewardStars?: number | null;
  state: TaskState;
  submittedAt?: number | null;
  submitNote?: string | null;
  submitPhotoId?: string | null;
}

export interface TelemetrySnapshot {
  deviceId: string;
  at: number;
  screenSegments: {from: number; to: number}[];
  usage: {pkg: string; label: string; minutes: number}[];
  unlocks: number;
  battery: number | null;
  charging: boolean;
}

/** relay / sync 信封类型白名单（与服务端 relay.ALLOWED_KINDS 对齐）。 */
export type EnvelopeKind =
  | 'permission.state'
  | 'power.tier'
  | 'task.create'
  | 'task.submit'
  | 'task.verdict'
  | 'command.send'
  | 'command.reply'
  | 'report.status'
  | 'reward.grant'
  | 'panic'
  | 'screenshot.request'
  | 'screenshot.consent'
  | 'screenshot.frame'
  | 'fullscreen.message'
  | 'album.request'
  | 'album.share'
  | 'shared.note'
  | 'shared.photo'
  | 'shared.milestone'
  | 'presence.update'
  | 'pair.unpaired'
  | 'journal.entry'
  | 'test.ping';

export interface RelayItem {
  seq: number;
  fromDevice: string;
  toDevice: string;
  kind: EnvelopeKind;
  ciphertext: string;
  createdAt: string;
  createdAtDisplay: string | null;
}
