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
import {SoftCard} from '../components/Surfaces';
import {showToast} from '../components/toast';
import {AppSettings, JournalEntry, defaultEntryTitle, todayIso} from '../data/types';
import {getEntry, saveEntry} from '../data/storage';
import {native} from '../native/InorinalNative';
import {
  DocBlock,
  RichDoc,
  docPreview,
  emptyRichDoc,
  parseRichDoc,
  serializeRichDoc,
} from '../journal/richDoc';

const AUTO_SAVE_DELAY = 700;
const PHOTO_MAX_BYTES = 2_400_000;
const DOODLE_HEIGHT = 260;

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

export function NativeEditorScreen({
  entryId,
  settings,
  onBack,
  onOpenWebEditor,
}: {
  entryId: string;
  settings: AppSettings;
  onBack: () => void;
  onOpenWebEditor: () => void;
}) {
  const {colors, surfaces} = useAppTheme();
  const insets = useSafeAreaInsets();
  const entryRef = useRef<JournalEntry | null>(null);
  const draftRef = useRef(entryId === 'new');
  const [title, setTitle] = useState('');
  const [doc, setDoc] = useState<RichDoc>(() => emptyRichDoc());
  const [visibility, setVisibility] = useState<'private' | 'pair'>('pair');
  const [blocked, setBlocked] = useState(false);
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
      const parsed = parseRichDoc(entry.content);
      if (parsed.hasStickers) {
        setBlocked(true);
        return;
      }
      setDoc(parsed);
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
    if (blocked || !entryRef.current) {
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
  }, [title, doc, visibility, blocked, save]);

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

  const close = useCallback(async () => {
    if (blocked) {
      onBack();
      return;
    }
    await save(title, doc, visibility);
    onBack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked, title, doc, visibility, save]);

  if (blocked) {
    return (
      <View style={[styles.root, {backgroundColor: colors.background}]}>
        <TopBar title="这篇日记" onBack={onBack} />
        <View style={styles.blockedWrap}>
          <SoftCard>
            <Text style={[type.headline, {color: colors.onSurface}]}>
              这篇日记含贴纸
            </Text>
            <Text style={[type.body, {color: colors.onSurfaceVariant, marginTop: 8}]}>
              原生编辑器目前负责文字、图片与涂鸦；为了不丢掉贴纸的摆放，
              这篇请用完整编辑器打开。
            </Text>
          </SoftCard>
          <FlatButton label="用完整编辑器打开" onPress={onOpenWebEditor} style={{marginTop: 16}} />
          <TextButton label="返回" onPress={onBack} style={{marginTop: 8}} />
        </View>
      </View>
    );
  }

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
                  source={{uri: block.uri}}
                  resizeMode="cover"
                  style={styles.photo}
                  accessibilityLabel="日记照片"
                />
                <TextButton label="移除照片" onPress={() => removeBlock(block.id)} />
              </View>
            ),
          )}

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
              label={visibility === 'private' ? '仅自己可见' : '共享给 TA'}
              onPress={() =>
                setVisibility(previous => (previous === 'private' ? 'pair' : 'private'))
              }
              backgroundColor={visibility === 'private' ? colors.surfaceVariant : colors.primary}
              textColor={visibility === 'private' ? colors.onSurface : colors.onPrimary}
              style={{flex: 1}}
            />
          </View>

          {doc.hasStickers ? (
            <TextButton
              label="用完整编辑器打开（贴纸）"
              onPress={onOpenWebEditor}
              style={{marginTop: 18}}
            />
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
  blockedWrap: {padding: 20},
  saveSlot: {minWidth: 64, alignItems: 'flex-end'},
  saveLabel: {fontSize: 14, fontWeight: '600'},
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
