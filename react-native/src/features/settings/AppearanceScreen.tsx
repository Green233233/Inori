/**
 * 小狗端「装扮」：只改自己的观感与桌面小组件，不碰权限、不上传任何东西。
 *
 * 头像光环配色会同时用在「我的」页头；问候语出现在主页顶部；小组件文案会推一次
 * RemoteViews，所以改完回桌面就能看到。
 */
import React, {useState} from 'react';
import {ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {withAlpha} from '../../theme/palette';
import {type} from '../../theme/typography';
import {RoleAvatar} from '../../components/RoleAvatar';
import {SoftCard} from '../../components/Surfaces';
import {FlatButton} from '../../components/Ui';
import {TopBar} from '../../components/TopBar';
import {showToast} from '../../components/toast';
import {useQi} from '../qi/QiProvider';
import type {Appearance} from '../../data/pairTypes';

const FRAMES: {key: Appearance['frame']; label: string; color: string | null}[] = [
  {key: 'default', label: '默认', color: null},
  {key: 'rose', label: '玫瑰', color: '#FF5C8A'},
  {key: 'mint', label: '薄荷', color: '#31D0AA'},
  {key: 'gold', label: '暖金', color: '#F2B544'},
];

export function AppearanceScreen({onBack}: {onBack: () => void}) {
  const {colors} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {state, setAppearance} = useQi();
  const current = state.appearance;
  const [frame, setFrame] = useState<Appearance['frame']>(current.frame);
  const [greeting, setGreeting] = useState(current.greeting);
  const [widgetTitle, setWidgetTitle] = useState(current.widgetTitle);
  const [widgetBody, setWidgetBody] = useState(current.widgetBody);
  const [saving, setSaving] = useState(false);

  const frameColor = FRAMES.find((item) => item.key === frame)?.color ?? null;
  const ringColor = frameColor ? withAlpha(frameColor, 0.85) : withAlpha(colors.onSurface, 0.25);

  const save = async () => {
    setSaving(true);
    try {
      await setAppearance({
        frame,
        greeting: greeting.trim(),
        widgetTitle: widgetTitle.trim() || '祈',
        widgetBody: widgetBody.trim() || '打开祈完成联结吧',
      });
      showToast('装扮已保存');
    } catch (error: any) {
      showToast(error?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.root, {backgroundColor: colors.background, paddingTop: insets.top}]}>
      <TopBar title="装扮" onBack={onBack} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 28,
        }}
        showsVerticalScrollIndicator={false}>
        <Text style={[type.caption, styles.intro, {color: colors.onSurfaceVariant}]}>
          这只对你自己有效哦 主人看不到
        </Text>

        <SoftCard style={[styles.card, {alignItems: 'center'}]}>
          <RoleAvatar
            role={state.pair?.myRole ?? 'PUPPY'}
            name={state.displayName ?? state.username ?? ''}
            size={92}
            avatarStyle={state.avatarStyle}
            imageUri={state.avatarImagePath}
            ringColor={ringColor}
            onColor={colors.onSurface}
          />
          <Text style={[type.bodyStrong, {color: colors.onSurface, marginTop: 12}]}>
            {state.displayName ?? state.username ?? '小狗'}
          </Text>
          <Text style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 4}]}>
            {greeting.trim() || '有啥想对自己说的嘛'}
          </Text>
        </SoftCard>

        <Text style={[type.section, styles.sectionTitle, {color: colors.onSurface}]}>头像光环</Text>
        <SoftCard style={styles.card}>
          <View style={styles.frameRow}>
            {FRAMES.map((item) => {
              const active = frame === item.key;
              const color = item.color ?? withAlpha(colors.onSurface, 0.25);
              return (
                <View key={item.key} style={styles.frameItem}>
                  <Text
                    accessibilityRole="button"
                    accessibilityLabel={`头像光环 ${item.label}`}
                    onPress={() => setFrame(item.key)}
                    style={[
                      styles.frameDot,
                      {
                        backgroundColor: withAlpha(color, active ? 0.9 : 0.25),
                        borderColor: active ? colors.onSurface : 'transparent',
                      },
                    ]}
                  />
                  <Text style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 6}]}>
                    {item.label}
                  </Text>
                </View>
              );
            })}
          </View>
        </SoftCard>

        <Text style={[type.section, styles.sectionTitle, {color: colors.onSurface}]}>主页问候</Text>
        <SoftCard style={styles.card}>
          <TextInput
            accessibilityLabel="主页问候语"
            value={greeting}
            onChangeText={setGreeting}
            maxLength={40}
            placeholder="今天也乖乖的"
            placeholderTextColor={colors.onSurfaceVariant}
            style={[styles.input, {color: colors.onSurface, borderColor: colors.outline}]}
          />
          <Text style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 8}]}>
            显示在主页顶部，只有你能看到。
          </Text>
        </SoftCard>

        <Text style={[type.section, styles.sectionTitle, {color: colors.onSurface}]}>
          桌面小组件
        </Text>
        <SoftCard style={styles.card}>
          <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>标题</Text>
          <TextInput
            accessibilityLabel="小组件标题"
            value={widgetTitle}
            onChangeText={setWidgetTitle}
            maxLength={16}
            placeholder="祈"
            placeholderTextColor={colors.onSurfaceVariant}
            style={[
              styles.input,
              {color: colors.onSurface, borderColor: colors.outline, marginTop: 6},
            ]}
          />
          <Text style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 12}]}>副标题</Text>
          <TextInput
            accessibilityLabel="小组件副标题"
            value={widgetBody}
            onChangeText={setWidgetBody}
            maxLength={40}
            placeholder="打开祈完成联结吧"
            placeholderTextColor={colors.onSurfaceVariant}
            style={[
              styles.input,
              {color: colors.onSurface, borderColor: colors.outline, marginTop: 6},
            ]}
          />
          <View
            style={[
              styles.widgetPreview,
              {backgroundColor: withAlpha(colors.onSurface, 0.05), marginTop: 14},
            ]}>
            <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
              {widgetTitle.trim() || '祈'}
            </Text>
            <Text style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 4}]}>
              {widgetBody.trim() || '打开祈完成联结吧'}
            </Text>
          </View>
        </SoftCard>

        <FlatButton
          label={saving ? '保存中…' : '保存装扮'}
          onPress={save}
          disabled={saving}
          style={{marginTop: 22}}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  intro: {marginTop: 4, marginBottom: 10},
  sectionTitle: {marginTop: 20, marginBottom: 10},
  card: {padding: 16},
  frameRow: {flexDirection: 'row', justifyContent: 'space-between'},
  frameItem: {alignItems: 'center', flex: 1},
  frameDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
  },
  input: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  widgetPreview: {borderRadius: 14, padding: 12},
});
