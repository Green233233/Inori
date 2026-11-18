import React, {useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {withAlpha} from '../theme/palette';
import {type} from '../theme/typography';
import {GlassIcon} from '../components/GlassIcon';
import {TopBar} from '../components/TopBar';
import {AppDialog, AppSheet, Divider, TextButton} from '../components/Ui';
import {
  UI_SCALE_LABEL,
  UI_SCALE_ORDER,
  applyUiScale,
  type UiScale,
} from '../theme/uiScale';
import {SoftCard} from '../components/Surfaces';
import {RoleAvatar} from '../components/RoleAvatar';
import {useQi} from '../features/qi/QiProvider';
import {showToast} from '../components/toast';
import {native, joinPath, paths} from '../native/InorinalNative';
import {
  AppSettings,
  COLOR_STYLE_LABEL,
  COLOR_STYLE_ORDER,
  ColorStyle,
  THEME_MODE_LABEL,
  THEME_MODE_ORDER,
  ThemeMode,
} from '../data/types';
import {clearLogs, setDebugEnabled} from '../debug/logger';
import {logEvent} from '../debug/logger';

export function SettingsScreen({
  settings,
  onChange,
  onBack,
}: {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  onBack: () => void;
}) {
  const {colors, tokens} = useAppTheme();
  const {state, role, updateProfile, renameSelf} = useQi();
  const [profileOpen, setProfileOpen] = useState(false);
  const [nickDraft, setNickDraft] = useState('');
  const [styleSheetOpen, setStyleSheetOpen] = useState(false);
  const [themeSheetOpen, setThemeSheetOpen] = useState(false);
  const [scaleSheetOpen, setScaleSheetOpen] = useState(false);
  const [debugDialogOpen, setDebugDialogOpen] = useState(false);
  const [cacheDialogOpen, setCacheDialogOpen] = useState(false);

  const update = (patch: Partial<AppSettings>) => {
    onChange({...settings, ...patch});
  };

  const comingSoon = (message: string) => () => showToast(message);

  return (
    <View style={styles.root}>
      <TopBar title="设置" onBack={onBack} titleSize={28} />

      <AppSheet
        visible={profileOpen}
        title="昵称与头像"
        onClose={() => setProfileOpen(false)}
        footer={
          <TextButton
            label="保存昵称"
            onPress={() => {
              const nextName = nickDraft.trim();
              // 昵称与绑定名是同一个值：有配对就按自己角色改名，没配对只改本地。
              const task = nextName
                ? renameSelf(nextName)
                : Promise.resolve();
              task
                .then(() => updateProfile({displayName: nextName || null}))
                .then(() => showToast('昵称已保存'))
                .catch((error: any) =>
                  showToast(error?.message ?? '昵称保存失败'),
                );
              setProfileOpen(false);
            }}
          />
        }>
        <View style={{alignItems: 'center', marginBottom: 16}}>
          <RoleAvatar
            role={role}
            name={state.displayName || state.username || undefined}
            size={88}
            avatarStyle={state.avatarStyle}
            imageUri={
              state.avatarImagePath ? `file://${state.avatarImagePath}` : null
            }
            ringColor={colors.primary}
            onColor={colors.onSurface}
          />
        </View>
        <Text style={[type.label, {color: colors.onSurfaceVariant}]}>昵称</Text>
        <TextInput
          value={nickDraft}
          onChangeText={setNickDraft}
          placeholder={state.username ?? '主人 / 小狗'}
          placeholderTextColor={colors.onSurfaceVariant}
          accessibilityLabel="昵称"
          maxLength={24}
          style={[
            styles.profileInput,
            {
              color: colors.onSurface,
              borderColor: colors.outline,
              backgroundColor: colors.surface,
            },
          ]}
        />
        <Text
          style={[
            type.label,
            {color: colors.onSurfaceVariant, marginTop: 16},
          ]}>
          头像
        </Text>
        {(['role', 'initial', 'photo'] as const).map(option => {
          const label =
            option === 'role'
              ? '角色剪影（主人 / 小狗）'
              : option === 'initial'
                ? '名字首字'
                : '相册照片';
          const active = state.avatarStyle === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{selected: active}}
              accessibilityLabel={label}
              onPress={() => {
                if (option === 'photo') {
                  native
                    .pickImage(200000, false)
                    .then(async picked => {
                      if (!picked?.base64) {
                        return;
                      }
                      await native
                        .makeDir(joinPath(paths.files, 'qi'))
                        .catch(() => false);
                      const path = joinPath(paths.files, 'qi', 'avatar.png');
                      await native.writeBase64(path, picked.base64);
                      await updateProfile({
                        avatarStyle: 'photo',
                        avatarImagePath: path,
                      });
                    })
                    .catch((error: any) =>
                      showToast(error?.message ?? '选择照片失败'),
                    );
                  return;
                }
                updateProfile({avatarStyle: option}).catch(() => undefined);
              }}
              style={styles.profileOption}>
              <Text style={[type.body, {color: colors.onSurface}]}>{label}</Text>
              <View
                style={[
                  styles.radio,
                  {
                    borderColor: active ? colors.primary : colors.outline,
                    backgroundColor: active ? colors.primary : 'transparent',
                  },
                ]}
              />
            </Pressable>
          );
        })}
      </AppSheet>

      <ScrollView
        contentContainerStyle={{
          padding: tokens.contentPadding,
          paddingTop: 8,
          paddingBottom: 40,
        }}>
        <Group title="个人资料">
          <Row
            label="昵称"
            value={
              state.displayName ||
              (role === 'MASTER' ? state.pair?.ownerName : state.pair?.puppyName) ||
              state.username ||
              '未设置'
            }
            onPress={() => {
              setNickDraft(
                state.displayName ??
                  (role === 'MASTER'
                    ? state.pair?.ownerName ?? ''
                    : state.pair?.puppyName ?? ''),
              );
              setProfileOpen(true);
            }}
          />
          <Divider color={withAlpha(colors.outline, 0.3)} />
          <Row
            label="头像"
            value={
              state.avatarStyle === 'photo'
                ? '相册照片'
                : state.avatarStyle === 'initial'
                  ? '名字首字'
                  : '角色剪影'
            }
            onPress={() => setProfileOpen(true)}
          />
        </Group>

        <Group title="界面设置">
          <Row
            label="颜色风格"
            value={COLOR_STYLE_LABEL[settings.colorStyle]}
            onPress={() => setStyleSheetOpen(true)}
          />
          <Divider color={withAlpha(colors.outline, 0.3)} />
          <Row
            label="主题模式"
            value={THEME_MODE_LABEL[settings.themeMode]}
            onPress={() => setThemeSheetOpen(true)}
          />
          <Divider color={withAlpha(colors.outline, 0.3)} />
          <Row
            label="显示大小"
            value={UI_SCALE_LABEL[settings.uiScale]}
            onPress={() => setScaleSheetOpen(true)}
          />
          <Divider color={withAlpha(colors.outline, 0.3)} />
          <Row
            label="卡片样式"
            onPress={comingSoon('卡片样式功能即将上线')}
          />
        </Group>

        <Group title="日记">
          <Row
            label="日记设置"
            value="在日记页修改"
            onPress={() => showToast('到「日记」页右上角的齿轮里修改')}
          />
        </Group>

        <Group title="隐私设置">
          <Row
            label="应用锁"
            onPress={comingSoon('应用锁功能即将上线，敬请期待')}
          />
          <Divider color={withAlpha(colors.outline, 0.3)} />
          <Row
            label="隐藏敏感内容"
            onPress={comingSoon('隐藏敏感内容功能即将上线')}
          />
        </Group>

        <Group title="开发者">
          <View style={styles.switchRow}>
            <View style={styles.switchTextWrap}>
              <Text style={[styles.rowLabel, {color: colors.onSurface}]}>
                调试模式
              </Text>
              <Text
                style={[
                  styles.rowSubtitle,
                  {color: colors.onSurfaceVariant},
                ]}>
                自动记录日志，便于开发与调试
              </Text>
            </View>
            <Switch
              value={settings.debugMode}
              onValueChange={value => {
                if (value) {
                  setDebugDialogOpen(true);
                } else {
                  update({debugMode: false});
                  setDebugEnabled(false);
                  clearLogs().then(() =>
                    showToast('调试模式已关闭，已有日志将被删除'),
                  );
                }
              }}
              trackColor={{
                false: withAlpha(colors.outline, 0.6),
                true: colors.primary,
              }}
              thumbColor="#FFFFFF"
              ios_backgroundColor={withAlpha(colors.outline, 0.6)}
            />
          </View>
          <Divider color={withAlpha(colors.outline, 0.3)} />
          <Row
            label="删除调试日志"
            onPress={() => {
              clearLogs().then(() => showToast('调试日志已删除'));
            }}
          />
        </Group>

        <Group title="其他">
          <Row
            label="清除缓存"
            onPress={() => setCacheDialogOpen(true)}
          />
        </Group>
      </ScrollView>

      <AppSheet
        visible={styleSheetOpen}
        title="颜色风格"
        onClose={() => setStyleSheetOpen(false)}>
        <View style={{gap: 6}}>
          {COLOR_STYLE_ORDER.map(option => (
            <OptionRow
              key={option}
              label={COLOR_STYLE_LABEL[option]}
              selected={settings.colorStyle === option}
              onPress={() => {
                update({colorStyle: option as ColorStyle});
                setStyleSheetOpen(false);
              }}
            />
          ))}
        </View>
      </AppSheet>

      <AppSheet
        visible={themeSheetOpen}
        title="主题模式"
        onClose={() => setThemeSheetOpen(false)}>
        <View style={{gap: 6}}>
          {THEME_MODE_ORDER.map(option => (
            <OptionRow
              key={option}
              label={THEME_MODE_LABEL[option]}
              selected={settings.themeMode === option}
              onPress={() => {
                update({themeMode: option as ThemeMode});
                setThemeSheetOpen(false);
              }}
            />
          ))}
        </View>
      </AppSheet>

      <AppSheet
        visible={scaleSheetOpen}
        title="显示大小"
        onClose={() => setScaleSheetOpen(false)}>
        <View style={{gap: 6}}>
          {UI_SCALE_ORDER.map(option => (
            <OptionRow
              key={option}
              label={UI_SCALE_LABEL[option]}
              selected={settings.uiScale === option}
              onPress={() => {
                applyUiScale(option as UiScale);
                update({uiScale: option as UiScale});
                setScaleSheetOpen(false);
                showToast('显示大小已更新');
              }}
            />
          ))}
        </View>
      </AppSheet>

      <AppDialog
        visible={debugDialogOpen}
        title="开启调试模式"
        message="开启后应用会自动记录运行日志，可能会降低运行速度并增大应用所占磁盘空间。日志只记录技术事件和脱敏后的崩溃堆栈，不记录日记标题、正文或搜索内容；单个日志文件最大 2 MB，最多保留 7 天。日志会保存到应用专属目录。是否继续？"
        confirmLabel="继续"
        onConfirm={() => {
          setDebugDialogOpen(false);
          update({debugMode: true});
          setDebugEnabled(true);
          logEvent('DEBUG_ENABLED');
          const logPath = joinPath(paths.logs, '');
          showToast(`调试模式已开启，日志保存于：${logPath}`);
        }}
        dismissLabel="取消"
        onDismiss={() => setDebugDialogOpen(false)}
      />

      <AppDialog
        visible={cacheDialogOpen}
        title="清除缓存"
        message="确定要清除应用缓存吗？这不会删除你的日记数据。"
        confirmLabel="清除"
        onConfirm={() => {
          setCacheDialogOpen(false);
          native
            .clearCache()
            .then(() => showToast('缓存已清除'))
            .catch((error: any) =>
              showToast(`清除失败: ${error?.message ?? '未知错误'}`),
            );
        }}
        dismissLabel="取消"
        onDismiss={() => setCacheDialogOpen(false)}
      />
    </View>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const {colors} = useAppTheme();
  return (
    <View style={{marginBottom: 24}}>
      <Text style={[styles.groupTitle, {color: colors.onSurfaceVariant}]}>
        {title}
      </Text>
      <SoftCard radius={16} style={styles.groupCard}>
        {children}
      </SoftCard>
    </View>
  );
}

function Row({
  label,
  value,
  onPress,
}: {
  label: string;
  value?: string;
  onPress: () => void;
}) {
  const {colors} = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.row,
        pressed && {backgroundColor: withAlpha(colors.primary, 0.05)},
      ]}>
      <Text style={[styles.rowLabel, {color: colors.onSurface}]}>{label}</Text>
      {value !== undefined ? (
        <Text style={[styles.rowValue, {color: colors.onSurfaceVariant}]}>
          {value}
        </Text>
      ) : null}
      <GlassIcon name="chevronRight" size={22} />
    </Pressable>
  );
}

function OptionRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const {colors} = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.optionRow,
        pressed && {backgroundColor: withAlpha(colors.primary, 0.06)},
      ]}>
      <Text style={[styles.rowLabel, {color: colors.onSurface, flex: 1}]}>
        {label}
      </Text>
      <GlassIcon name={selected ? 'check' : 'circle'} size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  groupTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 8,
    paddingLeft: 4,
    opacity: 0.9,
  },
  groupCard: {borderRadius: 16, overflow: 'hidden'},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 8,
  },
  rowLabel: {fontSize: 15, flex: 1, fontWeight: '500'},
  rowValue: {fontSize: 14},
  rowSubtitle: {fontSize: 12, marginTop: 2},
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  switchTextWrap: {flex: 1},
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 13,
    borderRadius: 10,
  },
  sheetFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 6,
  },
  profileInput: {
    marginTop: 6,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  profileOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
  },
});
