/**
 * 共享空间：两端都能贴的便签与里程碑。
 * 正文端到端加密；这里只做「写下、看到、删掉自己写的」三件事。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {withAlpha} from '../../theme/palette';
import {type} from '../../theme/typography';
import {GlassIcon} from '../../components/GlassIcon';
import {SoftCard} from '../../components/Surfaces';
import {AppDialog, FlatButton, Pill} from '../../components/Ui';
import {TopBar} from '../../components/TopBar';
import {showToast} from '../../components/toast';
import {useQi} from '../qi/QiProvider';
import {
  deleteSharedNote,
  loadSharedSpace,
  postSharedNote,
  refreshSharedSpace,
  SharedNote,
} from '../../sync/sharedSpace';

export function SharedSpace({onBack}: {onBack: () => void}) {
  const {colors, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {pair, state} = useQi();
  const [notes, setNotes] = useState<SharedNote[]>([]);
  const [text, setText] = useState('');
  const [milestone, setMilestone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SharedNote | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setNotes(pair ? await refreshSharedSpace(pair) : await loadSharedSpace());
    } catch (error: any) {
      showToast(error?.message ?? '刷新失败');
      setNotes(await loadSharedSpace());
    } finally {
      setLoading(false);
    }
  }, [pair]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const post = async () => {
    if (posting) {
      return;
    }
    if (!pair) {
      showToast('还没有完成联结，先去「我的 → 我的身份与联结」绑定');
      return;
    }
    setPosting(true);
    try {
      const note = await postSharedNote(
        pair,
        state.deviceId,
        text,
        milestone ? 'milestone' : 'note',
      );
      setNotes(previous => [note, ...previous]);
      setText('');
      setMilestone(false);
    } catch (error: any) {
      showToast(error?.message ?? '发送失败');
    } finally {
      setPosting(false);
    }
  };

  return (
    <View style={styles.root}>
      <TopBar title="共享空间" onBack={onBack} />
      <ScrollView
        contentContainerStyle={{
          padding: tokens.contentPadding,
          paddingBottom: insets.bottom + 40,
        }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => {
              refresh().catch(() => undefined);
            }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        showsVerticalScrollIndicator={false}>
        <Text style={[type.body, styles.intro, {color: colors.onSurfaceVariant}]}>
          {pair
            ? `只有 ${pair.ownerName} 和 ${pair.puppyName} 能看到这里，服务器只存密文。`
            : '还没有联结，先完成一次绑定。'}
        </Text>

        <SoftCard radius={18} style={styles.composer}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={milestone ? '记下一个值得纪念的时刻…' : '写一句想留给对方的话…'}
            placeholderTextColor={colors.onSurfaceVariant}
            multiline
            maxLength={300}
            accessibilityLabel="共享空间内容"
            style={[
              styles.input,
              {
                color: colors.onSurface,
                backgroundColor: colors.surfaceVariant,
                borderColor: colors.outline,
              },
            ]}
          />
          <View style={styles.composerFooter}>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{checked: milestone}}
              accessibilityLabel="标记为里程碑"
              onPress={() => setMilestone(value => !value)}
              style={styles.milestoneToggle}>
              <GlassIcon name={milestone ? 'star' : 'circle'} size={18} />
              <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
                里程碑
              </Text>
            </Pressable>
            <FlatButton
              label={posting ? '发送中…' : '贴上'}
              onPress={() => {
                post().catch(() => undefined);
              }}
              disabled={posting || !text.trim() || !pair}
              style={styles.sendButton}
            />
          </View>
        </SoftCard>

        <Text style={[type.section, styles.sectionTitle, {color: colors.onSurface}]}>
          这里有什么
        </Text>

        {notes.length === 0 ? (
          <SoftCard radius={18} style={styles.empty}>
            <GlassIcon name="star" size={34} />
            <Text style={[type.body, {color: colors.onSurfaceVariant, marginTop: 10}]}>
              还什么都没有。写下第一句，对方打开就能看到。
            </Text>
          </SoftCard>
        ) : (
          notes.map(note => {
            const mine = note.authorDeviceId === state.deviceId;
            return (
              <SoftCard
                key={note.id}
                radius={16}
                style={[
                  styles.note,
                  note.kind === 'milestone' && {
                    borderLeftWidth: 3,
                    borderLeftColor: colors.primary,
                  },
                ]}>
                <View style={styles.noteHeader}>
                  <Pill
                    text={mine ? '我' : 'TA'}
                    color={colors.onSurfaceVariant}
                    background={colors.surfaceVariant}
                  />
                  {note.kind === 'milestone' ? (
                    <Pill
                      text="里程碑"
                      color={colors.onPrimary}
                      background={colors.primary}
                    />
                  ) : null}
                  <Text
                    style={[
                      type.caption,
                      {color: colors.onSurfaceVariant, marginLeft: 'auto'},
                    ]}>
                    {new Date(note.at).toLocaleString('zh-CN', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
                <Text style={[type.body, {color: colors.onSurface, marginTop: 8}]}>
                  {note.text}
                </Text>
                {mine ? (
                  <Text
                    accessibilityRole="button"
                    accessibilityLabel="删除这条"
                    onPress={() => setPendingDelete(note)}
                    style={[
                      type.caption,
                      styles.delete,
                      {color: withAlpha(colors.error, 0.9)},
                    ]}>
                    删除
                  </Text>
                ) : null}
              </SoftCard>
            );
          })
        )}
      </ScrollView>

      <AppDialog
        visible={!!pendingDelete}
        title="删除这条？"
        message="删除后对方也看不到了，无法恢复。"
        confirmLabel="删除"
        dismissLabel="再想想"
        destructive
        onDismiss={() => setPendingDelete(null)}
        onConfirm={() => {
          const note = pendingDelete;
          setPendingDelete(null);
          if (!pair || !note) {
            return;
          }
          deleteSharedNote(pair, note.id)
            .then(() => {
              setNotes(previous => previous.filter(item => item.id !== note.id));
            })
            .catch(() => showToast('删除失败'));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  intro: {marginTop: 4, marginBottom: 12},
  composer: {padding: 14},
  input: {
    minHeight: 84,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  composerFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  milestoneToggle: {flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6},
  sendButton: {width: 96, height: 42},
  sectionTitle: {marginTop: 22, marginBottom: 10},
  empty: {padding: 24, alignItems: 'center'},
  note: {padding: 14, marginBottom: 10},
  noteHeader: {flexDirection: 'row', alignItems: 'center', gap: 8},
  delete: {alignSelf: 'flex-end', marginTop: 8, padding: 4},
});
