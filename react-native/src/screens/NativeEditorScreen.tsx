/**
 * 原生日记编辑器（item 7 第一步）。
 *
 * 只接管「纯文字」日记：标题 + 段落。含图片/贴纸/涂鸦/列表/样式的旧日记
 * 仍由 WebView 完整编辑器打开（`onOpenWebEditor`），因此不会丢格式。
 *
 * 序列化沿用编辑器的 `<div>` 段落格式，两套编辑器可互相打开同一篇日记；
 * 富文本能力（加粗、颜色、涂鸦）留在 WebView 编辑器里，后续按块迁移。
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  KeyboardAvoidingView,
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
import {
  AppSettings,
  JournalEntry,
  defaultEntryTitle,
  todayIso,
} from '../data/types';
import {getEntry, saveEntry} from '../data/storage';
import {
  htmlToParagraphs,
  isSimpleTextHtml,
  paragraphsPreview,
  paragraphsToHtml,
} from '../journal/simpleHtml';

const AUTO_SAVE_DELAY = 700;

function makeId(): string {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${now}-${rand}`;
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
  // 新建页会先建草稿；用户什么都没写就返回时不要落盘，避免列表里堆空条目。
  const draftRef = useRef(entryId === 'new');
  const [title, setTitle] = useState('');
  const [paragraphs, setParagraphs] = useState<string[]>(['']);
  const [visibility, setVisibility] = useState<'private' | 'pair'>('pair');
  const [blocked, setBlocked] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // 载入：新条目就地创建草稿，旧条目直接读。
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
        setParagraphs(['']);
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
      if (!isSimpleTextHtml(entry.content)) {
        setBlocked(true);
        return;
      }
      setParagraphs(htmlToParagraphs(entry.content));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  const save = useCallback(
    async (nextTitle: string, nextParagraphs: string[], nextVisibility: 'private' | 'pair') => {
      const entry = entryRef.current;
      if (!entry) {
        return;
      }
      const untouched =
        draftRef.current &&
        nextTitle.trim() === entry.title.trim() &&
        nextParagraphs.every(text => text.trim() === '');
      if (untouched) {
        return;
      }
      setBusy(true);
      try {
        const updated: JournalEntry = {
          ...entry,
          title: nextTitle.trim() || defaultEntryTitle(new Date()),
          content: paragraphsToHtml(nextParagraphs),
          visibility: nextVisibility,
          updatedAt: Date.now(),
        };
        await saveEntry(updated);
        const saved = {...updated, updatedAt: updated.updatedAt};
        entryRef.current = saved;
        draftRef.current = false;
        setSavedAt(saved.updatedAt);
      } catch (error) {
        showToast(error instanceof Error ? error.message : '保存失败');
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // 自动保存：正文/标题/可见性任一变化后延迟落盘。
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (blocked || !entryRef.current) {
      return;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      void save(title, paragraphs, visibility);
    }, AUTO_SAVE_DELAY);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [title, paragraphs, visibility, blocked, save]);

  const preview = useMemo(() => paragraphsPreview(paragraphs), [paragraphs]);

  const close = useCallback(async () => {
    if (blocked) {
      onBack();
      return;
    }
    await save(title, paragraphs, visibility);
    onBack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked, title, paragraphs, visibility, save]);

  if (blocked) {
    return (
      <View style={[styles.root, {backgroundColor: colors.background}]}>
        <TopBar title="这篇日记" onBack={onBack} />
        <View style={styles.blockedWrap}>
          <SoftCard>
            <Text style={[type.headline, {color: colors.onSurface}]}>
              这篇含图片、贴纸或涂鸦
            </Text>
            <Text
              style={[
                type.body,
                {color: colors.onSurfaceVariant, marginTop: 8},
              ]}>
              原生编辑器目前只负责纯文字日记；为了不丢掉它的图片和涂鸦，
              请用完整编辑器打开。
            </Text>
          </SoftCard>
          <FlatButton
            label="用完整编辑器打开"
            onPress={onOpenWebEditor}
            style={{marginTop: 16}}
          />
          <TextButton
            label="返回"
            onPress={onBack}
            style={{marginTop: 8}}
          />
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
              void save(title, paragraphs, visibility);
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
          <Text
            style={[
              type.caption,
              {color: colors.onSurfaceVariant, marginBottom: 12},
            ]}>
            {preview || '正文会随输入自动保存'}
          </Text>

          {paragraphs.map((text, index) => (
            <View key={`p-${index}`} style={styles.paragraphRow}>
              <TextInput
                value={text}
                onChangeText={next => {
                  setParagraphs(previous =>
                    previous.map((item, i) => (i === index ? next : item)),
                  );
                }}
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
              {paragraphs.length > 1 ? (
                <TextButton
                  label="删除"
                  onPress={() => {
                    setParagraphs(previous =>
                      previous.filter((_, i) => i !== index),
                    );
                  }}
                />
              ) : null}
            </View>
          ))}

          <View style={styles.row}>
            <FlatButton
              label="加一段"
              onPress={() => setParagraphs(previous => [...previous, ''])}
              style={{flex: 1}}
            />
            <FlatButton
              label={visibility === 'private' ? '仅自己可见' : '共享给 TA'}
              onPress={() =>
                setVisibility(previous =>
                  previous === 'private' ? 'pair' : 'private',
                )
              }
              backgroundColor={
                visibility === 'private' ? colors.surfaceVariant : colors.primary
              }
              textColor={
                visibility === 'private'
                  ? colors.onSurface
                  : colors.onPrimary
              }
              style={{flex: 1, marginLeft: 12}}
            />
          </View>

          <TextButton
            label="用完整编辑器打开（图片 / 贴纸 / 涂鸦）"
            onPress={onOpenWebEditor}
            style={{marginTop: 18}}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  body: {paddingHorizontal: 20, paddingTop: 8},
  title: {marginTop: 8, marginBottom: 4},
  paragraphRow: {marginBottom: 10},
  paragraph: {borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, minHeight: 64},
  row: {flexDirection: 'row', marginTop: 6},
  blockedWrap: {padding: 20},
  saveSlot: {minWidth: 64, alignItems: 'flex-end'},
  saveLabel: {fontSize: 14, fontWeight: '600'},
});
