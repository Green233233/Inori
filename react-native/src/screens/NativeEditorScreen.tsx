/**
 * 原生日记编辑器（item 7）。
 *
 * 接管「文字 + 图片 + 涂鸦」的日记：段落、照片块、手绘涂鸦都在原生层编辑，
 * 序列化沿用 WebView 编辑器的 HTML（`<div>` 段落、`<img class="inserted-image">`、
 * `data-doodle-json` 隐藏节点），因此两套编辑器可以互相打开同一篇日记。
 *
 * 贴纸仍是 WebView 编辑器的能力：含贴纸的日记会引导到完整编辑器，避免保存时丢图。
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Image,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAppTheme} from '../theme/AppThemeProvider';
import {type} from '../theme/typography';
import {TextButton, FlatButton} from '../components/Ui';
import {TopBar} from '../components/TopBar';
import {showToast} from '../components/toast';
import {AppSettings, JournalEntry, defaultEntryTitle, todayIso} from '../data/types';
import {getEntry, saveEntry} from '../data/storage';
import {resolveMediaUri} from '../data/html';
import {native} from '../native/InorinalNative';
import {
  DocBlock,
  RichDoc,
  StickerInfo,
  buildStickerHtml,
  docPreview,
  emptyRichDoc,
  parseRichDoc,
  serializeRichDoc,
} from '../journal/richDoc';

const AUTO_SAVE_DELAY = 700;
const PHOTO_MAX_BYTES = 2_400_000;
const DOODLE_HEIGHT = 260;
const STICKER_SIZE = 72;
const IMAGE_STICKER_SIZE = 112;
const STICKER_PALETTE = ['❤️', '⭐', '😊', '🌸', '☀️', '🌙', '☁️', '❄️', '🍃', '🐱', '🐶', '🐦', '🐟'];
const STICKER_STAGE_HEIGHT = 220;
const STAGE_WIDTH = 320;

function makeId(): string {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${now}-${rand}`;
}

function makeBlock(kind: 'text' | 'image', value = ''): DocBlock {
  return kind === 'text'
    ? {kind: 'text', id: makeId(), text: value}
    : {kind: 'image', id: makeId(), uri: value};
}

function makeSticker(info: StickerInfo): {id: string; html: string; info: StickerInfo} {
  const id = makeId();
  return {id, html: buildStickerHtml(info, id), info};
}

export function NativeEditorScreen({
  entryId,
  settings,
  onBack,
}: {
  entryId: string;
  settings: AppSettings;
  onBack: () => void;
}) {
  const {colors, surfaces} = useAppTheme();
  const insets = useSafeAreaInsets();
  const entryRef = useRef<JournalEntry | null>(null);
  const draftRef = useRef(entryId === 'new');
  const [title, setTitle] = useState('');
  const [doc, setDoc] = useState<RichDoc>(() => emptyRichDoc());
  const [visibility, setVisibility] = useState<'private' | 'pair'>('pair');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

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
        if (cancelled) {
          return;
        }
        setTitle(draft.title);
        setDoc(emptyRichDoc());
        return;
      }
      const entry = await getEntry(entryId);
      if (cancelled) {
        return;
      }
      if (!entry) {
        showToast('该日记不存在或已被删除');
        onBack();
        return;
      }
      entryRef.current = entry;
      setTitle(entry.title);
      setVisibility(entry.visibility === 'private' ? 'private' : 'pair');
      setDoc(parseRichDoc(entry.content));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  const save = useCallback(
    async (nextTitle: string, nextDoc: RichDoc, nextVisibility: 'private' | 'pair') => {
      const entry = entryRef.current;
      if (!entry) {
        return;
      }
      const hasContent = nextDoc.blocks.some(block =>
        block.kind === 'text' ? block.text.trim() !== '' : Boolean(block.uri),
      );
      const hasDoodle = Boolean(nextDoc.doodle && nextDoc.doodle.strokes.length);
      const untouched =
        draftRef.current &&
        nextTitle.trim() === entry.title.trim() &&
        !hasContent &&
        !hasDoodle;
      if (untouched) {
        return;
      }
      setBusy(true);
      try {
        const raw = serializeRichDoc(nextDoc);
        const stored = await native.toStoredHtml(entry.id, raw).catch(() => null);
        const updated: JournalEntry = {
          ...entry,
          title: nextTitle.trim() || defaultEntryTitle(new Date()),
          content: stored?.html ?? raw,
          visibility: nextVisibility,
          updatedAt: Date.now(),
        };
        await saveEntry(updated);
        entryRef.current = updated;
        draftRef.current = false;
        setSavedAt(updated.updatedAt);
      } catch (error) {
        showToast(error instanceof Error ? error.message : '保存失败');
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!entryRef.current) {
      return;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      void save(title, doc, visibility);
    }, AUTO_SAVE_DELAY);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [title, doc, visibility, save]);

  const preview = useMemo(() => docPreview(doc), [doc]);

  const updateBlock = useCallback((id: string, value: string) => {
    setDoc(previous => ({
      ...previous,
      blocks: previous.blocks.map(block =>
        block.id === id ? ({...block, text: value} as DocBlock) : block,
      ),
    }));
  }, []);

  const removeBlock = useCallback((id: string) => {
    setDoc(previous => {
      const blocks = previous.blocks.filter(block => block.id !== id);
      return {...previous, blocks: blocks.length ? blocks : [makeBlock('text')]};
    });
  }, []);

  const addParagraph = useCallback(() => {
    setDoc(previous => ({...previous, blocks: [...previous.blocks, makeBlock('text')]}));
  }, []);

  const addPhoto = useCallback(async () => {
    try {
      const picked = await native.pickImage(PHOTO_MAX_BYTES, false);
      if (!picked?.dataUri) {
        return;
      }
      setDoc(previous => ({...previous, blocks: [...previous.blocks, makeBlock('image', picked.dataUri)]}));
    } catch (error) {
      showToast(error instanceof Error ? error.message : '选择照片失败');
    }
  }, []);

  const addEmojiSticker = useCallback((emoji: string) => {
    setDoc(previous => {
      const offset = previous.stickers.length * 14;
      return {
        ...previous,
        stickers: [
          ...previous.stickers,
          makeSticker({
            kind: 'emoji',
            value: emoji,
            left: 24 + offset,
            top: 24 + offset,
            size: STICKER_SIZE,
            rotate: 0,
          }),
        ],
      };
    });
  }, []);

  const addImageSticker = useCallback(async () => {
    try {
      const picked = await native.pickImage(PHOTO_MAX_BYTES, true);
      if (!picked?.dataUri) {
        return;
      }
      setDoc(previous => {
        const offset = previous.stickers.length * 14;
        return {
          ...previous,
          stickers: [
            ...previous.stickers,
            makeSticker({
              kind: 'image',
              value: picked.dataUri,
              left: 24 + offset,
              top: 24 + offset,
              size: IMAGE_STICKER_SIZE,
              rotate: 0,
            }),
          ],
        };
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : '选择贴纸失败');
    }
  }, []);

  const moveSticker = useCallback((id: string, left: number, top: number) => {
    setDoc(previous => ({
      ...previous,
      stickers: previous.stickers.map(sticker =>
        sticker.id === id && sticker.info
          ? {...sticker, info: {...sticker.info, left, top}}
          : sticker,
      ),
    }));
  }, []);

  const removeSticker = useCallback((id: string) => {
    setDoc(previous => ({
      ...previous,
      stickers: previous.stickers.filter(sticker => sticker.id !== id),
    }));
  }, []);

  const close = useCallback(async () => {
    await save(title, doc, visibility);
    onBack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, doc, visibility, save]);

  return (
    <KeyboardAvoidingView
      style={[styles.root, {backgroundColor: colors.background}]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TopBar
        title="日记"
        onBack={() => {
          void close();
        }}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="保存日记"
            onPress={() => {
              void save(title, doc, visibility);
            }}
            style={styles.saveSlot}>
            <Text numberOfLines={1} style={[styles.saveLabel, {color: colors.primary}]}>
              {busy ? '保存中' : savedAt ? '已保存' : '保存'}
            </Text>
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={{paddingBottom: insets.bottom + 40}}
        keyboardShouldPersistTaps="handled">
        <View style={styles.body}>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="标题"
            placeholderTextColor={colors.onSurfaceVariant}
            style={[type.title, styles.title, {color: colors.onSurface}]}
            accessibilityLabel="日记标题"
          />
          <Text style={[type.caption, {color: colors.onSurfaceVariant, marginBottom: 12}]}>
            {preview || '正文会随输入自动保存'}
          </Text>

          {doc.blocks.map((block, index) =>
            block.kind === 'text' ? (
              <View key={block.id} style={styles.paragraphRow}>
                <TextInput
                  value={block.text}
                  onChangeText={next => updateBlock(block.id, next)}
                  placeholder={index === 0 ? '写下此刻的心情…' : '继续写…'}
                  placeholderTextColor={colors.onSurfaceVariant}
                  multiline
                  textAlignVertical="top"
                  style={[
                    type.body,
                    styles.paragraph,
                    {
                      color: colors.onSurface,
                      backgroundColor: surfaces.sunken,
                      fontSize: settings.fontSize,
                    },
                  ]}
                  accessibilityLabel={`第 ${index + 1} 段`}
                />
                {doc.blocks.length > 1 ? (
                  <TextButton label="删除" onPress={() => removeBlock(block.id)} />
                ) : null}
              </View>
            ) : (
              <View key={block.id} style={styles.photoRow}>
                <Image
                  source={{uri: resolveMediaUri(block.uri, entryRef.current?.id)}}
                  resizeMode="cover"
                  style={styles.photo}
                  accessibilityLabel="日记照片"
                />
                <TextButton label="移除照片" onPress={() => removeBlock(block.id)} />
              </View>
            ),
          )}

          <View style={[styles.stickerStage, {backgroundColor: surfaces.sunken}]}>
            {doc.stickers.length ? (
              doc.stickers.map(sticker =>
                sticker.info ? (
                  <StickerView
                    key={sticker.id}
                    info={sticker.info}
                    onMove={(left, top) => moveSticker(sticker.id, left, top)}
                    onRemove={() => removeSticker(sticker.id)}
                  />
                ) : null,
              )
            ) : (
              <Text style={styles.stickerEmpty}>从下面挑一个贴纸，按住可以拖动</Text>
            )}
          </View>

          <View style={styles.paletteRow}>
            {STICKER_PALETTE.map(emoji => (
              <Pressable
                key={emoji}
                accessibilityRole="button"
                accessibilityLabel={`贴纸 ${emoji}`}
                onPress={() => addEmojiSticker(emoji)}
                style={({pressed}) => [styles.paletteItem, pressed && styles.pressed]}>
                <Text style={styles.paletteEmoji}>{emoji}</Text>
              </Pressable>
            ))}
          </View>

          <DoodleCanvas
            doc={doc}
            onChange={next => setDoc(previous => ({...previous, doodle: next}))}
            color={colors.onSurface}
            surface={surfaces.sunken}
          />

          <View style={styles.row}>
            <FlatButton label="加一段" onPress={addParagraph} style={{flex: 1}} />
            <FlatButton
              label="照片"
              onPress={() => {
                void addPhoto();
              }}
              style={{flex: 1, marginLeft: 12}}
            />
          </View>

          <View style={[styles.row, {marginTop: 12}]}>
            <FlatButton
              label="图片贴纸"
              onPress={() => {
                void addImageSticker();
              }}
              style={{flex: 1}}
            />
          </View>

          <View style={[styles.row, {marginTop: 12}]}>
            <FlatButton
              label={visibility === 'private' ? '仅自己可见' : '共享给 TA'}
              onPress={() =>
                setVisibility(previous => (previous === 'private' ? 'pair' : 'private'))
              }
              backgroundColor={visibility === 'private' ? colors.surfaceVariant : colors.primary}
              textColor={visibility === 'private' ? colors.onSurface : colors.onPrimary}
              style={{flex: 1}}
            />
          </View>

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function StickerView({
  info,
  onMove,
  onRemove,
}: {
  info: StickerInfo;
  onMove: (left: number, top: number) => void;
  onRemove: () => void;
}) {
  const [selected, setSelected] = useState(false);
  const startRef = useRef({left: info.left, top: info.top});
  const movedRef = useRef(false);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const posRef = useRef({left: info.left, top: info.top});
  posRef.current = {left: info.left, top: info.top};

  const responder = useMemo(
    () =>
      PanResponder.create({
        // no capture handlers: the ✕ badge must win the touch over the drag responder
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          startRef.current = {
            left: Math.max(0, Math.min(STAGE_WIDTH - info.size, posRef.current.left)),
            top: Math.max(0, Math.min(STICKER_STAGE_HEIGHT - info.size, posRef.current.top)),
          };
          movedRef.current = false;
        },
        onPanResponderMove: (_event, gesture) => {
          if (Math.abs(gesture.dx) + Math.abs(gesture.dy) > 4) {
            movedRef.current = true;
          }
          const maxLeft = Math.max(0, STAGE_WIDTH - info.size);
          const maxTop = Math.max(0, STICKER_STAGE_HEIGHT - info.size);
          const left = Math.max(0, Math.min(maxLeft, startRef.current.left + gesture.dx));
          const top = Math.max(0, Math.min(maxTop, startRef.current.top + gesture.dy));
          onMoveRef.current(left, top);
        },
        onPanResponderRelease: () => {
          if (!movedRef.current) {
            setSelected(value => !value);
          }
        },
      }),
    // responder identity must stay stable during a gesture; callbacks go through refs
    [info.size],
  );

  return (
    <View
      {...responder.panHandlers}
      style={[
        styles.sticker,
        {
          left: Math.max(0, Math.min(STAGE_WIDTH - info.size, info.left)),
          top: Math.max(0, Math.min(STICKER_STAGE_HEIGHT - info.size, info.top)),
          width: info.size,
          height: info.size,
          transform: [{rotate: `${info.rotate}deg`}],
        },
      ]}
      accessibilityLabel={info.kind === 'image' ? '图片贴纸' : `贴纸 ${info.value}`}>
      {info.kind === 'image' ? (
        <Image
          source={{uri: resolveMediaUri(info.value)}}
          resizeMode="contain"
          style={styles.stickerImage}
        />
      ) : (
        <Text style={styles.stickerEmoji}>{info.value}</Text>
      )}
      {selected ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="移除贴纸"
          onPress={onRemove}
          hitSlop={14}
          style={styles.stickerRemove}>
          <Text style={styles.stickerRemoveLabel}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function DoodleCanvas({
  doc,
  onChange,
  color,
  surface,
}: {
  doc: RichDoc;
  onChange: (doodle: RichDoc['doodle']) => void;
  color: string;
  surface: string;
}) {
  const [size, setSize] = useState({width: 0, height: DOODLE_HEIGHT});
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const currentRef = useRef<{x: number; y: number}[]>([]);
  const [current, setCurrent] = useState<{x: number; y: number}[]>([]);
  const strokes = doc.doodle?.strokes ?? [];

  const drawRef = useRef(false);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: event => {
          const {locationX, locationY} = event.nativeEvent;
          currentRef.current = [{x: locationX, y: locationY}];
          setCurrent(currentRef.current);
          drawRef.current = true;
        },
        onPanResponderMove: event => {
          if (!drawRef.current) {
            return;
          }
          const {locationX, locationY} = event.nativeEvent;
          currentRef.current = [...currentRef.current, {x: locationX, y: locationY}];
          setCurrent(currentRef.current);
        },
        onPanResponderRelease: () => {
          drawRef.current = false;
          const points = currentRef.current;
          currentRef.current = [];
          setCurrent([]);
          if (points.length < 2) {
            return;
          }
          const width = sizeRef.current.width || 1;
          const nextStrokes = [
            ...strokes,
            {color, width: 3, points},
          ];
          onChange({width, height: DOODLE_HEIGHT, strokes: nextStrokes});
        },
        onPanResponderTerminate: () => {
          drawRef.current = false;
          currentRef.current = [];
          setCurrent([]);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [color, strokes],
  );

  const allStrokes = current.length > 1 ? [...strokes, {color, width: 3, points: current}] : strokes;

  return (
    <View style={styles.doodleWrap}>
      <View style={styles.doodleHeader}>
        <Text style={[type.caption, {color: 'rgba(0,0,0,0.55)'}]}>涂鸦（手写）</Text>
        {strokes.length ? (
          <TextButton label="清空涂鸦" onPress={() => onChange(null)} />
        ) : null}
      </View>
      <View
        onLayout={event => {
          const {width} = event.nativeEvent.layout;
          setSize({width, height: DOODLE_HEIGHT});
        }}
        style={[styles.doodleBoard, {backgroundColor: surface, height: DOODLE_HEIGHT}]}
        {...responder.panHandlers}>
        {allStrokes.map((stroke, strokeIndex) =>
          stroke.points.slice(1).map((point, index) => {
            const from = stroke.points[index];
            const thickness = Math.max(1, stroke.width);
            const dx = point.x - from.x;
            const dy = point.y - from.y;
            const length = Math.hypot(dx, dy);
            if (!length) {
              return null;
            }
            return (
              <View
                key={`${strokeIndex}-${index}`}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: (from.x + point.x) / 2 - length / 2,
                  top: (from.y + point.y) / 2 - thickness / 2,
                  width: length,
                  height: thickness,
                  borderRadius: thickness / 2,
                  backgroundColor: stroke.color,
                  transform: [{rotate: `${Math.atan2(dy, dx)}rad`}],
                }}
              />
            );
          }),
        )}
        {!strokes.length && !current.length ? (
          <Text style={styles.doodleHint}>用手指在这里画，松手就保存</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  body: {paddingHorizontal: 20, paddingTop: 8},
  title: {marginTop: 8, marginBottom: 4},
  paragraphRow: {marginBottom: 10},
  paragraph: {borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, minHeight: 64},
  photoRow: {marginBottom: 10},
  photo: {width: '100%', height: 220, borderRadius: 14, marginBottom: 6},
  row: {flexDirection: 'row', marginTop: 6},
  saveSlot: {minWidth: 64, alignItems: 'flex-end'},
  saveLabel: {fontSize: 14, fontWeight: '600'},
  stickerStage: {
    height: STICKER_STAGE_HEIGHT,
    borderRadius: 18,
    marginTop: 16,
    overflow: 'hidden',
  },
  stickerEmpty: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 96,
    textAlign: 'center',
    fontSize: 13,
    color: '#8A8A8E',
  },
  sticker: {position: 'absolute', alignItems: 'center', justifyContent: 'center'},
  stickerImage: {width: '100%', height: '100%'},
  stickerEmoji: {fontSize: 40},
  stickerRemove: {
    position: 'absolute',
    right: 2,
    top: 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1C1C1E',
  },
  stickerRemoveLabel: {color: '#FFFFFF', fontSize: 12, fontWeight: '700'},
  paletteRow: {flexDirection: 'row', flexWrap: 'wrap', marginTop: 12},
  paletteItem: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    marginBottom: 8,
  },
  paletteEmoji: {fontSize: 24},
  pressed: {opacity: 0.6},
  doodleWrap: {marginTop: 6, marginBottom: 14},
  doodleHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  doodleBoard: {marginTop: 8, borderRadius: 14, overflow: 'hidden'},
  doodleHint: {
    position: 'absolute',
    left: 16,
    top: 16,
    fontSize: 12,
    color: 'rgba(0,0,0,0.35)',
  },
});
