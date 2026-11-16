import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
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
import {getEntry, saveEntry} from '../data/storage';
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
const AUTO_SAVE_DELAY = 350;
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
  {key: 'dog', emoji: '🐶'},
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
}: {
  entryId: string;
  settings: AppSettings;
  onBack: () => void;
}) {
  const {colors, surfaces, isDark, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const webRef = useRef<any>(null);
  const [loaded, setLoaded] = useState(false);
  const [pageReady, setPageReady] = useState(false);
  const [contentDrawn, setContentDrawn] = useState(false);
  const [title, setTitle] = useState('');
  const [weather, setWeather] = useState<Weather>('SUNNY');
  const [mood, setMood] = useState<Mood>('HAPPY');
  const [category, setCategory] = useState<Category>('DAILY');
  const [toolbar, setToolbar] = useState<Toolbar>('none');
  const [metaMenuOpen, setMetaMenuOpen] = useState(false);
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
        contentRef.current = '';
        pendingContentRef.current = '';
        loadedRef.current = true;
        setLoaded(true);
        return;
      }

      const entry = await getEntry(entryId);
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
        try {
          await saveEntry(entry);
        } catch {
          // Cleaning is best-effort; the editor still loads the content below.
        }
      }
      setTitle(entry.title);
      setWeather(normalizeWeather(entry.weather));
      setMood(normalizeMood(entry.mood));
      setCategory(normalizeCategory(entry.category));
      const display = await native.toDisplayableHtml(entry.id, entry.content);
      if (cancelled) {
        return;
      }
      contentRef.current = display;
      pendingContentRef.current = display;
      lastSavedRef.current = {
        title: entry.title,
        content: display,
        weather: normalizeWeather(entry.weather),
        mood: normalizeMood(entry.mood),
        category: normalizeCategory(entry.category),
      };
      loadedRef.current = true;
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [entryId]);

  // Content loaded after the page became ready still needs an explicit push.
  useEffect(() => {
    if (loaded && pageReadyRef.current) {
      flushPending();
    }
  }, [loaded, flushPending]);

  // Keep a calm veil over the blank WebView until its first paint is likely
  // done. The editor usually posts `content`; this is the safety net for an
  // empty/new page and slower devices.
  useEffect(() => {
    if (!loaded || !pageReady) {
      return;
    }
    const timer = setTimeout(() => setContentDrawn(true), 1200);
    return () => clearTimeout(timer);
  }, [loaded, pageReady]);

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
      };
      const previous = lastSavedRef.current;
      if (
        previous &&
        previous.title === snapshot.title &&
        previous.content === snapshot.content &&
        previous.weather === snapshot.weather &&
        previous.mood === snapshot.mood &&
        previous.category === snapshot.category
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
    if (!loadedRef.current) {
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
      saveAndExit();
      return true;
    });
    return () => sub.remove();
  }, [saveAndExit]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'background') {
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

  if (!loaded) {
    return (
      <View style={[styles.loading, {backgroundColor: colors.background}]}>
        <ActivityIndicator color={colors.primary} />
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
            accessibilityLabel="返回并保存"
            focusable={false}
            hitSlop={8}
            onPress={saveAndExit}
            style={styles.topIcon}>
            <GlassIcon name="back" size={24} />
          </Pressable>
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
        </View>
      </GlassSurface>

      <View style={styles.content}>
        <WebView
          ref={webRef}
          source={{uri: EDITOR_URL}}
          originWhitelist={['file://*', 'about:blank']}
          allowFileAccess
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          javaScriptEnabled
          domStorageEnabled
          cacheEnabled={false}
          mixedContentMode="never"
          setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically={false}
          androidLayerType="hardware"
          style={styles.webview}
          injectedJavaScriptBeforeContentLoaded={BRIDGE_SHIM}
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

        {!loaded || !pageReady || !contentDrawn ? (
          <View
            style={[
              styles.loadingOverlay,
              {backgroundColor: colors.background},
            ]}>
            <ActivityIndicator color={colors.primary} />
            <Text
              style={{
                marginTop: 10,
                fontSize: 13,
                color: colors.onSurfaceVariant,
              }}>
              正在打开手账…
            </Text>
          </View>
        ) : null}

        {toolbar !== 'none' ? (
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

      {/* Meta menu */}
      <Modal
        visible={metaMenuOpen}
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
          </GlassSurface>
        </Pressable>
      </Modal>

      <AppSheet
        visible={weatherSheet}
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
        visible={moodSheet}
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
        visible={categorySheet}
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

      <Modal
        visible={previewSrc !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewSrc(null)}>
        <View style={styles.previewScrim}>
          <GlassSurface strong radius={20} elevation={20} style={styles.previewCard}>
            {previewSrc ? (
              <Image
                source={{uri: previewSrc}}
                resizeMode="contain"
                style={{width: '100%', height: tokens.imagePreviewHeight}}
              />
            ) : null}
            <View style={{alignItems: 'flex-end'}}>
              <TextButton label="关闭" onPress={() => setPreviewSrc(null)} />
            </View>
          </GlassSurface>
        </View>
      </Modal>

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
  loadingOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: Z.sticky,
  },
  webview: {flex: 1, backgroundColor: 'transparent'},
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
