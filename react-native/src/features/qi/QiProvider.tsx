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
import {
  AppState,
  PermissionsAndroid,
  Platform,
} from 'react-native';
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
  openJson,
  sha256Text,
  shortAuthString,
} from '../../crypto/Crypto';
import {
  ApiError,
  api,
  errorMessage,
  getServerUrl,
  setServerUrl,
  setToken,
} from '../../net/ApiClient';
import {showToast} from '../../components/toast';
import {qiApi} from '../../native/QiNative';
import {
  qiDeviceAvailable,
  qiGuard,
  qiLink,
  qiWidget,
} from '../../native/QiDevice';
import {syncJournal, SyncResult} from '../../sync/partnerStore';
import {handleAppLimit, sendAppLimit} from '../../sync/appLimit';
import {qiLimits} from '../../native/QiLimits';
import type {AppLimitRules} from '../../native/QiLimits';
import {configureReminders} from '../../sync/reminders';
import {scanAlerts} from '../../sync/alerts';
import {refreshTasks} from '../../sync/tasks';
import {
  CommandKind,
  CommandReply,
  RelayItem,
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

/**
 * 这三个只读命令也由常驻服务在原生侧执行并回包（见 QiLinkService）。
 *
 * JS 再执行一遍的代价很实在：一次多余定位（最坏 12 秒 + 一次 GPS），而且
 * 主人会收到两份 id 相同的回复，第二份只会被 handleReply 丢掉。
 */
const NATIVE_COMMAND_KINDS = new Set<CommandKind>([
  'location.get',
  'usage.stats',
  'permissions.snapshot',
]);

/** 常驻服务此刻是否在替我们收命令，并且真的握着配对上下文。 */
async function nativeLinkRunning(): Promise<boolean> {
  if (!qiLink.available) {
    return false;
  }
  try {
    const status = await qiLink.status();
    // pairReady 缺省按 false 处理：没有上下文时原生只能提醒、不能执行，
    // 这时候 JS 必须自己上手，否则这条命令就没人答了。
    return status.running && status.pairReady === true;
  } catch {
    // 模块缺失或桥断了：继续走 JS 的老路径，不能因此漏执行。
    return false;
  }
}

/**
 * 只解密头部拿 kind，不执行。
 *
 * 消息本来就要在 executeCommand 里再解一次；这里多解一次只是为了知道
 * 「原生会不会接手」。解不开就当作不接手，让 executeCommand 按老逻辑吞掉。
 */
async function peekCommandKind(
  pair: PairSummary,
  item: RelayItem,
): Promise<CommandKind | null> {
  if (!pair.peerPubkey) {
    return null;
  }
  try {
    const request = await openJson<{kind?: string}>(
      pair.pairId,
      pair.peerPubkey,
      JSON.parse(item.ciphertext),
    );
    return typeof request?.kind === 'string'
      ? (request.kind as CommandKind)
      : null;
  } catch {
    return null;
  }
}

/** 原生已接手这条只读命令时，JS 必须放手，否则会重复执行。 */
async function isHandledByNative(
  pair: PairSummary,
  item: RelayItem,
): Promise<boolean> {
  if (!(await nativeLinkRunning())) {
    return false;
  }
  const kind = await peekCommandKind(pair, item);
  return kind !== null && NATIVE_COMMAND_KINDS.has(kind);
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
  clearSession: () => Promise<void>;
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
  unpair: () => Promise<{alreadyUnpaired: boolean}>;
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
  /** 应用限制：本机落一份镜像，同时把名单推给对方（主人下发 / 小狗回报关闭）。 */
  sendAppLimit: (rules: AppLimitRules) => Promise<void>;
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

  /**
   * 把本地会话清干净，回到「未登录」。
   *
   * 只清 token / 用户名 / 配对信息；deviceId 与密钥身份故意保留 —— 那是
   * 这台手机的身份，换账号登录时服务端要靠公钥一致来允许改绑。
   */
  const clearSession = useCallback(async () => {
    await saveToken(null);
    setToken(null);
    tokenRef.current = null;
    setSas(null);
    await patch({username: null, pair: null, pendingBindingCode: null});
  }, [patch]);

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
    } catch (failure) {
      // 401 意味着 token 已经不可用（过期 / 被注销 / 服务端重建过）。
      // 以前这里无声 return null，界面就停在「已登录但点什么都失败」的
      // 假象里，用户只能手动退出登录自救；现在清掉会话，stage 会自己
      // 回到登录页，并把原因显示出来。
      if (failure instanceof ApiError && failure.status === 401) {
        await clearSession();
        setError(errorMessage(failure));
      }
      return null;
    }
  }, [clearSession, computeSas, patch]);

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
    const configured = await qiApi.configure(loaded.serverUrl, loaded.pin).catch(
      () => false,
    );
    if (configured === false) {
      // 地址写错、网络不通、或证书指纹对不上都会走到这里。以前完全静默，
      // 用户只看到「登录失败」却不知道为什么，先把原因摊到登录页上。
      setError('连不上服务器：请检查地址、网络，以及证书指纹是否与服务器一致');
    }
    const token = await loadToken();
    if (token) {
      setToken(token);
      tokenRef.current = token;
      await ensureIdentity().catch(() => null);
      const first = await refreshPair();
      if (!first) {
        // 冷启动第一枪常常打在网络/DNS 还没就绪的时刻。以前这里拿到 null 就
        // 收工，界面直接显示「绑定」选择页，看起来像配对丢了；再试一次能让
        // 绝大多数冷启动直接回到主页。
        await new Promise(resolve => setTimeout(resolve, 1200));
        await refreshPair();
      }
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
        await qiLink.stop().catch(() => undefined);
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

  /*
   * 解绑以前把服务端错误整个吞掉（`.catch(() => null)`），结果是「本地看着解开了、
   * 服务器上还绑着」——再想重新配对就报 already_paired，用户完全不知道发生了什么。
   * 现在：服务端明确返回（含 alreadyUnpaired / 404）才算确认；确认不了就清完本地再抛出，
   * 由界面提示「本地已解绑，服务器没确认」。
   */
  const unpair = useCallback(
    () =>
      run(async () => {
        let alreadyUnpaired = false;
        let serverConfirmed = false;
        let serverError: unknown = null;
        try {
          const result = await api<{ok: boolean; alreadyUnpaired?: boolean}>(
            '/api/v1/pairs',
            {method: 'DELETE', body: {}},
          );
          serverConfirmed = true;
          alreadyUnpaired = result?.alreadyUnpaired === true;
        } catch (failure) {
          if (failure instanceof ApiError && failure.status === 404) {
            serverConfirmed = true;
            alreadyUnpaired = true;
          } else {
            serverError = failure;
          }
        }
        await qiLink.stop().catch(() => undefined);
        setSas(null);
        await patch({pair: null, pendingBindingCode: null});
        if (!serverConfirmed) {
          throw new Error(
            `本地已解除绑定，但服务器没有确认（${
              serverError instanceof Error ? serverError.message : '网络异常'
            }）。联网后请再看一眼「我的身份与联结」。`,
          );
        }
        return {alreadyUnpaired};
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
    /*
     * 同步失败以前完全静默，用户只看到「怎么又没过去」。
     * 这里把第一篇失败的原因说出来（多半是附件太大或网络断了）。
     */
    if (result.failed > 0) {
      showToast(
        `${result.failed} 篇日记没能同步过去${
          result.lastError ? `：${result.lastError}` : '，稍后再试'
        }`,
      );
    }
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

  const sendAppLimitAction = useCallback(
    (rules: AppLimitRules) =>
      run(async () => {
        const current = await loadQiState();
        if (!current.pair) {
          throw new Error('还没有完成配对，无法下发应用限制');
        }
        // 先在自己这台设备上落一份镜像，界面立刻能看到名单，
        // 对方离线时也不会出现「保存了但什么都没有」的错觉。
        await qiLimits.setRules(rules).catch(() => false);
        await sendAppLimit(current.pair, rules);
      }),
    [run],
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
              // 常驻服务在跑时，只读命令它已经解密执行并回包了；这里跳过，
              // 否则同一条命令会被执行两次（多一次定位、多一份回包）。
              if (await isHandledByNative(current.pair, item)) {
                continue;
              }
              await executeCommand(current.pair, item, {
                allowOverlay: current.allowOverlay,
                allowUsage: current.allowUsage,
              }).catch(() => undefined);
            } else if (item.kind === 'command.reply') {
              await handleReply(current.pair, item).catch(() => undefined);
            } else if (
              item.kind === 'app.limit' ||
              item.kind === 'app.limit.ack'
            ) {
              await handleAppLimit(current.pair, item).catch(() => undefined);
            }
          }
          // v0.6.8：只有「对方真的做了事」才刷新配对与任务。
          // command.reply 是自己刚发出去的命令的回包（比如通知转发页拉一次 drain），
          // 如果它也触发 refreshPair，pair 对象换新 → 依赖 pair 的页面 effect 重跑 →
          // 再发命令 → 再回包，就成了永远刷不完的死循环。
          const meaningful = page.items.some(item => item.kind !== 'command.reply');
          if (meaningful) {
            await refreshPair().catch(() => undefined);
            // 对方有新动作：顺手拉一次任务并弹通知（长轮询本身就是心跳，不额外起定时器）。
            const latest = await loadQiState();
            if (latest.pair) {
              await refreshTasks(latest.pair).catch(() => undefined);
              await scanAlerts(latest.pair.myRole, page.items).catch(
                () => undefined,
              );
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

  // 小狗端的常驻联动通道：App 不在前台/被划掉时，主人派的任务与券也能提醒。
  // 只有「小狗端 + 已就绪」才启动；解绑与退出登录在各自流程里 stop。
  const notificationAskedRef = useRef(false);
  useEffect(() => {
    if (!qiLink.available) {
      return;
    }
    if (stage !== 'ready' || state.pair?.myRole !== 'PUPPY') {
      qiLink.stop().catch(() => undefined);
      return;
    }
    let cancelled = false;
    const ensureNotifications = async () => {
      // Android 13+ 通知是运行时权限；只有第一次启动服务前问一次。
      if (notificationAskedRef.current || Number(Platform.Version) < 33) {
        return;
      }
      notificationAskedRef.current = true;
      const granted = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      ).catch(() => false);
      if (granted || cancelled) {
        return;
      }
      // 用户拒绝也不阻塞服务：通知发不出去时会静默跳过。
      await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      ).catch(() => undefined);
    };
    const start = async () => {
      const token = tokenRef.current;
      if (!token) {
        return;
      }
      await ensureNotifications();
      if (cancelled) {
        return;
      }
      await qiLink.start(token, getServerUrl()).catch(() => undefined);
      // 服务靠这份上下文在 JS 不在时解密并回答只读命令；重新读一次状态，
      // 保证刚换过/刚补上的公钥也能同步过去。
      const latest = await loadQiState().catch(() => null);
      const pair = latest?.pair;
      if (!cancelled && pair?.pairId && pair.peerPubkey) {
        await qiLink
          .setPairContext(pair.pairId, pair.peerPubkey)
          .catch(() => undefined);
      }
    };
    start().catch(() => undefined);
    // 从后台回来时再确认一次：系统可能已经把服务回收并重建失败。
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') {
        start().catch(() => undefined);
      }
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [stage, state.pair?.myRole, state.pair?.pairId, state.pair?.peerPubkey]);

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
      clearSession,
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
      sendAppLimit: sendAppLimitAction,
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
      clearSession,
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
      sendAppLimitAction,
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
