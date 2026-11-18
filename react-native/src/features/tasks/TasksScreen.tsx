/**
 * 任务 / 报备。
 * 主人下达任务、验收报备；小狗查看任务、提交报备。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  Image,
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
import {AppSheet, FlatButton, Pill, TextButton} from '../../components/Ui';
import {TopBar} from '../../components/TopBar';
import {showToast} from '../../components/toast';
import {useQi} from '../qi/QiProvider';
import {AlbumItem, loadAlbum, loadPhotoImage, sharePhoto} from '../../sync/album';
import {ImageViewer} from '../../components/ImageViewer';
import {
  createTask,
  loadTasks,
  QiTask,
  refreshTasks,
  submitTask,
  verdictTask,
} from '../../sync/tasks';

const STATUS_LABEL: Record<QiTask['status'], string> = {
  open: '待完成',
  submitted: '待验收',
  done: '已完成',
  cancelled: '已撤回',
};

/**
 * 报备附图缩略图：按 mediaId 从相册分块媒体里取回原图（data URI），
 * 点开走全局 ImageViewer。图片不进同步记录，所以这里按需拉取并缓存。
 */
function SubmittedPhoto({
  pair,
  id,
  onOpen,
}: {
  pair: any;
  id: string;
  onOpen: (uri: string) => void;
}) {
  const {colors, tokens} = useAppTheme();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const items = await loadAlbum();
        const item = items.find(entry => entry.id === id);
        if (!item) {
          if (alive) {
            setFailed(true);
          }
          return;
        }
        const data = await loadPhotoImage(pair, item);
        if (alive) {
          setUri(data);
        }
      } catch {
        if (alive) {
          setFailed(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, pair]);

  if (failed) {
    return (
      <Text style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 6}]}>
        附图已失效
      </Text>
    );
  }
  return (
    <Pressable
      onPress={() => (uri ? onOpen(uri) : undefined)}
      accessibilityLabel="查看报备附图"
      style={[
        styles.photo,
        {backgroundColor: colors.surfaceVariant, borderColor: colors.outline},
      ]}>
      {uri ? (
        <Image source={{uri}} style={styles.photoImage} resizeMode="cover" />
      ) : (
        <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
          {tokens ? '加载附图…' : '加载中'}
        </Text>
      )}
    </Pressable>
  );
}

export function TasksScreen({onBack}: {onBack: () => void}) {
  const {colors, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {pair, role, state} = useQi();
  const isMaster = role === 'MASTER';
  const [tasks, setTasks] = useState<QiTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [active, setActive] = useState<QiTask | null>(null);
  const [reply, setReply] = useState('');
  const [attach, setAttach] = useState<AlbumItem | null>(null);
  const [attachUri, setAttachUri] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [viewer, setViewer] = useState<{uri: string; name?: string} | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setTasks(pair ? await refreshTasks(pair) : await loadTasks());
    } catch (error: any) {
      showToast(error?.message ?? '刷新失败');
      setTasks(await loadTasks());
    } finally {
      setLoading(false);
    }
  }, [pair]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const counts = {
    open: tasks.filter(item => item.status === 'open').length,
    submitted: tasks.filter(item => item.status === 'submitted').length,
    done: tasks.filter(item => item.status === 'done').length,
  };

  const create = async () => {
    if (!pair) {
      return;
    }
    try {
      const task = await createTask(pair, state.deviceId, title, detail);
      setTasks(previous => [task, ...previous]);
      setTitle('');
      setDetail('');
      setComposeOpen(false);
    } catch (error: any) {
      showToast(error?.message ?? '创建失败');
    }
  };

  const submit = async () => {
    if (!pair || !active) {
      return;
    }
    try {
      const task = await submitTask(pair, active, reply, attach?.id);
      setTasks(previous => previous.map(item => (item.id === task.id ? task : item)));
      setActive(null);
      setReply('');
      setAttach(null);
      setAttachUri(null);
    } catch (error: any) {
      showToast(error?.message ?? '报备失败');
    }
  };

  const attachPhoto = async () => {
    if (!pair) {
      return;
    }
    setAttaching(true);
    try {
      const item = await sharePhoto(pair, state.deviceId);
      const uri = await loadPhotoImage(pair, item);
      setAttach(item);
      setAttachUri(uri);
    } catch (error: any) {
      const message = String(error?.message ?? '');
      if (message && !message.includes('没有选择照片')) {
        showToast(message);
      }
    } finally {
      setAttaching(false);
    }
  };

  const verdict = async (task: QiTask, done: boolean) => {
    if (!pair) {
      return;
    }
    try {
      const next = await verdictTask(pair, task, done, '');
      setTasks(previous => previous.map(item => (item.id === next.id ? next : item)));
      showToast(done ? '已验收' : '已打回，等待重新报备');
    } catch (error: any) {
      showToast(error?.message ?? '操作失败');
    }
  };

  return (
    <View style={styles.root}>
      <TopBar title={isMaster ? '任务与指令' : '我的任务'} onBack={onBack} />
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
        <View style={styles.stats}>
          {[
            {label: '待完成', value: counts.open},
            {label: '待验收', value: counts.submitted},
            {label: '已完成', value: counts.done},
          ].map(item => (
            <SoftCard key={item.label} radius={14} style={styles.statCard}>
              <Text style={[styles.statValue, {color: colors.onSurface}]}>
                {item.value}
              </Text>
              <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
                {item.label}
              </Text>
            </SoftCard>
          ))}
        </View>

        {isMaster ? (
          <FlatButton
            label="下达新任务"
            onPress={() => setComposeOpen(true)}
            style={styles.primary}
          />
        ) : null}

        <Text style={[type.section, styles.sectionTitle, {color: colors.onSurface}]}>
          全部任务
        </Text>

        {tasks.length === 0 ? (
          <SoftCard radius={18} style={styles.empty}>
            <GlassIcon name="check" size={34} />
            <Text style={[type.body, {color: colors.onSurfaceVariant, marginTop: 10, textAlign: 'center'}]}>
              {isMaster ? '还没有任务。下达第一件小事吧。' : '还没有任务，等主人安排。'}
            </Text>
          </SoftCard>
        ) : (
          tasks.map(task => (
            <SoftCard key={task.id} radius={16} style={styles.task}>
              <View style={styles.taskHeader}>
                <Text
                  style={[type.bodyStrong, {color: colors.onSurface, flex: 1}]}
                  numberOfLines={2}>
                  {task.title}
                </Text>
                <Pill
                  text={STATUS_LABEL[task.status]}
                  color={
                    task.status === 'done'
                      ? colors.onPrimary
                      : colors.onSurfaceVariant
                  }
                  background={
                    task.status === 'done'
                      ? colors.primary
                      : withAlpha(colors.outline, 0.35)
                  }
                />
              </View>
              {task.detail ? (
                <Text style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 6}]}>
                  {task.detail}
                </Text>
              ) : null}
              {task.submittedText ? (
                <View
                  style={[
                    styles.replyBox,
                    {backgroundColor: colors.surfaceVariant},
                  ]}>
                  <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
                    报备
                  </Text>
                  <Text style={[type.body, {color: colors.onSurface, marginTop: 2}]}>
                    {task.submittedText}
                  </Text>
                </View>
              ) : null}
              {task.submittedPhotoId ? (
                <SubmittedPhoto
                  pair={pair}
                  id={task.submittedPhotoId}
                  onOpen={uri => setViewer({uri, name: '报备附图'})}
                />
              ) : null}
              {task.verdictText ? (
                <Text style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 6}]}>
                  验收备注：{task.verdictText}
                </Text>
              ) : null}

              {isMaster && task.status === 'submitted' ? (
                <View style={styles.actions}>
                  <TextButton
                    label="打回"
                    color={colors.onSurfaceVariant}
                    onPress={() => {
                      verdict(task, false).catch(() => undefined);
                    }}
                  />
                  <FlatButton
                    label="验收通过"
                    onPress={() => {
                      verdict(task, true).catch(() => undefined);
                    }}
                    style={styles.acceptButton}
                  />
                </View>
              ) : null}

              {!isMaster && task.status === 'open' ? (
                <FlatButton
                  label="报备完成"
                  onPress={() => {
                    setReply('');
                    setActive(task);
                  }}
                  style={styles.replyButton}
                />
              ) : null}

              {!isMaster && task.status === 'submitted' ? (
                <Text style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 8}]}>
                  已报备，等待主人验收
                </Text>
              ) : null}
            </SoftCard>
          ))
        )}
      </ScrollView>

      <AppSheet
        visible={composeOpen}
        title="下达新任务"
        onClose={() => setComposeOpen(false)}
        footer={<FlatButton label="下达" onPress={create} />}>
        <Text style={[type.label, {color: colors.onSurfaceVariant}]}>标题</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="例如：今天喝完 8 杯水"
          placeholderTextColor={colors.onSurfaceVariant}
          maxLength={60}
          accessibilityLabel="任务标题"
          style={[
            styles.input,
            {
              color: colors.onSurface,
              backgroundColor: colors.surfaceVariant,
              borderColor: colors.outline,
            },
          ]}
        />
        <Text
          style={[type.label, {color: colors.onSurfaceVariant, marginTop: 14}]}>
          说明（可选）
        </Text>
        <TextInput
          value={detail}
          onChangeText={setDetail}
          placeholder="补充要求或验收标准"
          placeholderTextColor={colors.onSurfaceVariant}
          maxLength={300}
          multiline
          accessibilityLabel="任务说明"
          style={[
            styles.input,
            styles.multiline,
            {
              color: colors.onSurface,
              backgroundColor: colors.surfaceVariant,
              borderColor: colors.outline,
            },
          ]}
        />
      </AppSheet>

      <AppSheet
        visible={!!active}
        title="我的报备"
        onClose={() => setActive(null)}
        footer={<FlatButton label="提交报备" onPress={submit} />}>
        <Text style={[type.body, {color: colors.onSurface}]}>{active?.title}</Text>
        <TextInput
          value={reply}
          onChangeText={setReply}
          placeholder="说说完成情况（可选）"
          placeholderTextColor={colors.onSurfaceVariant}
          maxLength={300}
          multiline
          accessibilityLabel="报备内容"
          style={[
            styles.input,
            styles.multiline,
            {
              marginTop: 12,
              color: colors.onSurface,
              backgroundColor: colors.surfaceVariant,
              borderColor: colors.outline,
            },
          ]}
        />
        <View style={styles.attachRow}>
          <TextButton
            label={attaching ? '处理中…' : attachUri ? '更换照片' : '附一张照片'}
            color={colors.primary}
            onPress={() => {
              if (!attaching) {
                attachPhoto().catch(() => undefined);
              }
            }}
          />
          {attachUri ? (
            <TextButton
              label="移除"
              color={colors.onSurfaceVariant}
              onPress={() => {
                setAttach(null);
                setAttachUri(null);
              }}
            />
          ) : null}
        </View>
        {attachUri ? (
          <Pressable
            onPress={() => setViewer({uri: attachUri, name: attach?.name})}
            accessibilityLabel="预览报备照片"
            style={[
              styles.photo,
              {backgroundColor: colors.surfaceVariant, borderColor: colors.outline},
            ]}>
            <Image source={{uri: attachUri}} style={styles.photoImage} resizeMode="cover" />
          </Pressable>
        ) : null}
      </AppSheet>
      <ImageViewer
        visible={!!viewer}
        uri={viewer?.uri ?? null}
        fileName={viewer?.name}
        onClose={() => setViewer(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  photo: {
    marginTop: 10,
    height: 132,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoImage: {width: '100%', height: '100%'},
  attachRow: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 8},
  root: {flex: 1},
  stats: {flexDirection: 'row', gap: 10, marginTop: 4},
  statCard: {flex: 1, padding: 14, alignItems: 'center'},
  statValue: {fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums']},
  primary: {marginTop: 14, height: 46},
  sectionTitle: {marginTop: 20, marginBottom: 10},
  empty: {padding: 24, alignItems: 'center'},
  task: {padding: 14, marginBottom: 10},
  taskHeader: {flexDirection: 'row', alignItems: 'flex-start', gap: 8},
  replyBox: {borderRadius: 10, padding: 10, marginTop: 8},
  actions: {flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 10},
  acceptButton: {height: 40, paddingHorizontal: 18},
  replyButton: {marginTop: 10, height: 40},
  input: {
    marginTop: 6,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  multiline: {minHeight: 84, textAlignVertical: 'top'},
});
