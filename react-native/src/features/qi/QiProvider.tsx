/**
 * 祈 的账号 / 配对 / 会话状态。
 *
 * 所有网络与密钥操作都经原生层；这里只持有「可以给 UI 看」的状态。
 * 未配对时应用仍然是一本完整的日记（journalOnly），不会被锁死。
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {PowerTier} from '../../config';
import {
  CONSENT_VERSION,
  DEFAULT_QI_STATE,
  loadQiState,
  loadToken,
  newDeviceId,
  patchQiState,
  saveToken,
} from '../../data/pairStore';
import type {
  Appearance,
  AutoRule,
  PairSummary,
  QiStage,
  QiState,
  Role,
} from '../../data/pairTypes';
import {
  ensureIdentity,
  sha256Text,
  shortAuthString,
} from '../../crypto/Crypto';
import {
  api,
  errorMessage,
  setServerUrl,
  setToken,
} from '../../net/ApiClient';
import {showToast} from '../../components/toast';
import {qiApi} from '../../native/QiNative';
import {qiDeviceAvailable, qiGuard, qiWidget} from '../../native/QiDevice';
import {syncJournal, SyncResult} from '../../sync/partnerStore';
import {configureReminders} from '../../sync/reminders';
import {scanAlerts} from '../../sync/alerts';
import {refreshTasks} from '../../sync/tasks';
import {
  CommandKind,
  CommandReply,
  executeCommand,
  handleReply,
  pollRelay,
  sendCommand,
} from '../../sync/commands';

interface AuthResponse {
  token: string;
  username: string;
  deviceId: string;
}

interface PairResponse {
  pair: PairSummary;
  bindingCode?: string;
  codeExpiresAt?: string;
}

interface QiContextValue {
  state: QiState;
  stage: QiStage;
  busy: boolean;
  error: string | null;
  pair: PairSummary | null;
  role: Role | null;
  sas: string | null;
  clearError: () => void;
  acceptConsent: () => Promise<void>;
  chooseJournalOnly: () => Promise<void>;
  openSetup: () => Promise<void>;
  configureServer: (url: string, pin: string) => Promise<void>;
  register: (username: string, password: string, invite: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  createPair: (ownerName: string, puppyName: string) => Promise<string>;
  joinPair: (code: string, puppyName: string) => Promise<void>;
  confirmSas: () => Promise<void>;
  refreshPair: () => Promise<PairSummary | null>;
  unpair: () => Promise<void>;
  setPowerTier: (tier: PowerTier) => Promise<void>;
  /** 改自己的名字：绑定名与昵称合并成同一个可改的值。 */
  renameSelf: (name: string) => Promise<void>;
  updateProfile: (patch: {
    displayName?: string | null;
    avatarStyle?: 'role' | 'initial' | 'photo';
    avatarImagePath?: string | null;
  }) => Promise<void>;
  runCommand: (
    kind: CommandKind,
    args?: Record<string, unknown>,
  ) => Promise<CommandReply>;
  setPolicy: (patch: {allowOverlay?: boolean; allowUsage?: boolean}) => Promise<void>;
  /** 自动规则：本地持久化并镜像到守护服务（只在 tick 上生效，零额外唤醒）。 */
  setAutoRules: (rules: AutoRule[]) => Promise<void>;
  /** 装扮：本地观感 + 桌面小组件文案，同步推一次 widget。 */
  setAppearance: (next: Appearance) => Promise<void>;
  syncNow: () => Promise<SyncResult | null>;
  lastSyncAt: number;
}

const QiContext = createContext<QiContextValue | null>(null);

function deviceName(): string {
  return 'Android · 祈';
}

export function QiProvider({children}: {children: React.ReactNode}) {
  const [state, setState] = useState<QiState>(DEFAULT_QI_STATE);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sas, setSas] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState(0);
  const tokenRef = useRef<string | null>(null);

  const patch = useCallback(async (next: Partial<QiState>) => {
    const merged = await patchQiState(next);
    setState(merged);
    return merged;
  }, []);

  const computeSas = useCallback(
    async (pair: PairSummary, code: string) => {
      if (!pair.peerPubkey) {
        return null;
      }
      const myPublic = await ensureIdentity();
      const value = await shortAuthString(
        myPublic,
        pair.peerPubkey,
        pair.pairId,
        code,
      );
      setSas(value);
      return value;
    },
    [],
  );

  const refreshPair = useCallback(async (): Promise<PairSummary | null> => {
    if (!tokenRef.current) {
      return null;
    }
    try {
      const response = await api<{pair: PairSummary | null}>(
        '/api/v1/pairs/current',
      );
      const pair = response.pair ?? null;
      const current = await loadQiState();
      await patch({pair});
      if (pair?.peerPubkey && !pair.verified) {
        const code = current.pendingBindingCode;
        if (code) {
          await computeSas(pair, code);
        }
      }
      return pair;
    } catch {
      return null;
    }
  }, [computeSas, patch]);

  const adoptSession = useCallback(
    async (response: AuthResponse) => {
      await saveToken(response.token);
      setToken(response.token);
      tokenRef.current = response.token;
      const current = await loadQiState();
      await patch({
        username: response.username,
        deviceId: response.deviceId || current.deviceId || (await newDeviceId()),
        journalOnly: false,
      });
      await refreshPair();
    },
    [patch, refreshPair],
  );

  const bootstrap = useCallback(async () => {
    const loaded = await loadQiState();
    setState(loaded);
    setServerUrl(loaded.serverUrl);
    await qiApi.configure(loaded.serverUrl, loaded.pin).catch(() => false);
    const token = await loadToken();
    if (token) {
      setToken(token);
      tokenRef.current = token;
      await ensureIdentity().catch(() => null);
      await refreshPair();
    }
    setReady(true);
  }, [refreshPair]);

  useEffect(() => {
    bootstrap().catch(() => setReady(true));
  }, [bootstrap]);

  const run = useCallback(async <T,>(task: () => Promise<T>): Promise<T> => {
    setBusy(true);
    setError(null);
    try {
      return await task();
    } catch (failure) {
      setError(errorMessage(failure));
      throw failure;
    } finally {
      setBusy(false);
    }
  }, []);

  const acceptConsent = useCallback(
    () =>
      run(async () => {
        await patch({consentVersion: CONSENT_VERSION, consentAt: Date.now()});
      }),
    [patch, run],
  );

  const chooseJournalOnly = useCallback(
    () =>
      run(async () => {
        await patch({journalOnly: true});
      }),
    [patch, run],
  );

  const openSetup = useCallback(
    () =>
      run(async () => {
        await patch({journalOnly: false});
      }),
    [patch, run],
  );

  const configureServer = useCallback(
    (url: string, pin: string) =>
      run(async () => {
        const normalized = url.trim().replace(/\/+$/, '');
        await qiApi.configure(normalized, pin);
        setServerUrl(normalized);
        await patch({serverUrl: normalized, pin: pin.trim()});
      }),
    [patch, run],
  );

  const register = useCallback(
    (username: string, password: string, invite: string) =>
      run(async () => {
        const pubkey = await ensureIdentity();
        const current = await loadQiState();
        const response = await api<AuthResponse>('/api/v1/auth/register', {
          method: 'POST',
          auth: false,
          body: {
            username: username.trim().toLowerCase(),
            password,
            invite: invite.trim().toUpperCase(),
            deviceId: current.deviceId,
            deviceName: deviceName(),
            platform: 'android',
            pubkey,
          },
        });
        await adoptSession(response);
      }),
    [adoptSession, run],
  );

  const login = useCallback(
    (username: string, password: string) =>
      run(async () => {
        const pubkey = await ensureIdentity();
        const current = await loadQiState();
        const response = await api<AuthResponse>('/api/v1/auth/login', {
          method: 'POST',
          auth: false,
          body: {
            username: username.trim().toLowerCase(),
            password,
            deviceId: current.deviceId,
            deviceName: deviceName(),
            platform: 'android',
            pubkey,
          },
        });
        await adoptSession(response);
      }),
    [adoptSession, run],
  );

  const logout = useCallback(
    () =>
      run(async () => {
        await api('/api/v1/auth/logout', {method: 'POST'}).catch(() => null);
        await saveToken(null);
        setToken(null);
        tokenRef.current = null;
        setSas(null);
        await patch({username: null, pair: null, pendingBindingCode: null});
      }),
    [patch, run],
  );

  const createPair = useCallback(
    (ownerName: string, puppyName: string) =>
      run(async () => {
        const response = await api<PairResponse>('/api/v1/pairs', {
          method: 'POST',
          body: {ownerName: ownerName.trim(), puppyName: puppyName.trim()},
        });
        const code = response.bindingCode ?? '';
        setSas(null);
        await patch({pair: response.pair, pendingBindingCode: code});
        return code;
      }),
    [patch, run],
  );

  const joinPair = useCallback(
    (code: string, puppyName: string) =>
      run(async () => {
        const response = await api<PairResponse>('/api/v1/pairs/join', {
          method: 'POST',
          body: {code: code.trim().toUpperCase(), puppyName: puppyName.trim()},
        });
        setSas(null);
        await patch({
          pair: response.pair,
          pendingBindingCode: code.trim().toUpperCase(),
        });
        await computeSas(response.pair, code.trim().toUpperCase());
      }),
    [computeSas, patch, run],
  );

  const confirmSas = useCallback(
    () =>
      run(async () => {
        const current = await loadQiState();
        if (!current.pair || !sas) {
          throw new Error('还没有可确认的校验码');
        }
        const fingerprint = await sha256Text(`${sas}|${current.pair.pairId}`);
        const response = await api<PairResponse>('/api/v1/pairs/verify', {
          method: 'POST',
          body: {sasFingerprint: fingerprint},
        });
        await patch({
          pair: response.pair ?? current.pair,
          pendingBindingCode: null,
        });
      }),
    [patch, run, sas],
  );

  const unpair = useCallback(
    () =>
      run(async () => {
        await api('/api/v1/pairs', {method: 'DELETE', body: {}}).catch(
          () => null,
        );
        setSas(null);
        await patch({pair: null, pendingBindingCode: null});
      }),
    [patch, run],
  );

  const setPowerTier = useCallback(
    (tier: PowerTier) =>
      run(async () => {
        await patch({powerTier: tier});
      }),
    [patch, run],
  );

  const syncNow = useCallback(async (): Promise<SyncResult | null> => {
    const current = await loadQiState();
    if (!current.pair?.verified || !current.pair.peerPubkey) {
      return null;
    }
    const result = await syncJournal(current.pair, current.deviceId);
    setLastSyncAt(Date.now());
    // 通知只在拿到新数据后弹一次：谁刷新到，谁负责提醒。
    await scanAlerts(current.pair.myRole).catch(() => undefined);
    return result;
  }, []);

  const updateProfile = useCallback(
    (next: {
      displayName?: string | null;
      avatarStyle?: 'role' | 'initial' | 'photo';
      avatarImagePath?: string | null;
    }) =>
      run(async () => {
        await patch(next);
      }),
    [patch, run],
  );

  /**
   * 改名字：服务端只存两份名字（owner_name / puppy_name），「昵称」就是它。
   * 按自己的角色只改自己那一份，再拉一次配对信息让两端一致。
   */
  const renameSelf = useCallback(
    (name: string) =>
      run(async () => {
        const trimmed = name.trim().slice(0, 24);
        if (!trimmed) {
          throw new Error('名字不能为空');
        }
        const role = state.pair?.myRole;
        if (!role) {
          await patch({displayName: trimmed});
          return;
        }
        await api('/api/v1/pairs', {
          method: 'PATCH',
          body: role === 'MASTER' ? {ownerName: trimmed} : {puppyName: trimmed},
        });
        await refreshPair();
        await patch({displayName: trimmed});
      }),
    [patch, refreshPair, run, state.pair?.myRole],
  );

  const stage: QiStage = useMemo(() => {
    if (!ready) {
      return 'loading';
    }
    if (state.consentVersion < CONSENT_VERSION) {
      return 'consent';
    }
    if (state.journalOnly) {
      return 'journal';
    }
    if (!tokenRef.current || !state.username) {
      return 'auth';
    }
    if (!state.pair) {
      return 'pairing';
    }
    return state.pair.verified ? 'ready' : 'pairing';
  }, [ready, state]);

  const setPolicy = useCallback(
    (next: {allowOverlay?: boolean; allowUsage?: boolean}) =>
      run(async () => {
        await patch(next);
      }),
    [patch, run],
  );

  const setAutoRules = useCallback(
    (rules: AutoRule[]) =>
      run(async () => {
        await patch({autoRules: rules});
        /*
         * 镜像进原生；失败时明确告诉用户（而不是静默），因为「规则没进服务」
         * 意味着后台不会自动切档，和「到点生效」的承诺相违背。
         */
        try {
          await qiGuard.setAutoRules(
            JSON.stringify(
              rules.map((rule) => ({...rule, tier: rule.tier.toLowerCase()})),
            ),
          );
        } catch (error: any) {
          showToast(error?.message ?? '规则已保存，但同步给守护服务失败');
        }
      }),
    [patch, run],
  );

  const setAppearance = useCallback(
    (next: Appearance) =>
      run(async () => {
        await patch({appearance: next});
        await qiWidget
          .update(next.widgetTitle, next.widgetBody)
          .catch(() => undefined);
      }),
    [patch, run],
  );

  // 启动时把已保存的规则重新镜像一遍：重装/进程重启后原生侧不至于丢规则。
  const autoRulesRef = useRef(state.autoRules);
  useEffect(() => {
    autoRulesRef.current = state.autoRules;
  }, [state.autoRules]);
  useEffect(() => {
    if (stage !== 'ready' || !qiDeviceAvailable) {
      return;
    }
    const rules = autoRulesRef.current;
    if (!rules.length) {
      return;
    }
    qiGuard
      .setAutoRules(
        JSON.stringify(rules.map((rule) => ({...rule, tier: rule.tier.toLowerCase()}))),
      )
      .catch(() => undefined);
  }, [stage]);

  // 定时规则要按「只在本机响」过滤，角色必须传给排程器。
  useEffect(() => {
    configureReminders(state.pair?.myRole ?? 'MASTER');
  }, [state.pair?.myRole]);

  const cursorRef = useRef(state.relayCursor);
  useEffect(() => {
    cursorRef.current = state.relayCursor;
  }, [state.relayCursor]);

  useEffect(() => {
    if (stage !== 'ready' || !state.pair?.pairId || !tokenRef.current) {
      return;
    }
    let cancelled = false;
    const loop = async () => {
      while (!cancelled) {
        try {
          const page = await pollRelay(cursorRef.current, 25);
          if (cancelled) {
            break;
          }
          for (const item of page.items) {
            const current = await loadQiState();
            if (!current.pair) {
              continue;
            }
            if (item.kind === 'command.send') {
              await executeCommand(current.pair, item, {
                allowOverlay: current.allowOverlay,
                allowUsage: current.allowUsage,
              }).catch(() => undefined);
            } else if (item.kind === 'command.reply') {
              await handleReply(current.pair, item).catch(() => undefined);
            }
          }
          if (page.items.length > 0) {
            await refreshPair().catch(() => undefined);
            // 对方有新动作：顺手拉一次任务并弹通知（长轮询本身就是心跳，不额外起定时器）。
            const latest = await loadQiState();
            if (latest.pair) {
              await refreshTasks(latest.pair).catch(() => undefined);
              await scanAlerts(latest.pair.myRole).catch(() => undefined);
            }
          }
          if (page.cursor !== cursorRef.current) {
            cursorRef.current = page.cursor;
            await patch({relayCursor: page.cursor}).catch(() => undefined);
          }
        } catch {
          await new Promise(resolve => setTimeout(resolve, 6000));
        }
      }
    };
    loop().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [stage, state.pair?.pairId, patch, refreshPair]);

  const runCommand = useCallback(
    async (kind: CommandKind, args?: Record<string, unknown>) => {
      const current = await loadQiState();
      if (!current.pair) {
        throw new Error('还没有绑定');
      }
      return sendCommand(current.pair, kind, args);
    },
    [],
  );

  useEffect(() => {
    if (!qiDeviceAvailable || !state.pair) {
      return;
    }
    const partner =
      state.pair.myRole === 'MASTER'
        ? state.pair.puppyName
        : state.pair.ownerName;
    const roleLabel = state.pair.myRole === 'MASTER' ? '主人端' : '小狗端';
    qiWidget
      .update(
        `祈 · ${roleLabel}`,
        `${partner} · ${state.pair.peerOnline ? '在线' : '离线'}${
          state.pair.peerBattery != null ? ` · ${state.pair.peerBattery}%` : ''
        }`,
      )
      .catch(() => undefined);
  }, [state.pair]);

  const value = useMemo<QiContextValue>(
    () => ({
      state,
      stage,
      busy,
      error,
      pair: state.pair,
      role: state.pair?.myRole ?? null,
      sas,
      clearError: () => setError(null),
      acceptConsent,
      chooseJournalOnly,
      openSetup,
      configureServer,
      register,
      login,
      logout,
      createPair,
      joinPair,
      confirmSas,
      refreshPair,
      unpair,
      setPowerTier,
      updateProfile,
      renameSelf,
      setPolicy,
      setAutoRules,
      setAppearance,
      runCommand,
      syncNow,
      lastSyncAt,
    }),
    [
      state,
      stage,
      busy,
      error,
      sas,
      acceptConsent,
      chooseJournalOnly,
      openSetup,
      configureServer,
      register,
      login,
      logout,
      createPair,
      joinPair,
      confirmSas,
      refreshPair,
      unpair,
      setPowerTier,
      updateProfile,
      setPolicy,
      setAutoRules,
      setAppearance,
      runCommand,
      syncNow,
      lastSyncAt,
    ],
  );

  return <QiContext.Provider value={value}>{children}</QiContext.Provider>;
}

export function useQi(): QiContextValue {
  const context = useContext(QiContext);
  if (!context) {
    throw new Error('useQi 必须在 QiProvider 内使用');
  }
  return context;
}
