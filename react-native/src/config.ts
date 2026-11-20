/** Global product identity. Single source of truth for the version string. */
export const APP_NAME = '祈';
export const APP_EN_NAME = 'Inorinal';
export const VERSION_NAME = 'v0.6.4';
export const VERSION_CODE = 13;
export const DEDICATION = '以本软件献给我最亲爱的小不点儿～';

/** Default self-hosted server (written to the settings screen on first run). */
export const DEFAULT_SERVER_URL = 'https://124-221-102-236.sslip.io:8443';
/**
 * 自签证书的 leaf SHA-256（小写十六进制）。
 *
 * 公网 443 走「已备案域名 + 公共证书」，这里用的是 8443 + 自签证书，所以必须
 * 带指纹 pin：pin 非空时原生跳过主机名校验，改用证书指纹比对（见 ApiClientModule）。
 * 换证后这行必须同步更新，否则 App 会拒绝连接。
 */
export const DEFAULT_SERVER_PIN =
  'dd591f20bc8539f6d00c87f5484a86805cd610b0a8e096865ecd82546b6945f5';
/** Long-poll hold used when the app is in the foreground. */
export const POLL_WAIT_FOREGROUND = 25;
/** Long-poll hold used when the puppy guard service is idle. */
export const POLL_WAIT_IDLE = 300;
/** Local power tiers (see docs/react-refactor/v0.6.0-power.md). */
export type PowerTier = 'SAVER' | 'BALANCED' | 'REALTIME';
