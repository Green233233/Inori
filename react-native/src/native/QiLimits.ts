/**
 * Typed wrapper around the `QiLimits` native module (主人端名单 + 小狗端拦截执行器).
 *
 * Mirrors the style of `QiDevice.ts`: the module is looked up once, every call is
 * a Promise, and a clear error is thrown when the installed APK predates the
 * module. Two things worth knowing:
 *  - the actual blocking loop is native and lives inside `PuppyGuardService`;
 *    `getStatus().watching` is the only honest answer to "is it running now";
 *  - `setRules` is the same call on both phones. On the 小狗端 it takes effect
 *    immediately; on the 主人端 it only persists the mirror that gets sent over
 *    the relay, so the owner screen keeps its list between app launches.
 */
import {NativeModules} from 'react-native';

// --------------------------------------------------------------------- types

export interface AppLimitEntry {
  pkg: string;
  label: string;
}

export interface AppLimitRules {
  enabled: boolean;
  blocked: AppLimitEntry[];
  /** 写入时间（服务端毫秒时间戳，0 = 从未下发过）。 */
  updatedAt: number;
}

export interface AppLimitStatus {
  enabled: boolean;
  blockedCount: number;
  /** true 仅当限制开启、名单非空且此刻屏幕亮着并已解锁。 */
  watching: boolean;
  /** 小狗端是否已允许「显示在其他应用上层」；false 时拦截无法展示。 */
  overlayAllowed: boolean;
}

export interface AppLimitLabel {
  pkg: string;
  label: string;
  /** false 表示这台设备没装该应用，label 会回退为包名。 */
  installed: boolean;
}

interface RulesReply {
  ok?: boolean;
  rules?: {
    enabled?: boolean;
    blocked?: AppLimitEntry[];
    updatedAt?: number;
  };
}

interface StatusReply {
  ok?: boolean;
  enabled?: boolean;
  blockedCount?: number;
  watching?: boolean;
  overlayAllowed?: boolean;
}

interface LabelReply {
  ok?: boolean;
  pkg?: string;
  label?: string;
  installed?: boolean;
}

interface LimitsApi {
  setRules: (rulesJson: string) => Promise<{ok?: boolean}>;
  getRules: () => Promise<RulesReply>;
  getStatus: () => Promise<StatusReply>;
  resolveLabel: (pkg: string) => Promise<LabelReply>;
}

const limitsModule = NativeModules.QiLimits as LimitsApi | undefined;

function requireLimits(): LimitsApi {
  if (!limitsModule) {
    throw new Error('QiLimits 未注册：请重新构建 Android 应用');
  }
  return limitsModule;
}

/** relay 下发的正是这个形状（不含本地 updatedAt）。 */
export function toWireRules(rules: AppLimitRules): {
  enabled: boolean;
  blocked: AppLimitEntry[];
} {
  return {
    enabled: rules.enabled,
    blocked: rules.blocked.map(entry => ({
      pkg: entry.pkg,
      label: entry.label,
    })),
  };
}

function normalizeEntries(input?: AppLimitEntry[]): AppLimitEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  const result: AppLimitEntry[] = [];
  for (const item of input) {
    const pkg = typeof item?.pkg === 'string' ? item.pkg.trim() : '';
    if (!pkg || seen.has(pkg)) {
      continue;
    }
    seen.add(pkg);
    const label =
      typeof item?.label === 'string' && item.label.trim()
        ? item.label.trim()
        : pkg;
    result.push({pkg, label});
  }
  return result;
}

// --------------------------------------------------------------------- api

export const qiLimits = {
  /**
   * 写入名单。返回 true 表示原生已落盘；服务在跑时立即生效。
   * `updatedAt` 由原生补上，调用方传 0 即可。
   */
  async setRules(rules: AppLimitRules): Promise<boolean> {
    const reply = await requireLimits().setRules(
      JSON.stringify(toWireRules(rules)),
    );
    return reply?.ok === true;
  },

  /** 读取当前落盘的名单；读不到时回退为「关闭 + 空名单」。 */
  async getRules(): Promise<AppLimitRules> {
    const reply = await requireLimits().getRules();
    const rules = reply?.rules;
    return {
      enabled: rules?.enabled === true,
      blocked: normalizeEntries(rules?.blocked),
      updatedAt: typeof rules?.updatedAt === 'number' ? rules.updatedAt : 0,
    };
  },

  /** 小狗端真正的执行状态；主人端调用时 watching 一般为 false。 */
  async getStatus(): Promise<AppLimitStatus> {
    const reply = await requireLimits().getStatus();
    return {
      enabled: reply?.enabled === true,
      blockedCount:
        typeof reply?.blockedCount === 'number' ? reply.blockedCount : 0,
      watching: reply?.watching === true,
      overlayAllowed: reply?.overlayAllowed === true,
    };
  },

  /**
   * 把主人手动输入的包名解析成应用名。未安装不报错，`installed` 为 false。
   * 只查这一个包，不会枚举已安装列表。
   */
  async resolveLabel(pkg: string): Promise<AppLimitLabel> {
    const trimmed = pkg.trim();
    const reply = await requireLimits().resolveLabel(trimmed);
    const label =
      typeof reply?.label === 'string' && reply.label.trim()
        ? reply.label.trim()
        : trimmed;
    return {
      pkg: typeof reply?.pkg === 'string' && reply.pkg ? reply.pkg : trimmed,
      label,
      installed: reply?.installed === true,
    };
  },
};
