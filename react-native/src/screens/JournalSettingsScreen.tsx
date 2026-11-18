/**
 * 日记设置：从「设置」搬进日记板块。
 * 只放和写日记有关的三项——字号、默认字体、默认笔刷，
 * 打开编辑器时直接使用这里的默认值。
 */
import React, {useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {withAlpha} from '../theme/palette';
import {type} from '../theme/typography';
import {GlassIcon} from '../components/GlassIcon';
import {TopBar} from '../components/TopBar';
import {AppSheet, Divider} from '../components/Ui';
import {SoftCard} from '../components/Surfaces';
import {showToast} from '../components/toast';
import {
  AppSettings,
  DefaultBrush,
  DefaultFont,
} from '../data/types';

const FONT_SIZES = [
  {label: '小', value: 14, hint: '一屏能放下更多字'},
  {label: '中', value: 16, hint: '默认，大多数人刚好'},
  {label: '大', value: 18, hint: '看久了不费眼睛'},
  {label: '特大', value: 20, hint: '手写体也能看清'},
];

const FONT_FAMILIES: {label: string; value: DefaultFont; hint: string}[] = [
  {label: '衬线', value: 'serif', hint: '像纸书，正文默认'},
  {label: '无衬线', value: 'sans', hint: '干净利落，偏现代'},
  {label: '圆体', value: 'round', hint: '圆润，适合短句与便签'},
];

const BRUSHES: {label: string; value: DefaultBrush; hint: string}[] = [
  {label: '钢笔', value: 'pen', hint: '细而稳，适合写字'},
  {label: '马克笔', value: 'marker', hint: '粗而亮，适合标重点'},
  {label: '铅笔', value: 'pencil', hint: '轻而有颗粒感'},
];

export function JournalSettingsScreen({
  settings,
  onChange,
  onBack,
}: {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  onBack: () => void;
}) {
  const {colors, tokens} = useAppTheme();
  const [sheet, setSheet] = useState<'size' | 'font' | 'brush' | null>(null);

  const update = (patch: Partial<AppSettings>) => {
    onChange({...settings, ...patch});
  };

  const fontLabel =
    FONT_FAMILIES.find(item => item.value === settings.defaultFont)?.label ??
    '衬线';
  const brushLabel =
    BRUSHES.find(item => item.value === settings.defaultBrush)?.label ?? '钢笔';

  return (
    <View style={styles.root}>
      <TopBar title="日记设置" onBack={onBack} titleSize={26} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[type.body, {color: colors.onSurfaceVariant}]}>
          这些只影响你写日记时的样子，不会改到已经写好的内容。
        </Text>

        <SoftCard style={styles.card}>
          <Row
            label="字体大小"
            value={`${settings.fontSize}sp`}
            onPress={() => setSheet('size')}
          />
          <Divider color={withAlpha(colors.outline, 0.3)} />
          <Row
            label="默认字体"
            value={fontLabel}
            onPress={() => setSheet('font')}
          />
          <Divider color={withAlpha(colors.outline, 0.3)} />
          <Row
            label="默认笔刷"
            value={brushLabel}
            onPress={() => setSheet('brush')}
          />
        </SoftCard>

        <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
          新开的日记会用这里的默认值；已有的日记保留原来的样子。
        </Text>
      </ScrollView>

      <AppSheet
        visible={sheet === 'size'}
        title="字体大小"
        onClose={() => setSheet(null)}>
        {FONT_SIZES.map(item => (
          <Row
            key={item.value}
            label={item.label}
            subtitle={item.hint}
            value={settings.fontSize === item.value ? '已选' : ''}
            onPress={() => {
              update({fontSize: item.value});
              setSheet(null);
              showToast(`字体大小已设置为 ${item.value}sp`);
            }}
          />
        ))}
      </AppSheet>

      <AppSheet
        visible={sheet === 'font'}
        title="默认字体"
        onClose={() => setSheet(null)}>
        {FONT_FAMILIES.map(item => (
          <Row
            key={item.value}
            label={item.label}
            subtitle={item.hint}
            value={settings.defaultFont === item.value ? '已选' : ''}
            onPress={() => {
              update({defaultFont: item.value});
              setSheet(null);
              showToast(`默认字体已设为${item.label}`);
            }}
          />
        ))}
      </AppSheet>

      <AppSheet
        visible={sheet === 'brush'}
        title="默认笔刷"
        onClose={() => setSheet(null)}>
        {BRUSHES.map(item => (
          <Row
            key={item.value}
            label={item.label}
            subtitle={item.hint}
            value={settings.defaultBrush === item.value ? '已选' : ''}
            onPress={() => {
              update({defaultBrush: item.value});
              setSheet(null);
              showToast(`默认笔刷已设为${item.label}`);
            }}
          />
        ))}
      </AppSheet>
    </View>
  );
}

function Row({
  label,
  subtitle,
  value,
  onPress,
}: {
  label: string;
  subtitle?: string;
  value?: string;
  onPress: () => void;
}) {
  const {colors} = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.row}>
      <View style={styles.rowText}>
        <Text style={[type.body, {color: colors.onSurface}]}>{label}</Text>
        {subtitle ? (
          <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
          {value}
        </Text>
      ) : null}
      <GlassIcon name="chevronRight" size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  body: {padding: 16, gap: 12},
  card: {paddingVertical: 4},
  row: {
    minHeight: 56,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowText: {flex: 1, gap: 2},
});

export default JournalSettingsScreen;
