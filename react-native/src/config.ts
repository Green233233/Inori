/** Global product identity. Single source of truth for the version string. */
export const APP_NAME = '祈';
export const APP_EN_NAME = 'Inorinal';
export const VERSION_NAME = 'v0.6.1';
export const VERSION_CODE = 10;
export const DEDICATION = '以本软件献给我最亲爱的小不点儿～';

/** Default self-hosted server (written to the settings screen on first run). */
export const DEFAULT_SERVER_URL = 'http://10.0.2.2:8095';
/** Long-poll hold used when the app is in the foreground. */
export const POLL_WAIT_FOREGROUND = 25;
/** Long-poll hold used when the puppy guard service is idle. */
export const POLL_WAIT_IDLE = 300;
/** Local power tiers (see docs/react-refactor/v0.6.0-power.md). */
export type PowerTier = 'SAVER' | 'BALANCED' | 'REALTIME';
