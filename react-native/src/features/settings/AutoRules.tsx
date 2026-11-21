/**
 * 小狗端「自动规则」：到点自动切档，不用记着手动改。
 *
 * 设计取舍：规则只做「把功耗档位换掉」这一件事，并且由守护服务的 tick 顺手评估
 * ——不新增定时器、不申请唤醒、不联网。规则镜像进原生 SharedPreferences，所以
 * 即使 JS 已经被回收，服务在下一个 tick 仍会按规则切档。
 */
import React, {useEffect, useMemo, useState} from 'react';
import {ScrollView, StyleSheet, Switch, Text, TextInput, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {withAlpha} from '../../theme/palette';
import {type} from '../../theme/typography';
import {GlassIcon} from '../../components/GlassIcon';
import {SoftCard} from '../../components/Surfaces';
import {FlatButton, Pill} from '../../components/Ui';
import {TopBar} from '../../components/TopBar';
import {showToast} from '../../components/toast';
import {useQi} from '../qi/QiProvider';
import {qiDevice} from '../../native/QiDevice';
import type {AutoRule} from '../../data/pairTypes';
import type {PowerTier} from '../../config';

const TIERS: {key: PowerTier; label: string}[] = [
  {key: 'SAVER', label: '省电'},
  {key: 'BALANCED', label: '智能'},
  {key: 'REALTIME', label: '实时'},
];

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function AutoRules({onBack}: {onBack: () => void}) {
  const {colors} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {state, setAutoRules} = useQi();
  const rules = state.autoRules;
  const [activeRule, setActiveRule] = useState('');
  const [label, setLabel] = useState('');
  const [start, setStart] = useState('22:30');
  const [end, setEnd] = useState('07:00');
  const [tier, setTier] = useState<PowerTier>('SAVER');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    qiDevice.guard
      .getAutoRules()
      .then((info) => setActiveRule(info?.active ?? ''))
      .catch(() => undefined);
  }, [rules.length]);

  const canSave = useMemo(
    () => CLOCK.test(start) && CLOCK.test(end),
    [start, end],
  );

  const persist = async (next: AutoRule[]) => {
    setSaving(true);
    try {
      await setAutoRules(next);
      const info = await qiDevice.guard.getAutoRules().catch(() => null);
      setActiveRule(info?.active ?? '');
    } catch (error: any) {
      showToast(error?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const add = async () => {
    if (!canSave) {
      showToast('时间格式应为 HH:MM，例如 22:30');
      return;
    }
    const rule: AutoRule = {
      id: `rule_${Date.now().toString(36)}`,
      label: label.trim() || `${start}–${end}`,
      start,
      end,
      tier,
      enabled: true,
    };
    await persist([rule, ...rules]);
    setLabel('');
    showToast('规则已保存，到点自动生效哦');
  };

  const toggle = async (rule: AutoRule, enabled: boolean) => {
    await persist(rules.map((item) => (item.id === rule.id ? {...item, enabled} : item)));
  };

  const remove = async (rule: AutoRule) => {
    await persist(rules.filter((item) => item.id !== rule.id));
  };

  return (
    <View style={[styles.root, {backgroundColor: colors.background, paddingTop: insets.top}]}>
      <TopBar title="自动规则" onBack={onBack} />
      <ScrollView
        contentContainerStyle={{paddingHorizontal: 16, paddingBottom: insets.bottom + 28}}
        showsVerticalScrollIndicator={false}>
        <Text style={[type.caption, styles.intro, {color: colors.onSurfaceVariant}]}>
          到点会自动切换功耗档位哦
        </Text>

        {activeRule ? (
          <View style={[styles.activeBox, {backgroundColor: withAlpha(colors.primary, 0.12)}]}>
            <GlassIcon name="weatherNight" size={16} tone="onAccent" />
            <Text style={[type.caption, {color: colors.primary, flex: 1}]}>
              正在生效：{activeRule}
            </Text>
          </View>
        ) : null}

        <Text style={[type.section, styles.sectionTitle, {color: colors.onSurface}]}>新建规则</Text>
        <SoftCard style={styles.card}>
          <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>名称</Text>
          <TextInput
            accessibilityLabel="规则名称"
            value={label}
            onChangeText={setLabel}
            placeholder="例如：睡觉时间"
            placeholderTextColor={colors.onSurfaceVariant}
            style={[
              styles.input,
              {color: colors.onSurface, borderColor: colors.outline, marginBottom: 10},
            ]}
          />
          <View style={{flexDirection: 'row', gap: 10}}>
            <View style={{flex: 1}}>
              <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>开始</Text>
              <TextInput
                accessibilityLabel="开始时间"
                value={start}
                onChangeText={setStart}
                keyboardType="numbers-and-punctuation"
                style={[styles.input, {color: colors.onSurface, borderColor: colors.outline}]}
              />
            </View>
            <View style={{flex: 1}}>
              <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>结束</Text>
              <TextInput
                accessibilityLabel="结束时间"
                value={end}
                onChangeText={setEnd}
                keyboardType="numbers-and-punctuation"
                style={[styles.input, {color: colors.onSurface, borderColor: colors.outline}]}
              />
            </View>
          </View>
          <Text style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 12}]}>
            这段时间用哪一档
          </Text>
          <View style={styles.tierRow}>
            {TIERS.map((item) => {
              const active = tier === item.key;
              return (
                <View key={item.key} style={{flex: 1}}>
                  <FlatButton
                    label={item.label}
                    onPress={() => setTier(item.key)}
                    style={styles.tierButton}
                    backgroundColor={
                      active ? colors.primary : withAlpha(colors.primary, 0.12)
                    }
                    textColor={active ? colors.onPrimary : colors.primary}
                  />
                </View>
              );
            })}
          </View>
          <FlatButton
            label={saving ? '保存中…' : '保存规则'}
            onPress={add}
            disabled={saving || !canSave}
            style={{marginTop: 14}}
          />
        </SoftCard>

        <View style={styles.sectionRow}>
          <Text style={[type.section, {color: colors.onSurface}]}>已有规则</Text>
          <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>{rules.length} 条</Text>
        </View>

        {rules.length === 0 ? (
          <SoftCard style={[styles.card, {alignItems: 'center', paddingVertical: 28}]}>
            <GlassIcon name="weatherNight" size={26} tone="auto" />
            <Text style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 10}]}>
              还没有规则呢 晚上不用加省电规则嘛
            </Text>
          </SoftCard>
        ) : (
          rules.map((rule) => (
            <SoftCard key={rule.id} style={[styles.card, {marginBottom: 10}]}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
                <Text style={[type.bodyStrong, {color: colors.onSurface, flex: 1}]}>
                  {rule.label}
                </Text>
                <Switch
                  accessibilityLabel={`启用 ${rule.label}`}
                  value={rule.enabled}
                  onValueChange={(next) => toggle(rule, next)}
                  trackColor={{true: colors.primary, false: colors.outline}}
                />
              </View>
              <View style={[styles.metaRow, {marginTop: 8}]}>
                <Pill
                  text={`${rule.start}–${rule.end}`}
                  color={colors.onSurfaceVariant}
                  background={withAlpha(colors.onSurface, 0.06)}
                />
                <Pill
                  text={rule.tier === 'SAVER' ? '省电' : rule.tier === 'REALTIME' ? '实时' : '智能'}
                  color={colors.primary}
                  background={withAlpha(colors.primary, 0.12)}
                />
              </View>
              <Text
                accessibilityRole="button"
                accessibilityLabel={`删除 ${rule.label}`}
                onPress={() => remove(rule)}
                style={[type.caption, {color: colors.error, marginTop: 10}]}>
                删除
              </Text>
            </SoftCard>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  intro: {marginTop: 4, marginBottom: 8},
  sectionTitle: {marginTop: 20, marginBottom: 10},
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 22,
    marginBottom: 10,
  },
  card: {padding: 16},
  activeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    padding: 10,
    marginTop: 8,
  },
  input: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  tierRow: {flexDirection: 'row', gap: 8, marginTop: 8},
  tierButton: {height: 42},
  metaRow: {flexDirection: 'row', gap: 8},
});
