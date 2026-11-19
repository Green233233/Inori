/**
 * 主人端「应用限制」页。
 *
 * 这里只负责编辑一份名单：哪些应用不许小狗打开。真正的拦截发生在小狗手机上
 * （`AppLimitWatcher` + 常驻服务），所以本页不申请任何权限，也不轮询。名单的
 * 下发由主代理接到 relay（kind `app.limit`）后完成；`onSendRules` 是留给它的
 * 唯一出口，未接线时页面只保留本地编辑结果并如实提示。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {SoftCard} from '../../components/Surfaces';
import {TopBar} from '../../components/TopBar';
import {FlatButton} from '../../components/Ui';
import {qiLimits} from '../../native/QiLimits';
import type {AppLimitEntry, AppLimitRules} from '../../native/QiLimits';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {type} from '../../theme/typography';

export function AppLimitScreen({
  onBack,
  partnerName,
  onToast,
  onSendRules,
}: {
  onBack: () => void;
  partnerName: string;
  onToast: (msg: string) => void;
  onSendRules?: (rules: AppLimitRules) => void | Promise<void>;
}) {
  const {colors, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();

  const [enabled, setEnabled] = useState(true);
  const [entries, setEntries] = useState<AppLimitEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    qiLimits
      .getRules()
      .then(rules => {
        if (!alive) {
          return;
        }
        setEnabled(rules.enabled);
        setEntries(rules.blocked);
      })
      .catch(() => {
        // 旧 APK 没注册 QiLimits，或这是第一台设备：保持空名单即可，保存时会再提示。
      });
    return () => {
      alive = false;
    };
  }, []);

  const add = useCallback(async () => {
    const pkg = draft.trim();
    if (!pkg || adding) {
      return;
    }
    if (entries.some(entry => entry.pkg === pkg)) {
      onToast('这个应用已经在名单里');
      return;
    }
    setAdding(true);
    try {
      // 只查这一个包，拿不到就退回包名，绝不做全量枚举。
      const resolved = await qiLimits.resolveLabel(pkg);
      setEntries(prev =>
        prev.some(entry => entry.pkg === pkg)
          ? prev
          : [...prev, {pkg, label: resolved.label}],
      );
      setDraft('');
      if (!resolved.installed) {
        onToast('这台设备上没找到该应用，已按包名添加');
      }
    } catch {
      setEntries(prev =>
        prev.some(entry => entry.pkg === pkg)
          ? prev
          : [...prev, {pkg, label: pkg}],
      );
      setDraft('');
      onToast('读取应用名失败，已按包名添加');
    } finally {
      setAdding(false);
    }
  }, [adding, draft, entries, onToast]);

  const remove = useCallback((pkg: string) => {
    setEntries(prev => prev.filter(entry => entry.pkg !== pkg));
  }, []);

  const save = useCallback(async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    const rules: AppLimitRules = {enabled, blocked: entries, updatedAt: 0};
    try {
      if (onSendRules) {
        await onSendRules(rules);
        onToast('已保存，正在下发给小狗端');
      } else {
        onToast('已保存，等待下发给小狗端');
      }
    } catch (error) {
      onToast(
        error instanceof Error && error.message
          ? error.message
          : '下发失败，请稍后重试',
      );
    } finally {
      setSaving(false);
    }
  }, [enabled, entries, onSendRules, onToast, saving]);

  return (
    <View style={[styles.root, {backgroundColor: colors.background}]}>
      <TopBar title="应用限制" onBack={onBack} />
      <ScrollView
        contentContainerStyle={{
          padding: tokens.contentPadding,
          paddingBottom: insets.bottom + 40,
        }}
        keyboardShouldPersistTaps="handled">
        <SoftCard>
          <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
            关于这条限制
          </Text>
          <Text
            style={[
              type.caption,
              styles.paragraph,
              {color: colors.onSurfaceVariant},
            ]}>
            这段名单由你决定；小狗打开名单里的应用时，会被它自己手机上的全屏提示挡住。它随时可以在权限管控中心关掉这条限制。
          </Text>
        </SoftCard>

        <SoftCard style={styles.cardSpacing}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
                限制开关
              </Text>
              <Text
                style={[
                  type.caption,
                  styles.rowCaption,
                  {color: colors.onSurfaceVariant},
                ]}>
                关闭后名单仍然保留，但不会再拦截。
              </Text>
            </View>
            <Switch
              accessibilityLabel="应用限制总开关"
              value={enabled}
              onValueChange={setEnabled}
              trackColor={{true: colors.primary, false: colors.outline}}
            />
          </View>
        </SoftCard>

        <Text
          style={[
            type.section,
            styles.sectionTitle,
            {color: colors.onSurface},
          ]}>
          选择要禁止的应用
        </Text>
        <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
          暂时需要手动输入包名添加（例如 com.tencent.mm），下发给 {partnerName}{' '}
          后由它的手机执行拦截。
        </Text>

        <View style={styles.addRow}>
          <TextInput
            accessibilityLabel="要禁止的应用包名"
            value={draft}
            onChangeText={setDraft}
            placeholder="com.example.app"
            placeholderTextColor={colors.onSurfaceVariant}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={add}
            style={[
              styles.input,
              {color: colors.onSurface, borderColor: colors.outline},
            ]}
          />
          <FlatButton
            label={adding ? '添加中…' : '添加'}
            onPress={add}
            disabled={adding || !draft.trim()}
            style={styles.addButton}
          />
        </View>

        <SoftCard style={styles.cardSpacing}>
          {entries.length === 0 ? (
            <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
              还没有添加应用。
            </Text>
          ) : (
            entries.map((entry, index) => (
              <View
                key={entry.pkg}
                style={[
                  styles.entryRow,
                  index > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: colors.outline,
                  },
                ]}>
                <View style={styles.rowText}>
                  <Text
                    numberOfLines={1}
                    style={[type.bodyStrong, {color: colors.onSurface}]}>
                    {entry.label}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      type.caption,
                      styles.rowCaption,
                      {color: colors.onSurfaceVariant},
                    ]}>
                    {entry.pkg}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`移除 ${entry.label}`}
                  hitSlop={10}
                  onPress={() => remove(entry.pkg)}>
                  <Text style={[type.label, {color: colors.primary}]}>移除</Text>
                </Pressable>
              </View>
            ))
          )}
        </SoftCard>

        <FlatButton
          label={saving ? '保存中…' : '保存并下发'}
          onPress={save}
          disabled={saving}
          style={styles.saveButton}
        />
        <Text
          style={[
            type.caption,
            styles.footnote,
            {color: colors.onSurfaceVariant},
          ]}>
          {enabled
            ? `已启用 · 名单 ${entries.length} 个应用`
            : `已停用 · 名单保留 ${entries.length} 个应用`}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  cardSpacing: {marginTop: 12},
  paragraph: {marginTop: 6},
  sectionTitle: {marginTop: 24, marginBottom: 4},
  row: {flexDirection: 'row', alignItems: 'center'},
  rowText: {flex: 1, paddingRight: 12},
  rowCaption: {marginTop: 3},
  addRow: {flexDirection: 'row', alignItems: 'center', marginTop: 12},
  input: {
    flex: 1,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  addButton: {marginLeft: 10, width: 88},
  entryRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 10},
  saveButton: {marginTop: 24},
  footnote: {marginTop: 10, textAlign: 'center'},
});
