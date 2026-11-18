/**
 * 定时规则：到点提醒。
 * 两端都能看到规则；本机会把启用中的规则排进 AlarmManager（一次闹钟一条通知）。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
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
import {AppDialog, AppSheet, FlatButton} from '../../components/Ui';
import {TopBar} from '../../components/TopBar';
import {showToast} from '../../components/toast';
import {useQi} from '../qi/QiProvider';
import {
  createReminder,
  deleteReminder,
  loadReminders,
  refreshReminders,
  Reminder,
  upsertReminder,
} from '../../sync/reminders';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function RemindersScreen({onBack}: {onBack: () => void}) {
  const {colors, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {pair} = useQi();
  const [items, setItems] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [time, setTime] = useState('22:30');
  const [message, setMessage] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const [pendingDelete, setPendingDelete] = useState<Reminder | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(pair ? await refreshReminders(pair) : await loadReminders());
    } catch (error: any) {
      showToast(error?.message ?? '刷新失败');
      setItems(await loadReminders());
    } finally {
      setLoading(false);
    }
  }, [pair]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const create = async () => {
    try {
      const reminder = await createReminder(pair, time, days, message);
      setItems(previous =>
        [...previous, reminder].sort((a, b) => a.time.localeCompare(b.time)),
      );
      setMessage('');
      setDays([]);
      setCreateOpen(false);
    } catch (error: any) {
      showToast(error?.message ?? '创建失败');
    }
  };

  const toggle = async (reminder: Reminder, enabled: boolean) => {
    try {
      const next = await upsertReminder(pair, {...reminder, enabled});
      setItems(previous =>
        previous.map(item => (item.id === next.id ? next : item)),
      );
    } catch (error: any) {
      showToast(error?.message ?? '操作失败');
    }
  };

  const toggleDay = (day: number) => {
    setDays(previous =>
      previous.includes(day)
        ? previous.filter(item => item !== day)
        : [...previous, day].sort(),
    );
  };

  return (
    <View style={styles.root}>
      <TopBar title="定时规则" onBack={onBack} />
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
          到点弹一条通知；规则会同步到对方设备，不会唤醒屏幕或常驻后台。
        </Text>

        <FlatButton
          label="新建提醒"
          onPress={() => setCreateOpen(true)}
          style={styles.primary}
        />

        {items.length === 0 ? (
          <SoftCard radius={18} style={styles.empty}>
            <GlassIcon name="refresh" size={34} />
            <Text
              style={[
                type.body,
                {color: colors.onSurfaceVariant, marginTop: 10, textAlign: 'center'},
              ]}>
              还没有定时规则。比如每天 22:30 提醒睡觉。
            </Text>
          </SoftCard>
        ) : (
          items.map(item => (
            <SoftCard key={item.id} radius={16} style={styles.card}>
              <View style={styles.row}>
                <Text style={[styles.time, {color: colors.onSurface}]}>
                  {item.time}
                </Text>
                <View style={{flex: 1}}>
                  <Text
                    style={[type.body, {color: colors.onSurface}]}
                    numberOfLines={1}>
                    {item.message || '提醒'}
                  </Text>
                  <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
                    {item.days.length === 0
                      ? '每天'
                      : item.days.map(day => `周${WEEKDAYS[day]}`).join(' ')}
                  </Text>
                </View>
                <Switch
                  accessibilityLabel={`启用 ${item.time} 的提醒`}
                  value={item.enabled}
                  onValueChange={next => {
                    toggle(item, next).catch(() => undefined);
                  }}
                  trackColor={{true: colors.primary, false: colors.outline}}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="删除提醒"
                onPress={() => setPendingDelete(item)}
                style={styles.deleteRow}>
                <Text style={[type.caption, {color: withAlpha(colors.error, 0.9)}]}>
                  删除
                </Text>
              </Pressable>
            </SoftCard>
          ))
        )}
      </ScrollView>

      <AppSheet
        visible={createOpen}
        title="新建提醒"
        onClose={() => setCreateOpen(false)}
        footer={
          <FlatButton label="保存" onPress={() => create().catch(() => undefined)} />
        }>
        <Text style={[type.label, {color: colors.onSurfaceVariant}]}>
          时间（24 小时制）
        </Text>
        <TextInput
          value={time}
          onChangeText={setTime}
          placeholder="22:30"
          placeholderTextColor={colors.onSurfaceVariant}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          accessibilityLabel="提醒时间"
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
          重复（不选=每天）
        </Text>
        <View style={styles.daysRow}>
          {WEEKDAYS.map((label, index) => {
            const active = days.includes(index);
            return (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityState={{selected: active}}
                accessibilityLabel={`周${label}`}
                onPress={() => toggleDay(index)}
                style={[
                  styles.dayChip,
                  {backgroundColor: active ? colors.primary : colors.surfaceVariant},
                ]}>
                <Text
                  style={[
                    type.caption,
                    {color: active ? colors.onPrimary : colors.onSurfaceVariant},
                  ]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text
          style={[type.label, {color: colors.onSurfaceVariant, marginTop: 14}]}>
          内容
        </Text>
        <TextInput
          value={message}
          onChangeText={setMessage}
          placeholder="例如：该睡觉啦"
          placeholderTextColor={colors.onSurfaceVariant}
          maxLength={80}
          accessibilityLabel="提醒内容"
          style={[
            styles.input,
            {
              color: colors.onSurface,
              backgroundColor: colors.surfaceVariant,
              borderColor: colors.outline,
            },
          ]}
        />
      </AppSheet>

      <AppDialog
        visible={!!pendingDelete}
        title="删除这条提醒？"
        message="删除后对方也会看不到。"
        confirmLabel="删除"
        dismissLabel="取消"
        destructive
        onDismiss={() => setPendingDelete(null)}
        onConfirm={() => {
          const reminder = pendingDelete;
          setPendingDelete(null);
          if (!reminder) {
            return;
          }
          deleteReminder(pair, reminder)
            .then(() =>
              setItems(previous => previous.filter(item => item.id !== reminder.id)),
            )
            .catch(() => showToast('删除失败'));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  intro: {marginTop: 4, marginBottom: 12},
  primary: {height: 46},
  empty: {padding: 24, alignItems: 'center', marginTop: 14},
  card: {padding: 14, marginTop: 10},
  row: {flexDirection: 'row', alignItems: 'center', gap: 14},
  time: {fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums']},
  deleteRow: {alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 4},
  input: {
    marginTop: 6,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  daysRow: {flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap'},
  dayChip: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
