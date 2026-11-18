/**
 * 使用前同意门（一次性）。
 *
 * 明确知情同意、可随时撤回、以及截屏分档的差别；同时提供「仅使用日记」，
 * 保证升级到 v0.6.0 的老用户不会被新流程锁死。
 */
import React, {useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {type} from '../../theme/typography';
import {GlassIcon} from '../../components/GlassIcon';
import {SoftCard} from '../../components/Surfaces';
import {FlatButton, TextButton} from '../../components/Ui';
import {useQi} from '../qi/QiProvider';

const ITEMS = [
  '我已年满 18 岁，且双方均为成年人。',
  '这是双方完全自愿、知情同意的亲密关系角色扮演互动；任何一方随时可以撤回授权或解除绑定。',
  '我不会用它限制他人人身自由、监控不同意的人，或侵犯任何人的隐私。',
  '我理解受控端（小狗端）始终可以自行撤回权限与解除绑定，主人端无法远程阻止或恢复。',
  '我理解截屏规则：Android 13 及以下，开启「随时查看屏幕」后主人截屏只会通知我；Android 14 及以上，每次都需要我确认。',
];

export function ConsentGate() {
  const {colors, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {acceptConsent, chooseJournalOnly, busy, error} = useQi();
  const [checked, setChecked] = useState<boolean[]>(ITEMS.map(() => false));
  const allChecked = checked.every(Boolean);

  const toggle = (index: number) => {
    setChecked(previous =>
      previous.map((value, position) => (position === index ? !value : value)),
    );
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{
          padding: tokens.contentPadding,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 32,
        }}
        showsVerticalScrollIndicator={false}>
        <Text style={[type.display, {color: colors.onSurface}]}>祈</Text>
        <Text style={[type.body, styles.intro, {color: colors.onSurfaceVariant}]}>
          在开始联结之前，请先读完这几条。它们不是形式，是这个功能的安全边界。
        </Text>

        <SoftCard radius={18} style={styles.card}>
          {ITEMS.map((item, index) => {
            const active = checked[index];
            return (
              <Pressable
                key={item}
                accessibilityRole="checkbox"
                accessibilityState={{checked: active}}
                accessibilityLabel={item}
                onPress={() => toggle(index)}
                style={({pressed}) => [
                  styles.row,
                  index > 0
                    ? {borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.outline}
                    : null,
                  {opacity: pressed ? 0.75 : 1},
                ]}>
                <View
                  style={[
                    styles.box,
                    {
                      borderColor: active ? colors.primary : colors.outline,
                      backgroundColor: active ? colors.primary : 'transparent',
                    },
                  ]}>
                  {active ? <GlassIcon name="check" size={16} tone="onAccent" /> : null}
                </View>
                <Text style={[type.body, styles.rowText, {color: colors.onSurface}]}>
                  {item}
                </Text>
              </Pressable>
            );
          })}
        </SoftCard>

        <Text style={[type.caption, styles.note, {color: colors.onSurfaceVariant}]}>
          联结后的日记与消息使用端到端加密，服务器只保存密文；和好券的卡密由服务器签名，属于唯一的例外。
        </Text>

        {error ? (
          <Text style={[type.caption, {color: colors.error, marginTop: 12}]}>
            {error}
          </Text>
        ) : null}

        <FlatButton
          label="同意并继续"
          onPress={() => {
            acceptConsent().catch(() => undefined);
          }}
          disabled={!allChecked || busy}
          style={styles.primary}
        />
        <TextButton
          label="仅使用日记（不联结）"
          onPress={() => {
            chooseJournalOnly().catch(() => undefined);
          }}
          style={styles.secondary}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  intro: {marginTop: 8, marginBottom: 18},
  card: {paddingVertical: 2},
  row: {flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 14},
  rowText: {flex: 1, marginLeft: 12},
  box: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  note: {marginTop: 14},
  primary: {marginTop: 22},
  secondary: {alignSelf: 'center', marginTop: 14},
});
