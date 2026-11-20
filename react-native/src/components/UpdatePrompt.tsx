/**
 * 应用更新提示。
 *
 * 两处入口共用同一个弹层：
 *  - `<UpdatePrompt />` 挂在主界面根部，每次启动静默查一次，有新版才弹；
 *  - 关于页的「检查更新」按钮手动查，没新版就走 toast。
 *
 * 升级包放在网盘/Release，客户端只负责用系统浏览器打开链接，不做应用内下载。
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Linking, StyleSheet, Text, View} from 'react-native';
import {AppSheet, FlatButton, TextButton} from './Ui';
import {useAppTheme} from '../theme/AppThemeProvider';
import {type} from '../theme/typography';
import {showToast} from './toast';
import {checkForUpdate, type UpdateCheckResult} from '../api/appUpdate';

/** 更新日志是服务端下发的轻量 markdown：只认 `###` 标题与 `- ` 列表。 */
function UpdateNotes({notes}: {notes: string}) {
  const {colors} = useAppTheme();
  const lines = notes.split('\n').filter(line => line.trim().length > 0);
  if (lines.length === 0) {
    return (
      <Text style={[type.body, {color: colors.onSurfaceVariant}]}>
        新版本已经准备好啦，升级后就能用上。
      </Text>
    );
  }
  return (
    <View style={styles.notes}>
      {lines.map((line, index) => {
        const heading = line.match(/^#{1,6}\s+(.*)$/);
        if (heading) {
          return (
            <Text
              key={`h-${index}`}
              style={[type.headline, styles.heading, {color: colors.onSurface}]}>
              {heading[1]}
            </Text>
          );
        }
        const bullet = line.match(/^[-*]\s+(.*)$/);
        return (
          <View key={`l-${index}`} style={styles.noteRow}>
            {bullet ? (
              <View style={[styles.dot, {backgroundColor: colors.primary}]} />
            ) : null}
            <Text
              style={[
                type.body,
                styles.noteText,
                {color: colors.onSurfaceVariant},
              ]}>
              {bullet ? bullet[1] : line}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function UpdateSheet({
  visible,
  update,
  onClose,
}: {
  visible: boolean;
  update: UpdateCheckResult | null;
  onClose: () => void;
}) {
  const {colors} = useAppTheme();
  const force = update?.force === true;

  const onUpgrade = useCallback(() => {
    const url = update?.downloadUrl.trim() ?? '';
    if (!url) {
      showToast('服务器还没给下载地址，稍后再试');
      return;
    }
    Linking.openURL(url).catch(() => showToast('打不开下载链接，稍后再试'));
  }, [update?.downloadUrl]);

  return (
    <AppSheet
      visible={visible}
      title={update ? `发现新版本 ${update.version}` : '应用更新'}
      // 强制更新时连返回键也不放行，只能点「现在升级」。
      onClose={force ? () => undefined : onClose}
      footer={
        <View style={styles.actions}>
          <FlatButton
            label="现在升级"
            onPress={onUpgrade}
            style={styles.upgrade}
          />
          {force ? null : (
            <TextButton
              label="以后再说"
              onPress={onClose}
              color={colors.onSurfaceVariant}
              style={styles.dismiss}
            />
          )}
        </View>
      }>
      <UpdateNotes notes={update?.notes ?? ''} />
    </AppSheet>
  );
}

/** 挂在主界面根部即可：只在启动后查一次，没有新版什么都不渲染。 */
export function UpdatePrompt() {
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null);
  const [visible, setVisible] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    let alive = true;
    checkForUpdate().then(result => {
      if (alive && result?.hasUpdate) {
        setUpdate(result);
        setVisible(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <UpdateSheet
      visible={visible}
      update={update}
      onClose={() => setVisible(false)}
    />
  );
}

const styles = StyleSheet.create({
  notes: {gap: 8, paddingBottom: 4},
  heading: {marginTop: 2},
  noteRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 8},
  dot: {width: 5, height: 5, borderRadius: 3, marginTop: 8},
  noteText: {flex: 1},
  actions: {gap: 10, paddingBottom: 12},
  upgrade: {alignSelf: 'stretch'},
  dismiss: {alignSelf: 'center'},
});
