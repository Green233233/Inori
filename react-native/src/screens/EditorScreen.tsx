import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {WebView as RNWebView} from 'react-native-webview';

// react-native-webview's generic typings do not line up with RN 0.88's React
// types (props collapse to `never`); keep the runtime component but loosen the
// type here so the screen stays type-checkable.
const WebView: any = RNWebView;
import {useAppTheme} from '../theme/AppThemeProvider';
import {onAccentFor, withAlpha} from '../theme/palette';
import {Z} from '../theme/zIndex';
import {GlassIcon} from '../components/GlassIcon';
import {GlassIconName} from '../components/glass-icons.generated';
import {AppSheet, AppDialog, TextButton, FlatButton} from '../components/Ui';
import {GlassSurface} from '../components/Surfaces';
import {showToast} from '../components/toast';
import {native} from '../native/InorinalNative';
import {BRIDGE_SHIM} from '../editor/bridgeShim';
import {ImageViewer} from '../components/ImageViewer';
import {getEntry, saveEntry} from '../data/storage';
import {getPartnerEntry} from '../sync/partnerStore';
import {
  AppSettings,
  CATEGORY_LABEL,
  Category,
  JournalEntry,
  MOOD_LABEL,
  Mood,
  SELECTABLE_CATEGORY,
  SELECTABLE_MOOD,
  SELECTABLE_WEATHER,
  WEATHER_LABEL,
  Weather,
  defaultEntryTitle,
  normalizeCategory,
  normalizeMood,
  normalizeWeather,
  todayIso,
} from '../data/types';
import {isBlankEditorHtml, stripEditorState} from '../data/html';

const EDITOR_URL = 'file:///android_asset/editor/editor.html';
/** 只读页复用同一份 HTML/CSS/JS，只加一个 view=1 参数。 */
const EDITOR_READONLY_URL = `${EDITOR_URL}?view=1`;
/** WebView 淡入时长，需求要求 ≤150ms，且只动 opacity。 */
const WEBVIEW_FADE_MS = 120;
const AUTO_SAVE_DELAY = 350;

/**
 * 冷启动骨架用的纯文本首屏：从存储里的 HTML 粗略抽文字（不解析 DOM）。
 * 只是为了在 WebView 冷启动的几百毫秒里先让用户看到标题/日期/正文开头，
 * 真正的排版仍由 WebView 负责。
 */
function toPlainPreview(html: string): string {
  if (!html) {
    return '';
  }
  return html
    .replace(/<div[^>]*doodle-data[\s\S]*?<\/div>/gi, ' ')
    // 图片（含内联 base64 的 data URI）一律不参与纯文本：一行几千个字符的
    // base64 既没法读，也会把回退页面撑爆。只留一句占位。
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 800);
}

const TEXT_COLORS = [
  '#333333', '#666666', '#FF6B6B', '#FFB6C1', '#FF8C42', '#FFD93D',
  '#6BCB77', '#4D96FF', '#9B59B6', '#1ABC9C', '#E91E63', '#795548',
];
const DOODLE_COLORS = [
  '#000000', '#333333', '#666666', '#FF0000', '#FF6B6B', '#FFB6C1',
  '#FF8C42', '#FFD93D', '#6BCB77', '#4D96FF', '#9B59B6', '#1ABC9C',
  '#E91E63', '#795548', '#00BCD4', '#CDDC39', '#FF69B4', '#8B4513',
  '#2E8B57', '#4169E1', '#FF4500', '#DA70D6', '#20B2AA', '#FFFFFF',
];
const STICKERS: {key: string; emoji: string}[] = [
  {key: 'heart', emoji: '❤️'},
  {key: 'star', emoji: '⭐'},
  {key: 'smile', emoji: '😊'},
  {key: 'flower', emoji: '🌸'},
  {key: 'sun', emoji: '☀️'},
  {key: 'moon', emoji: '🌙'},
  {key: 'cloud', emoji: '☁️'},
  {key: 'rain', emoji: '🌧️'},
  {key: 'snow', emoji: '❄️'},
  {key: 'leaf', emoji: '🍃'},
  {key: 'cat', emoji: '🐱'},
  {key: 'puppy', emoji: '🐶'},
  {key: 'bird', emoji: '🐦'},
  {key: 'fish', emoji: '🐟'},
  {key: 'cake', emoji: '🎂'},
  {key: 'coffee', emoji: '☕'},
  {key: 'book', emoji: '📖'},
  {key: 'music', emoji: '🎵'},
  {key: 'sparkle', emoji: '✨'},
  {key: 'ribbon', emoji: '🎀'},
];
const BRUSHES: {
  key: string;
  label: string;
  min: number;
  max: number;
  initial: number;
}[] = [
  {key: 'pencil', label: '铅笔', min: 0, max: 5, initial: 2},
  {key: 'pen', label: '钢笔', min: 0, max: 5, initial: 2},
  {key: 'marker', label: '马克笔', min: 5, max: 25, initial: 12},
  {key: 'watercolor', label: '水彩', min: 5, max: 25, initial: 12},
  {key: 'highlighter', label: '荧光笔', min: 5, max: 25, initial: 12},
  {key: 'eraser', label: '橡皮擦', min: 1, max: 30, initial: 12},
];
const FONT_CHIPS = [
  {label: '手写体', value: 'handwrite'},
  {label: '宋体', value: 'serif'},
  {label: '黑体', value: 'sans-serif'},
];
const SIZE_CHIPS = [
  {label: '小', value: '2'},
  {label: '中', value: '3'},
  {label: '大', value: '5'},
];

type Toolbar = 'none' | 'text' | 'doodle' | 'sticker';

interface Snapshot {
  title: string;
  content: string;
  weather: Weather;
  mood: Mood;
  category: Category;
  visibility: 'pair' | 'private';
}

interface StickerFile {
  id: string;
  fileName: string;
  mime: string;
  path: string;
  size: number;
}

function makeId(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 32; i += 1) {
    out += hex[Math.floor(Math.random() * 16)];
    if (i === 7 || i === 11 || i === 15 || i === 19) {
      out += '-';
    }
  }
  return out;
}

function formatBrushSize(value: number): string {
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function weatherIcon(weather: Weather): GlassIconName {
  switch (weather) {
    case 'RAINY':
      return 'weatherRain';
    case 'CLOUDY':
      return 'weatherCloud';
    case 'NIGHT_CLEAR':
      return 'weatherNight';
    default:
      return 'weatherSun';
  }
}

function moodIcon(mood: Mood): GlassIconName {
  switch (mood) {
    case 'SAD':
      return 'moodSad';
    case 'HAPPY':
      return 'moodHappy';
    default:
      return 'moodNeutral';
  }
}

export function EditorScreen({
  entryId,
  settings,
  onBack,
  readOnly = false,
}: {
  entryId: string;
  settings: AppSettings;
  onBack: () => void;
  /**
   * 只读模式（v0.6.2）：同一个 WebView，只加 `?view=1`，隐藏全部编辑入口。
   * 默认 false，App.tsx 的旧调用点无需改动。
   */
  readOnly?: boolean;
}) {
  const {colors, surfaces, isDark, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const webRef = useRef<any>(null);
  /**
   * WebView 渲染进程崩溃（多图 base64 撑爆内存）时的自愈次数。
   * 崩溃后 React Native 侧收不到任何 painted/ready 消息，界面会永远停在骨架上，
   * 所以这里显式 reload 一次，再失败就把骨架收起，让用户至少看到只读首屏文本。
   */
  const crashReloadsRef = useRef(0);
  const [loaded, setLoaded] = useState(false);
  const [pageReady, setPageReady] = useState(false);
  const [contentDrawn, setContentDrawn] = useState(false);
  /**
   * 冷启动骨架：在 WebView 首帧之前先画出「标题 / 日期 / 正文纯文本首屏」，
   * 数据一到就可见，不必等 WebView 解析完 4 个 JS 资源。
   */
  const [firstScreenText, setFirstScreenText] = useState('');
  const [skeletonGone, setSkeletonGone] = useState(false);
  const [firstScreenDate, setFirstScreenDate] = useState(todayIso());
  const [title, setTitle] = useState('');
  const [weather, setWeather] = useState<Weather>('SUNNY');
  const [mood, setMood] = useState<Mood>('HAPPY');
  const [category, setCategory] = useState<Category>('DAILY');
  const [toolbar, setToolbar] = useState<Toolbar>('none');
  const [metaMenuOpen, setMetaMenuOpen] = useState(false);
  // 「仅自己可见」：私密条目永不出本机（同步层已按 visibility 过滤）。
  const [visibility, setVisibility] = useState<'pair' | 'private'>('pair');
  const visibilityRef = useRef<'pair' | 'private'>('pair');
  const [weatherSheet, setWeatherSheet] = useState(false);
  const [moodSheet, setMoodSheet] = useState(false);
  const [categorySheet, setCategorySheet] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [emptyDialog, setEmptyDialog] = useState<{
    visible: boolean;
    content: string;
  }>({visible: false, content: ''});
  const [fonts, setFonts] = useState({family: 'handwrite', size: '3'});
  const [brush, setBrush] = useState(BRUSHES[0].key);
  const [brushSize, setBrushSize] = useState(2);
  const [doodleColor, setDoodleColor] = useState('#000000');
  const [stickers, setStickers] = useState<StickerFile[]>([]);
  const [deleteStickerTarget, setDeleteStickerTarget] = useState<StickerFile | null>(
    null,
  );
  const [stickersLoading, setStickersLoading] = useState(false);

  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const mountAtRef = useRef(Date.now());
  const webOpacity = useRef(new Animated.Value(0)).current;
  const titleRef = useRef(title);
  titleRef.current = title;
  const weatherRef = useRef(weather);
  weatherRef.current = weather;
  const moodRef = useRef(mood);
  moodRef.current = mood;
  const categoryRef = useRef(category);
  categoryRef.current = category;

  const entryRef = useRef<JournalEntry | null>(null);
  const persistedRef = useRef(false);
  const loadedRef = useRef(false);
  // 正文（展示用 HTML）是否已就位：骨架阶段标题已经可见，但此时自动保存
  // 不能跑，否则可能把还没转换好的正文当成空页写回。
  const hydratedRef = useRef(false);
  const pageReadyRef = useRef(false);
  const contentRef = useRef('');
  const pendingContentRef = useRef<string | null>(null);
  const lastSavedRef = useRef<Snapshot | null>(null);
  const savingRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callSeqRef = useRef(0);
  const repliesRef = useRef<Map<string, (value?: string) => void>>(new Map());
  const themeRef = useRef({colors, isDark});
  themeRef.current = {colors, isDark};
  const fontSizeRef = useRef(settings.fontSize);
  fontSizeRef.current = settings.fontSize;

  const brushSpec = BRUSHES.find(item => item.key === brush) ?? BRUSHES[0];

  // Never leave the paper behind a permanent loading veil if the WebView fails
  // to report ready (e.g. asset corruption); the editor remains usable.
  useEffect(() => {
    const timer = setTimeout(() => {
      setPageReady(true);
      setLoaded(true);
    }, 12000);
    return () => clearTimeout(timer);
  }, []);

  /* ---------------------------------------------------------------- */
  /* Bridge helpers                                                   */
  /* ---------------------------------------------------------------- */

  const invoke = useCallback((fn: string, ...args: unknown[]) => {
    const script = `window.__rnInvoke(${JSON.stringify(fn)},${JSON.stringify(
      args,
    )});true;`;
    webRef.current?.injectJavaScript(script);
  }, []);

  const call = useCallback((fn: string, timeoutMs = 2000): Promise<string | undefined> => {
    return new Promise(resolve => {
      const id = String(++callSeqRef.current);
      let settled = false;
      const finish = (value?: string) => {
        if (settled) {
          return;
        }
        settled = true;
        repliesRef.current.delete(id);
        resolve(value);
      };
      repliesRef.current.set(id, finish);
      const script = `window.__rnCall(${JSON.stringify(id)},${JSON.stringify(
        fn,
      )},[]);true;`;
      webRef.current?.injectJavaScript(script);
      setTimeout(() => finish(undefined), timeoutMs);
    });
  }, []);

  const applyTheme = useCallback(() => {
    const theme = themeRef.current;
    invoke(
      'applyTheme',
      theme.isDark,
      theme.colors.background,
      theme.colors.onBackground,
      theme.colors.surface,
      theme.colors.surface,
      theme.colors.surface,
      theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
    );
    const clamped = Math.min(28, Math.max(12, fontSizeRef.current || 16));
    invoke('applyEditorSettings', clamped);
  }, [invoke]);

  const flushPending = useCallback(() => {
    applyTheme();
    if (pendingContentRef.current !== null) {
      const html = pendingContentRef.current;
      pendingContentRef.current = null;
      invoke('setContent', html);
    }
  }, [applyTheme, invoke]);

  /* ---------------------------------------------------------------- */
  /* Load                                                             */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (entryId === 'new') {
        const now = new Date();
        const draft: JournalEntry = {
          id: makeId(),
          title: defaultEntryTitle(now),
          content: '',
          date: todayIso(),
          weather: 'SUNNY',
          mood: 'HAPPY',
          category: 'DAILY',
          isFavorite: false,
          imageUrl: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          visibility: 'pair',
        };
        entryRef.current = draft;
        persistedRef.current = false;
        if (cancelled) {
          return;
        }
        setTitle(draft.title);
        setWeather(draft.weather);
        setMood(draft.mood);
        setCategory(draft.category);
        setFirstScreenDate(draft.date);
        setFirstScreenText('');
        contentRef.current = '';
        pendingContentRef.current = '';
        hydratedRef.current = true;
        loadedRef.current = true;
        setLoaded(true);
        return;
      }

      // 对方的日记不在本机日记库里，而是同步层镜像（partner.json）；
      // 只读打开时必须回退到镜像，否则会误判「该日记不存在」。
      const entry =
        (await getEntry(entryId)) ??
        (await getPartnerEntry(entryId).catch(() => null));
      if (cancelled) {
        return;
      }
      if (!entry) {
        showToast('该日记不存在或已被删除');
        onBackRef.current();
        return;
      }
      entryRef.current = entry;
      persistedRef.current = true;
      const cleanedContent = stripEditorState(entry.content);
      if (cleanedContent !== entry.content) {
        entry.content = cleanedContent;
        if (!readOnlyRef.current) {
          try {
            await saveEntry(entry);
          } catch {
            // Cleaning is best-effort; the editor still loads the content below.
          }
        }
      }
      setTitle(entry.title);
      setWeather(normalizeWeather(entry.weather));
      setMood(normalizeMood(entry.mood));
      setCategory(normalizeCategory(entry.category));
      setVisibility(entry.visibility === 'private' ? 'private' : 'pair');
      visibilityRef.current = entry.visibility === 'private' ? 'private' : 'pair';
      // 先把本地数据骨架画出来（<50ms），WebView 的转换/冷启动在后台继续。
      setFirstScreenDate(entry.date || todayIso());
      setFirstScreenText(toPlainPreview(entry.content));
      loadedRef.current = true;
      setLoaded(true);
      const display = await native.toDisplayableHtml(entry.id, entry.content);
      if (cancelled) {
        return;
      }
      contentRef.current = display;
      pendingContentRef.current = display;
      hydratedRef.current = true;
      lastSavedRef.current = {
        title: entry.title,
        content: display,
        weather: normalizeWeather(entry.weather),
        mood: normalizeMood(entry.mood),
        category: normalizeCategory(entry.category),
        visibility: entry.visibility === 'private' ? 'private' : 'pair',
      };
      // 页面可能早已 ready：这时上面的 effect 已经跑过，需要主动推一次。
      if (pageReadyRef.current) {
        flushPending();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entryId, flushPending]);

  // Content loaded after the page became ready still needs an explicit push.
  useEffect(() => {
    if (loaded && pageReadyRef.current) {
      flushPending();
    }
  }, [loaded, flushPending]);

  // Keep a short safety net: the editor usually posts `content`/`painted`,
  // this covers an empty/new page or a slow device. 250ms keeps the fade-in
  // inside the 0.5s cold-start budget instead of the old 700ms blanket wait.
  useEffect(() => {
    if (!loaded || !pageReady) {
      return;
    }
    const timer = setTimeout(() => setContentDrawn(true), 250);
    return () => clearTimeout(timer);
  }, [loaded, pageReady]);

  // WebView 淡入：只动 opacity（≤150ms），骨架先垫在下面，避免白屏闪烁。
  useEffect(() => {
    if (!contentDrawn) {
      return;
    }
    const animation = Animated.timing(webOpacity, {
      toValue: 1,
      duration: WEBVIEW_FADE_MS,
      useNativeDriver: true,
    });
    animation.start(({finished}) => {
      if (finished) {
        setSkeletonGone(true);
      }
    });
    // Hard fallback: some devices drop the completion callback when the
    // animation is pre-empted (e.g. a second timing starts during a re-render),
    // which would leave the skeleton spinner on screen forever.
    const fallback = setTimeout(() => setSkeletonGone(true), WEBVIEW_FADE_MS + 300);
    return () => {
      animation.stop();
      clearTimeout(fallback);
    };
  }, [contentDrawn, webOpacity]);

  /* ---------------------------------------------------------------- */
  /* Save                                                             */
  /* ---------------------------------------------------------------- */

  const protectedContent = useCallback(() => {
    if (lastSavedRef.current) {
      return lastSavedRef.current.content;
    }
    return '';
  }, []);

  const wouldEmptyOverwrite = useCallback(
    (content: string) => {
      if (!isBlankEditorHtml(content)) {
        return false;
      }
      return !isBlankEditorHtml(protectedContent());
    },
    [protectedContent],
  );

  const hasMeaningfulChanges = useCallback(
    (draft: JournalEntry) => {
      if (!isBlankEditorHtml(contentRef.current)) {
        return true;
      }
      if (draft.title !== defaultEntryTitle()) {
        return true;
      }
      return (
        weatherRef.current !== 'SUNNY' ||
        moodRef.current !== 'HAPPY' ||
        categoryRef.current !== 'DAILY'
      );
    },
    [],
  );

  const doSave = useCallback(
    async (options: {
      allowEmpty?: boolean;
      content?: string;
    }): Promise<boolean> => {
      if (readOnlyRef.current) {
        return true;
      }
      if (savingRef.current || !loadedRef.current) {
        return true;
      }
      const entry = entryRef.current;
      if (!entry) {
        return true;
      }
      const content = options.content ?? contentRef.current;
      const allowEmpty = options.allowEmpty === true;
      if (!allowEmpty && wouldEmptyOverwrite(content)) {
        return true;
      }
      if (!persistedRef.current && !hasMeaningfulChanges(entry)) {
        return true;
      }
      const snapshot: Snapshot = {
        title: titleRef.current.trim() || '未命名日记',
        content,
        weather: weatherRef.current,
        mood: moodRef.current,
        category: categoryRef.current,
        visibility: visibilityRef.current,
      };
      const previous = lastSavedRef.current;
      if (
        previous &&
        previous.title === snapshot.title &&
        previous.content === snapshot.content &&
        previous.weather === snapshot.weather &&
        previous.mood === snapshot.mood &&
        previous.category === snapshot.category &&
        previous.visibility === snapshot.visibility
      ) {
        return true;
      }

      savingRef.current = true;
      try {
        const stored = await native.toStoredHtml(
          entry.id,
          stripEditorState(content),
        );
        const now = Date.now();
        const saved: JournalEntry = {
          ...entry,
          title: snapshot.title,
          content: stored.html,
          weather: snapshot.weather,
          mood: snapshot.mood,
          category: snapshot.category,
          visibility: snapshot.visibility,
          updatedAt: now,
        };
        await saveEntry(saved);
        entryRef.current = saved;
        persistedRef.current = true;
        lastSavedRef.current = snapshot;
        return true;
      } catch (error) {
        console.warn('Editor save failed', error);
        return false;
      } finally {
        savingRef.current = false;
      }
    },
    [hasMeaningfulChanges, wouldEmptyOverwrite],
  );

  const scheduleSave = useCallback(() => {
    if (readOnlyRef.current) {
      // 只读页不写盘：连「清理旧标记」的重写也在加载阶段跳过了。
      return;
    }
    if (!loadedRef.current || !hydratedRef.current) {
      return;
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      doSave({allowEmpty: false});
    }, AUTO_SAVE_DELAY);
  }, [doSave]);

  const saveAndExit = useCallback(async () => {
    if (readOnlyRef.current) {
      // 只读浏览不碰磁盘，也不弹「正文为空」对话框。
      onBack();
      return;
    }
    if (savingRef.current || emptyDialog.visible) {
      return;
    }
    let content = contentRef.current;
    const fetched = await call('getContent');
    if (typeof fetched === 'string' && fetched.length > 0) {
      content = fetched;
    }
    if (wouldEmptyOverwrite(content)) {
      setEmptyDialog({visible: true, content});
      return;
    }
    const ok = await doSave({allowEmpty: false, content});
    if (ok) {
      onBack();
    } else {
      showToast('保存失败，请检查存储空间后重试');
    }
  }, [call, doSave, emptyDialog.visible, onBack, wouldEmptyOverwrite]);

  const restoreProtectedAndExit = useCallback(async () => {
    const protectedHtml = protectedContent();
    const entry = entryRef.current;
    if (entry && protectedHtml) {
      try {
        const stored = await native.toStoredHtml(
          entry.id,
          stripEditorState(protectedHtml),
        );
        await saveEntry({...entry, content: stored.html, updatedAt: Date.now()});
        entryRef.current = {...entry, content: stored.html, updatedAt: Date.now()};
      } catch {
        showToast('恢复手账失败，请重试');
        return;
      }
    }
    onBack();
  }, [onBack, protectedContent]);

  /* ---------------------------------------------------------------- */
  /* Message handling                                                 */
  /* ---------------------------------------------------------------- */

  const handleMessage = useCallback(
    (event: any) => {
      let data: any;
      try {
        data = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      switch (data.type) {
        case 'ready':
          pageReadyRef.current = true;
          setPageReady(true);
          flushPending();
          break;
        case 'content':
          contentRef.current = String(data.html ?? '');
          setContentDrawn(true);
          scheduleSave();
          break;
        case 'painted':
          // The page finished its first paint; drop the veil right away.
          setContentDrawn(true);
          break;
        case 'boot': {
          // 冷启动指标（见 editor.js 顶部注释）：debug 包无 Metro 也能看。
          // adb logcat -s ReactNativeJS:V | grep "\[editor-boot\]"
          const sinceMount = Date.now() - mountAtRef.current;
          console.log(
            `[editor-boot] page ms=${data.ms} navMs=${data.navMs} paintMs=${data.paintMs ?? '-'} sinceMount=${sinceMount}`,
          );
          break;
        }
        case 'boot-content':
          console.log(
            `[editor-boot] content ms=${data.ms} navMs=${data.navMs}`,
          );
          break;
        case 'imageClick':
          if (data.src) {
            setPreviewSrc(String(data.src));
          }
          break;
        case 'reply': {
          const finish = repliesRef.current.get(String(data.id));
          if (finish) {
            finish(typeof data.value === 'string' ? data.value : undefined);
          }
          break;
        }
        case 'doodleState':
        case 'stickerGesture':
          break;
        case 'requestImageInsert':
          pickPhoto();
          break;
        case 'error':
          console.warn('Editor bridge error:', data.message);
          break;
        default:
          break;
      }
    },
    // pickPhoto is declared below; the shim will resolve it at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flushPending, scheduleSave],
  );

  /* ---------------------------------------------------------------- */
  /* Media actions                                                    */
  /* ---------------------------------------------------------------- */

  const refreshStickers = useCallback(async () => {
    setStickersLoading(true);
    try {
      const list = await native.listStickers();
      setStickers(list);
    } catch {
      setStickers([]);
    } finally {
      setStickersLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshStickers();
  }, [refreshStickers]);

  const pickPhoto = useCallback(async () => {
    try {
      const picked = await native.pickImage(1500000, false);
      invoke('insertImage', picked.dataUri);
    } catch (error: any) {
      const message = String(error?.message ?? '');
      if (!/cancel/i.test(message)) {
        showToast('图片插入失败，请重试');
      }
    }
  }, [invoke]);

  const importSticker = useCallback(async () => {
    try {
      const picked = await native.pickImage(256 * 1024, true);
      invoke('insertCustomSticker', picked.dataUri);
      refreshStickers();
    } catch (error: any) {
      const message = String(error?.message ?? '');
      if (!/cancel/i.test(message)) {
        showToast('图片插入失败，请重试');
      }
    }
  }, [invoke, refreshStickers]);

  const insertLibrarySticker = useCallback(
    async (sticker: StickerFile) => {
      try {
        const base64 = await native.stickerBase64(sticker.fileName);
        invoke(
          'insertCustomSticker',
          `data:${sticker.mime};base64,${base64}`,
        );
      } catch {
        showToast('图片插入失败，请重试');
      }
    },
    [invoke],
  );

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                        */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!loaded) {
      return;
    }
    scheduleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, weather, mood, category, loaded]);

  useEffect(() => {
    if (!pageReadyRef.current) {
      return;
    }
    applyTheme();
  }, [applyTheme, colors, isDark, settings.fontSize]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (readOnlyRef.current) {
        onBackRef.current();
        return true;
      }
      saveAndExit();
      return true;
    });
    return () => sub.remove();
  }, [saveAndExit]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'background' && !readOnlyRef.current) {
        doSave({allowEmpty: false});
      }
    });
    return () => sub.remove();
  }, [doSave]);

  useEffect(() => {
    const replies = repliesRef.current;
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      replies.forEach(finish => finish(undefined));
      replies.clear();
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /* Toolbar commands                                                 */
  /* ---------------------------------------------------------------- */

  const selectBrush = (next: string) => {
    const spec = BRUSHES.find(item => item.key === next) ?? BRUSHES[0];
    let size = brushSize;
    if (size < spec.min || size > spec.max) {
      size = spec.initial;
    }
    setBrush(next);
    setBrushSize(size);
    invoke('setBrush', next);
    invoke('setBrushSize', formatBrushSize(size));
    invoke('setBrushColor', doodleColor);
  };

  const toggleToolbar = (next: Exclude<Toolbar, 'none'>) => {
    if (readOnlyRef.current) {
      return;
    }
    const active = toolbar === next ? 'none' : next;
    setToolbar(active);
    invoke('toggleDoodleMode', active === 'doodle');
    setMetaMenuOpen(false);
  };

  const selectWeather = (value: Weather) => {
    setWeather(value);
    setWeatherSheet(false);
    setToolbar('none');
    invoke('toggleDoodleMode', false);
  };

  const selectMood = (value: Mood) => {
    setMood(value);
    setMoodSheet(false);
    setToolbar('none');
    invoke('toggleDoodleMode', false);
  };

  const selectCategory = (value: Category) => {
    setCategory(value);
    setCategorySheet(false);
    setToolbar('none');
    invoke('toggleDoodleMode', false);
  };

  // 冷启动首屏骨架：getEntry() 虽然是本地读，但先把页面结构画出来，
  // 不必等 WebView 启动。整个骨架只做布局、不做动画，保证首帧开销最小。
  if (!loaded) {
    const bone = withAlpha(colors.onSurfaceVariant, 0.16);
    const boneSoft = withAlpha(colors.onSurfaceVariant, 0.1);
    return (
      <View style={[styles.root, {backgroundColor: colors.background}]}>
        <View style={[styles.bootBar, {paddingTop: insets.top}]}>
          <View style={[styles.bootLine, {width: 26, height: 26, borderRadius: 13, backgroundColor: boneSoft}]} />
          <View style={[styles.bootLine, {flex: 1, height: 18, marginHorizontal: 12, backgroundColor: bone}]} />
          <View style={[styles.bootLine, {width: 42, height: 22, backgroundColor: boneSoft}]} />
        </View>
        <View style={styles.bootBody}>
          <View style={[styles.bootLine, {width: '58%', height: 24, marginBottom: 10, backgroundColor: bone}]} />
          <View style={[styles.bootLine, {width: '32%', height: 12, marginBottom: 22, backgroundColor: boneSoft}]} />
          {[0.94, 0.88, 0.91, 0.72, 0.9, 0.64].map((w, index) => (
            <View
              key={index}
              style={[
                styles.bootLine,
                {
                  width: `${Math.round(w * 100)}%`,
                  height: 14,
                  marginBottom: 12,
                  backgroundColor: boneSoft,
                },
              ]}
            />
          ))}
        </View>
      </View>
    );
  }

  const bottomBarHeight = 62 + insets.bottom;

  return (
    <View style={styles.root}>
      <GlassSurface
        radius={0}
        elevation={0}
        style={{
          borderTopWidth: 0,
          borderLeftWidth: 0,
          borderRightWidth: 0,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: surfaces.shadowSoft,
        }}>
        <View style={[styles.topBar, {paddingTop: insets.top}]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={readOnly ? '返回' : '返回并保存'}
            focusable={false}
            hitSlop={8}
            onPress={readOnly ? onBack : saveAndExit}
            style={styles.topIcon}>
            <GlassIcon name="back" size={24} />
          </Pressable>
          {readOnly ? (
            <Text
              numberOfLines={1}
              style={[
                styles.titleInput,
                styles.readOnlyTitle,
                {
                  color: colors.onSurface,
                  fontSize: tokens.isCompact ? 16 : 18,
                },
              ]}>
              {title || '手账'}
            </Text>
          ) : (
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="标题"
              placeholderTextColor={withAlpha(colors.onSurfaceVariant, 0.68)}
              numberOfLines={1}
              maxLength={500}
              style={[
                styles.titleInput,
                {
                  color: colors.onSurface,
                  fontSize: tokens.isCompact ? 16 : 18,
                },
              ]}
            />
          )}
          {readOnly ? (
            <View
              accessibilityRole="text"
              accessibilityLabel="只读模式"
              style={styles.readOnlyBadge}>
              <Text
                style={{
                  fontSize: 11,
                  color: withAlpha(colors.onSurfaceVariant, 0.9),
                }}>
                只读
              </Text>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="日记信息"
              focusable={false}
              hitSlop={8}
              onPress={() => {
                setMetaMenuOpen(true);
                setToolbar('none');
                invoke('toggleDoodleMode', false);
              }}
              style={styles.metaButton}>
              <GlassIcon name="info" size={22} />
            </Pressable>
          )}
        </View>
      </GlassSurface>

      <View style={styles.content}>
        <Animated.View
          pointerEvents={contentDrawn ? 'auto' : 'none'}
          style={[styles.webviewWrap, {opacity: webOpacity}]}>
          <WebView
            ref={webRef}
            source={{uri: readOnly ? EDITOR_READONLY_URL : EDITOR_URL}}
            originWhitelist={['file://*', 'about:blank']}
            allowFileAccess
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            javaScriptEnabled
            domStorageEnabled
            cacheEnabled
            mixedContentMode="never"
            setSupportMultipleWindows={false}
            javaScriptCanOpenWindowsAutomatically={false}
            androidLayerType="hardware"
            style={styles.webview}
            injectedJavaScriptBeforeContentLoaded={BRIDGE_SHIM}
            // ?view=1 is the primary switch; this injected call is the belt-and-
            // braces fallback for a cold WebView that somehow lost the query.
            injectedJavaScript={
              readOnly
                ? 'try { window.setReadOnly && window.setReadOnly(true); } catch (e) {} true;'
                : undefined
            }
            onRenderProcessGone={() => {
              if (crashReloadsRef.current < 1) {
                crashReloadsRef.current += 1;
                setLoaded(false);
                setPageReady(false);
                pageReadyRef.current = false;
                webRef.current?.reload?.();
                return;
              }
              setSkeletonGone(true);
              setContentDrawn(true);
              showToast('这篇日记的图片太大，先把纯文本显示出来');
            }}
            onMessage={handleMessage}
            onLoadEnd={() => {
              // The injected shim posts `ready` on window load; this is only a
              // late fallback for the rare case where the injection landed after
              // the load event. Never flush content from here directly: the
              // editor's JS may not be initialised yet and the call would be lost.
              setTimeout(() => {
                if (!pageReadyRef.current) {
                  pageReadyRef.current = true;
                  setPageReady(true);
                  flushPending();
                }
              }, 800);
            }}
            onShouldStartLoadWithRequest={(request: any) =>
              request.url.startsWith('file:///android_asset/editor/') ||
              request.url === 'about:blank'
            }
          />
        </Animated.View>

        {/*
          冷启动骨架（需求 2）：纯文本首屏直接来自本地 store，先于 WebView
          的 4 个脚本解析完成。WebView 在下面以 opacity 0→1 淡入（120ms），
          它真正画好（painted / 250ms 兜底）之后骨架才移除。
          测量：adb logcat -s ReactNativeJS:V | grep "[editor-boot]"
        */}
        {!skeletonGone ? (
          <View
            pointerEvents="none"
            style={[styles.skeleton, {backgroundColor: colors.background}]}>
            <Text
              numberOfLines={1}
              style={[styles.skeletonTitle, {color: colors.onSurface}]}>
              {title || '未命名手账'}
            </Text>
            <Text
              style={[
                styles.skeletonDate,
                {color: withAlpha(colors.onSurfaceVariant, 0.78)},
              ]}>
              {firstScreenDate}
            </Text>
            <Text
              numberOfLines={16}
              style={[
                styles.skeletonBody,
                {color: withAlpha(colors.onSurface, 0.72)},
              ]}>
              {firstScreenText || ' '}
            </Text>
          </View>
        ) : null}

        {!readOnly && toolbar !== 'none' ? (
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: Z.dock,
            }}>
            {toolbar === 'text' ? (
              <TextToolbar
                colors={colors}
                fonts={fonts}
                onFont={value => {
                  setFonts(prev => ({...prev, family: value}));
                  invoke('changeFont', value);
                }}
                onSize={value => {
                  setFonts(prev => ({...prev, size: value}));
                  invoke('changeSize', value);
                }}
                onColor={value => invoke('changeColor', value)}
                onCmd={cmd => invoke('execCmd', cmd)}
              />
            ) : null}
            {toolbar === 'doodle' ? (
              <DoodleToolbar
                colors={colors}
                brush={brush}
                brushSize={brushSize}
                brushSpec={brushSpec}
                onBrush={selectBrush}
                onSize={value => {
                  setBrushSize(value);
                  invoke('setBrushSize', formatBrushSize(value));
                }}
                onColor={value => {
                  setDoodleColor(value);
                  invoke('setBrushColor', value);
                }}
                onCmd={cmd => invoke(cmd)}
                onExport={() => {
                  invoke('insertDoodleImage');
                  showToast('已将涂鸦导出为图片插入正文');
                }}
                onDone={() => {
                  invoke('mergeDoodle');
                  setToolbar('none');
                  invoke('toggleDoodleMode', false);
                }}
              />
            ) : null}
            {toolbar === 'sticker' ? (
              <StickerPanel
                colors={colors}
                tokens={tokens}
                stickers={stickers}
                loading={stickersLoading}
                onImport={importSticker}
                onPick={insertLibrarySticker}
                onLongPress={setDeleteStickerTarget}
                onEmoji={key => invoke('insertSticker', key)}
                onDone={() => setToolbar('none')}
              />
            ) : null}
          </View>
        ) : null}
      </View>

      {/* 只读模式不渲染底部工具条与保存入口（需求 1）。 */}
      {readOnly ? null : (
      <GlassSurface
        radius={0}
        elevation={8}
        style={{
          borderLeftWidth: 0,
          borderRightWidth: 0,
          borderBottomWidth: 0,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: surfaces.shadowSoft,
        }}>
        <View
          style={[
            styles.bottomBar,
            {
              paddingBottom: insets.bottom,
              height: bottomBarHeight,
            },
          ]}>
          <ToolbarTab
            label="文字"
            icon="text"
            active={toolbar === 'text'}
            colors={colors}
            onPress={() => toggleToolbar('text')}
          />
          <ToolbarTab
            label="涂鸦"
            icon="doodle"
            active={toolbar === 'doodle'}
            colors={colors}
            onPress={() => toggleToolbar('doodle')}
          />
          <ToolbarTab
            label="照片"
            icon="photo"
            active={false}
            colors={colors}
            onPress={pickPhoto}
          />
          <ToolbarTab
            label="贴纸"
            icon="sticker"
            active={toolbar === 'sticker'}
            colors={colors}
            onPress={() => toggleToolbar('sticker')}
          />
        </View>
      </GlassSurface>
      )}

      {/* Meta menu */}
      <Modal
        visible={metaMenuOpen && !readOnly}
        transparent
        animationType="fade"
        onRequestClose={() => setMetaMenuOpen(false)}>
        <Pressable
          style={styles.menuScrim}
          onPress={() => setMetaMenuOpen(false)}>
          <GlassSurface strong radius={18} elevation={16} style={styles.menuCard}>
            <MenuItem
              icon={weatherIcon(weather)}
              label={`天气：${WEATHER_LABEL[weather]}`}
              color={colors.onSurface}
              iconColor={colors.primary}
              onPress={() => {
                setMetaMenuOpen(false);
                setWeatherSheet(true);
              }}
            />
            <MenuItem
              icon={moodIcon(mood)}
              label={`心情：${MOOD_LABEL[mood]}`}
              color={colors.onSurface}
              iconColor={colors.primary}
              onPress={() => {
                setMetaMenuOpen(false);
                setMoodSheet(true);
              }}
            />
            <MenuItem
              icon="category"
              label="分类"
              color={colors.onSurface}
              iconColor={colors.primary}
              onPress={() => {
                setMetaMenuOpen(false);
                setCategorySheet(true);
              }}
            />
            <MenuItem
              icon={visibility === 'private' ? 'info' : 'text'}
              label={visibility === 'private' ? '仅自己可见' : '共享给 TA'}
              color={colors.onSurface}
              iconColor={colors.primary}
              onPress={() => {
                const next = visibility === 'private' ? 'pair' : 'private';
                setVisibility(next);
                visibilityRef.current = next;
                setMetaMenuOpen(false);
                showToast(
                  next === 'private'
                    ? '这篇只留在本机，不会再同步给对方'
                    : '这篇会同步给 TA',
                );
              }}
            />
          </GlassSurface>
        </Pressable>
      </Modal>

      <AppSheet
        visible={weatherSheet && !readOnly}
        title="选择天气"
        onClose={() => setWeatherSheet(false)}>
        <ChipFlow>
          {SELECTABLE_WEATHER.map(value => (
            <ChoiceChip
              key={value}
              icon={weatherIcon(value)}
              label={WEATHER_LABEL[value]}
              selected={weather === value}
              colors={colors}
              onPress={() => selectWeather(value)}
            />
          ))}
        </ChipFlow>
      </AppSheet>

      <AppSheet
        visible={moodSheet && !readOnly}
        title="记录此刻心情"
        onClose={() => setMoodSheet(false)}>
        <ChipFlow>
          {SELECTABLE_MOOD.map(value => (
            <ChoiceChip
              key={value}
              icon={moodIcon(value)}
              label={MOOD_LABEL[value]}
              selected={mood === value}
              colors={colors}
              onPress={() => selectMood(value)}
            />
          ))}
        </ChipFlow>
      </AppSheet>

      <AppSheet
        visible={categorySheet && !readOnly}
        title="日记分类"
        onClose={() => setCategorySheet(false)}>
        <ChipFlow>
          {SELECTABLE_CATEGORY.map(value => (
            <ChoiceChip
              key={value}
              label={CATEGORY_LABEL[value]}
              selected={category === value}
              colors={colors}
              onPress={() => selectCategory(value)}
            />
          ))}
        </ChipFlow>
      </AppSheet>

      <ImageViewer
        visible={previewSrc !== null}
        uri={previewSrc}
        onClose={() => setPreviewSrc(null)}
      />

      <AppDialog
        visible={emptyDialog.visible}
        title="即将覆盖为空内容"
        message="检测到整篇手账即将被覆盖为空内容，如果您没有这么做，很抱歉应用可能在保存手账时出现了问题。如果点按继续保存按钮，手账将会被空内容覆盖。点按取消按钮，则应用将保护本手账条目内容，不保存即退出。如果清空手账不是您的意图，请点击“取消”。"
        confirmLabel="继续保存"
        destructive
        onConfirm={async () => {
          const content = emptyDialog.content;
          setEmptyDialog({visible: false, content: ''});
          const ok = await doSave({allowEmpty: true, content});
          if (ok) {
            onBack();
          } else {
            showToast('保存失败，请检查存储空间后重试');
          }
        }}
        dismissLabel="取消"
        onDismiss={() => {
          setEmptyDialog({visible: false, content: ''});
          restoreProtectedAndExit();
        }}
      />

      <AppDialog
        visible={deleteStickerTarget !== null}
        title="删除已导入贴纸"
        message="仅从贴纸库移除，不会删除日记里已经贴上的贴纸。"
        confirmLabel="删除"
        destructive
        onConfirm={() => {
          const target = deleteStickerTarget;
          setDeleteStickerTarget(null);
          if (target) {
            native
              .deleteSticker(target.fileName)
              .catch(() => false)
              .then(refreshStickers);
          }
        }}
        dismissLabel="取消"
        onDismiss={() => setDeleteStickerTarget(null)}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Toolbar sub-components                                              */
/* ------------------------------------------------------------------ */

function ToolbarTab({
  label,
  icon,
  active,
  colors,
  onPress,
}: {
  label: string;
  icon: GlassIconName;
  active: boolean;
  colors: {primary: string; onSurfaceVariant: string};
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{selected: active}}
      onPress={onPress}
      style={styles.toolbarTab}>
      <View
        style={[
          styles.toolbarPill,
          active && {backgroundColor: colors.primary},
        ]}>
        <GlassIcon
          name={icon}
          size={22}
          tone={active ? 'onAccent' : 'auto'}
        />
      </View>
      <Text
        style={{
          fontSize: 10,
          fontWeight: '600',
          color: active ? colors.primary : colors.onSurfaceVariant,
        }}>
        {label}
      </Text>
    </Pressable>
  );
}

function TextToolbar({
  colors,
  fonts,
  onFont,
  onSize,
  onColor,
  onCmd,
}: {
  colors: any;
  fonts: {family: string; size: string};
  onFont: (value: string) => void;
  onSize: (value: string) => void;
  onColor: (value: string) => void;
  onCmd: (cmd: string) => void;
}) {
  return (
    <GlassSurface strong radius={20} elevation={14} style={styles.panel}>
      <View style={styles.panelRow}>
        {[
          {label: 'B', cmd: 'bold', weight: '700'},
          {label: 'I', cmd: 'italic', style: 'italic'},
          {label: 'U', cmd: 'underline', underline: true},
          {label: 'S', cmd: 'strikeThrough', strike: true},
        ].map(item => (
          <Pressable
            key={item.cmd}
            accessibilityRole="button"
            accessibilityLabel={
              item.cmd === 'bold'
                ? '粗体'
                : item.cmd === 'italic'
                ? '斜体'
                : item.cmd === 'underline'
                ? '下划线'
                : '删除线'
            }
            onPress={() => onCmd(item.cmd)}
            style={({pressed}) => [
              styles.formatButton,
              {
                borderColor: withAlpha(colors.outline, 0.4),
                backgroundColor: pressed ? withAlpha(colors.primary, 0.1) : 'transparent',
              },
            ]}>
            <Text
              style={{
                fontSize: 16,
                color: colors.onSurface,
                fontWeight: item.weight as any,
                fontStyle: item.style as any,
                textDecorationLine: item.underline
                  ? 'underline'
                  : item.strike
                  ? 'line-through'
                  : 'none',
              }}>
              {item.label}
            </Text>
          </Pressable>
        ))}
        <View style={styles.panelGap} />
        {[
          {label: '左', cmd: 'justifyLeft', a11y: '左对齐'},
          {label: '中', cmd: 'justifyCenter', a11y: '居中对齐'},
          {label: '右', cmd: 'justifyRight', a11y: '右对齐'},
        ].map(item => (
          <Pressable
            key={item.cmd}
            accessibilityRole="button"
            accessibilityLabel={item.a11y}
            onPress={() => onCmd(item.cmd)}
            style={styles.smallIconButton}>
            <Text style={{fontSize: 14, color: colors.onSurfaceVariant}}>
              {item.label}
            </Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="撤销"
          onPress={() => onCmd('undo')}
          style={styles.smallIconButton}>
          <GlassIcon name="undo" size={19} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重做"
          onPress={() => onCmd('redo')}
          style={styles.smallIconButton}>
          <GlassIcon name="redo" size={19} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={[styles.panelRow, {paddingVertical: 6}]}>
          {FONT_CHIPS.map(chip => (
            <ChoiceChip
              key={chip.value}
              label={chip.label}
              small
              selected={fonts.family === chip.value}
              colors={colors}
              onPress={() => onFont(chip.value)}
            />
          ))}
          <View style={styles.panelGap} />
          {SIZE_CHIPS.map(chip => (
            <ChoiceChip
              key={chip.value}
              label={chip.label}
              small
              selected={fonts.size === chip.value}
              colors={colors}
              onPress={() => onSize(chip.value)}
            />
          ))}
        </View>
      </ScrollView>
      <View style={[styles.panelRow, {flexWrap: 'wrap', paddingVertical: 4}]}>
        {TEXT_COLORS.map(color => (
          <Pressable
            key={color}
            accessibilityLabel={`文字颜色 ${color}`}
            onPress={() => onColor(color)}
            style={[
              styles.colorDot,
              {
                backgroundColor: color,
                borderColor: withAlpha(colors.outline, 0.4),
              },
            ]}
          />
        ))}
      </View>
    </GlassSurface>
  );
}

function DoodleToolbar({
  colors,
  brush,
  brushSize,
  brushSpec,
  onBrush,
  onSize,
  onColor,
  onCmd,
  onExport,
  onDone,
}: {
  colors: any;
  brush: string;
  brushSize: number;
  brushSpec: {min: number; max: number};
  onBrush: (value: string) => void;
  onSize: (value: number) => void;
  onColor: (value: string) => void;
  onCmd: (cmd: string) => void;
  onExport: () => void;
  onDone: () => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const ratio =
    brushSpec.max > brushSpec.min
      ? (brushSize - brushSpec.min) / (brushSpec.max - brushSpec.min)
      : 0;

  const update = (x: number) => {
    if (trackWidth <= 0) {
      return;
    }
    const clamped = Math.max(0, Math.min(1, x / trackWidth));
    const value = brushSpec.min + (brushSpec.max - brushSpec.min) * clamped;
    onSize(Math.round(value * 10) / 10);
  };

  return (
    <GlassSurface strong radius={20} elevation={14} style={styles.panel}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={[styles.panelRow, {paddingVertical: 4}]}>
          {BRUSHES.map(item => (
            <ChoiceChip
              key={item.key}
              label={item.label}
              small
              selected={brush === item.key}
              colors={colors}
              onPress={() => onBrush(item.key)}
            />
          ))}
        </View>
      </ScrollView>
      <View style={[styles.panelRow, {paddingVertical: 2}]}>
        <Text style={{fontSize: 12, color: colors.onSurfaceVariant}}>粗细</Text>
        <View
          style={styles.slider}
          onLayout={event => setTrackWidth(event.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={event =>
            update(event.nativeEvent.locationX)
          }
          onResponderMove={event => update(event.nativeEvent.locationX)}>
          <View
            style={[
              styles.sliderTrack,
              {backgroundColor: withAlpha(colors.outline, 0.3)},
            ]}
          />
          <View
            style={[
              styles.sliderFill,
              {
                width: `${Math.max(0, Math.min(1, ratio)) * 100}%`,
                backgroundColor: colors.primary,
              },
            ]}
          />
          <View
            style={[
              styles.sliderThumb,
              {
                left: `${Math.max(0, Math.min(1, ratio)) * 100}%`,
                backgroundColor: colors.primary,
              },
            ]}
          />
        </View>
        <Text style={styles.sliderReadout}>
          {formatBrushSize(brushSize)}
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={[styles.panelRow, {paddingVertical: 4}]}>
          {DOODLE_COLORS.map(color => (
            <Pressable
              key={color}
              accessibilityLabel={`画笔颜色 ${color}`}
              onPress={() => onColor(color)}
              style={[
                styles.colorDot,
                {
                  backgroundColor: color,
                  borderColor:
                    color === '#FFFFFF'
                      ? colors.surfaceVariant
                      : withAlpha(colors.outline, 0.4),
                  borderWidth: color === '#FFFFFF' ? 1 : StyleSheet.hairlineWidth,
                },
              ]}
            />
          ))}
        </View>
      </ScrollView>
      <View style={[styles.panelRow, {gap: 8, paddingVertical: 6}]}>
        {[
          {label: '撤销', cmd: 'undoDoodle'},
          {label: '重做', cmd: 'redoDoodle'},
          {label: '清除', cmd: 'clearDoodle'},
        ].map(item => (
          <Pressable
            key={item.cmd}
            onPress={() => onCmd(item.cmd)}
            style={({pressed}) => [
              styles.smallButton,
              {
                borderColor: withAlpha(colors.outline, 0.4),
                backgroundColor: pressed
                  ? withAlpha(colors.primary, 0.1)
                  : 'transparent',
              },
            ]}>
            <Text style={{fontSize: 12, color: colors.onSurface}}>
              {item.label}
            </Text>
          </Pressable>
        ))}
        <View style={{flex: 1}} />
      </View>
      <View style={[styles.panelRow, {gap: 8, paddingVertical: 6}]}>
        <Pressable
          onPress={onExport}
          style={({pressed}) => [
            styles.smallButton,
            {
              borderColor: withAlpha(colors.outline, 0.4),
              backgroundColor: pressed
                ? withAlpha(colors.primary, 0.1)
                : 'transparent',
              flex: 1,
            },
          ]}>
          <Text style={{fontSize: 12, color: colors.onSurface}}>导出</Text>
        </Pressable>
        <FlatButton label="确认" onPress={onDone} style={{flex: 1}} />
      </View>
    </GlassSurface>
  );
}

function StickerPanel({
  colors,
  tokens,
  stickers,
  loading,
  onImport,
  onPick,
  onLongPress,
  onEmoji,
  onDone,
}: {
  colors: any;
  tokens: any;
  stickers: StickerFile[];
  loading: boolean;
  onImport: () => void;
  onPick: (sticker: StickerFile) => void;
  onLongPress: (sticker: StickerFile) => void;
  onEmoji: (key: string) => void;
  onDone: () => void;
}) {
  return (
    <GlassSurface strong radius={20} elevation={14} style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text style={[styles.panelTitle, {color: colors.onSurface}]}>
          选择贴纸
        </Text>
        <TextButton label="完成" onPress={onDone} />
      </View>
      <ScrollView style={{maxHeight: 360}} showsVerticalScrollIndicator={false}>
        <Pressable
          onPress={onImport}
          style={({pressed}) => [
            styles.importButton,
            {
              borderColor: withAlpha(colors.primary, 0.45),
              backgroundColor: pressed
                ? withAlpha(colors.primary, 0.08)
                : 'transparent',
            },
          ]}>
          <GlassIcon name="photo" size={18} />
          <Text style={{fontSize: 13, color: colors.primary, fontWeight: '600'}}>
            导入贴纸
          </Text>
        </Pressable>

        {stickers.length > 0 ? (
          <>
            <Text style={[styles.sectionLabel, {color: colors.onSurface}]}>
              已导入贴纸
            </Text>
            <Text
              style={[
                styles.sectionHint,
                {color: withAlpha(colors.onSurface, 0.55)},
              ]}>
              长按可从库中删除
            </Text>
            <View style={[styles.stickerGrid, {marginTop: 8}]}>
              {stickers.map(item => (
                <Pressable
                  key={item.id}
                  accessibilityLabel="已导入贴纸"
                  onPress={() => onPick(item)}
                  onLongPress={() => onLongPress(item)}
                  style={[
                    styles.stickerCell,
                    {
                      width: tokens.stickerCell,
                      height: tokens.stickerCell,
                      backgroundColor: withAlpha(colors.surfaceVariant, 0.35),
                    },
                  ]}>
                  <Image
                    source={{uri: `file://${item.path}`}}
                    style={{width: tokens.stickerCell - 12, height: tokens.stickerCell - 12}}
                    resizeMode="contain"
                  />
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
        {loading ? <ActivityIndicator color={colors.primary} /> : null}

        <Text style={[styles.sectionLabel, {color: colors.onSurface}]}>
          内置贴纸
        </Text>
        <View style={styles.stickerGrid}>
          {STICKERS.map(item => (
            <Pressable
              key={item.key}
              accessibilityLabel={item.key}
              onPress={() => onEmoji(item.key)}
              style={[
                styles.stickerCell,
                {
                  width: tokens.stickerCell,
                  height: tokens.stickerCell,
                  backgroundColor: withAlpha(colors.surfaceVariant, 0.35),
                },
              ]}>
              <Text style={{fontSize: tokens.stickerEmojiSize}}>
                {item.emoji}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </GlassSurface>
  );
}

function ChoiceChip({
  icon,
  label,
  selected,
  colors,
  onPress,
  small,
}: {
  icon?: GlassIconName;
  label: string;
  selected: boolean;
  colors: any;
  onPress: () => void;
  small?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected}}
      onPress={onPress}
      style={({pressed}) => [
        styles.chip,
        {
          borderColor: selected ? colors.primary : withAlpha(colors.outline, 0.4),
          backgroundColor: selected
            ? colors.primary
            : pressed
            ? withAlpha(colors.primary, 0.08)
            : 'transparent',
          paddingVertical: small ? 6 : 9,
          paddingHorizontal: small ? 10 : 13,
        },
      ]}>
      {icon ? (
        <GlassIcon
          name={icon}
          size={small ? 15 : 18}
          tone={selected ? 'onAccent' : 'auto'}
        />
      ) : null}
      <Text
        style={{
          fontSize: small ? 12 : 14,
          color: selected ? onAccentFor(colors.primary) : colors.onSurface,
          fontWeight: selected ? '700' : '400',
        }}>
        {label}
      </Text>
    </Pressable>
  );
}

function ChipFlow({children}: {children: React.ReactNode}) {
  return <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>{children}</View>;
}

function MenuItem({
  icon,
  label,
  color,
  onPress,
}: {
  icon: GlassIconName;
  label: string;
  color: string;
  iconColor: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({pressed}) => [
        styles.menuItem,
        pressed && {backgroundColor: 'rgba(0,0,0,0.04)'},
      ]}>
      <GlassIcon name={icon} size={20} />
      <Text style={{fontSize: 15, color}}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  loading: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  bootBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  bootBody: {flex: 1, paddingHorizontal: 18, paddingTop: 18},
  bootLine: {borderRadius: 6},
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: undefined,
    paddingBottom: 6,
    paddingHorizontal: 4,
  },
  topIcon: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center'},
  titleInput: {
    flex: 1,
    fontWeight: '700',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  metaButton: {
    flexDirection: 'row',
    gap: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  content: {flex: 1, position: 'relative'},
  webviewWrap: {flex: 1},
  webview: {flex: 1, backgroundColor: 'transparent'},
  // 冷启动骨架：与 WebView 同尺寸覆盖，WebView 淡入完成后整块移除。
  skeleton: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    paddingHorizontal: 18,
    paddingTop: 18,
    zIndex: Z.sticky,
  },
  skeletonTitle: {fontSize: 22, fontWeight: '700', marginBottom: 6},
  skeletonDate: {fontSize: 12, marginBottom: 16},
  skeletonBody: {fontSize: 15, lineHeight: 24},
  readOnlyTitle: {textAlign: 'left'},
  readOnlyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBar: {
    flexDirection: 'row',
    paddingTop: 8,
    paddingHorizontal: 10,
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.10)',
  },
  toolbarTab: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 2, gap: 2},
  toolbarPill: {
    width: 44,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    borderRadius: 20,
    padding: 12,
  },
  panelRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  panelGap: {width: 8},
  formatButton: {
    width: 38,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallIconButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    margin: 2,
  },
  slider: {flex: 1, height: 34, justifyContent: 'center', marginHorizontal: 8},
  sliderTrack: {height: 4, borderRadius: 2, width: '100%'},
  sliderFill: {position: 'absolute', height: 4, borderRadius: 2},
  sliderThumb: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    marginLeft: -8,
  },
  sliderReadout: {width: 34, textAlign: 'center', fontSize: 12},
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  panelTitle: {fontSize: 16, fontWeight: '700'},
  importButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    marginTop: 4,
  },
  sectionLabel: {fontSize: 13, fontWeight: '600', marginTop: 12, paddingHorizontal: 2},
  sectionHint: {fontSize: 11, marginTop: 2, paddingHorizontal: 2},
  stickerGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  stickerCell: {borderRadius: 12, alignItems: 'center', justifyContent: 'center'},
  smallButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  menuScrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 70,
    paddingRight: 12,
  },
  menuCard: {borderRadius: 16, paddingVertical: 6, minWidth: 190},
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  previewScrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  previewCard: {width: '100%', borderRadius: 18, overflow: 'hidden', paddingBottom: 4},
});
