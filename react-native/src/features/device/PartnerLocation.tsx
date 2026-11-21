/**
 * 小狗端查看主人位置。
 *
 * 与主人端「定位」用的是同一条 location.get 指令，只是方向反过来：
 * 小狗端发起请求，主人端在本地取一次点（单次、不常驻）再回传。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {useAppTheme} from '../../theme/AppThemeProvider';
import {type} from '../../theme/typography';
import {MapPreview} from '../../components/MapPreview';
import {SoftCard} from '../../components/Surfaces';
import {FlatButton} from '../../components/Ui';
import {TopBar} from '../../components/TopBar';
import {showToast} from '../../components/toast';
import {useQi} from '../qi/QiProvider';
import {readState, writeState} from '../../sync/stateCache';

export function PartnerLocation({onBack}: {onBack: () => void}) {
  const {colors, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {pair, runCommand} = useQi();
  const [fix, setFix] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      setBusy(true);
      try {
        const cached = await readState<any>('location').catch(() => null);
        if (cached?.data?.ok && Date.now() - cached.at <= 10 * 60_000) {
          setFix(cached.data);
          setHint(cached.source === 'direct' ? '实时（直连）' : '来自服务器暂存');
          return;
        }
        const reply = await runCommand('location.get');
        const data = (reply?.data ?? {}) as any;
        if (reply?.ok) {
          writeState('location', data, 'direct').catch(() => undefined);
        } else if (cached?.data?.ok) {
          setFix(cached.data);
          setHint('等对方下次同步，先显示上次的位置');
          return;
        }
        setFix(reply?.ok ? data : null);
        if (!reply?.ok) {
          setHint(
            data?.reason === 'no_permission'
              ? '主人端还没给「定位」权限，等他同意后才能看到。'
              : data?.reason === 'no_fix'
              ? '主人端暂时取不到坐标，过一会儿再试。'
              : reply?.error ?? '没拿到位置，稍后再试。',
          );
        } else {
          setHint(null);
        }
      } catch (error: any) {
        setHint(error?.message ?? '请求超时，让主人端把应用打开再试');
        if (!silent) {
          showToast('没拿到位置');
        }
      } finally {
        setBusy(false);
      }
    },
    [runCommand],
  );

  useEffect(() => {
    load(true).catch(() => undefined);
  }, [load]);

  const partner = pair?.ownerName ?? '主人';
  const askedAt = fix?.timestamp ? new Date(fix.timestamp) : null;

  return (
    <View style={[styles.root, {backgroundColor: colors.background}]}>
      <TopBar title={`${partner}在哪里`} onBack={onBack} />
      <ScrollView
        contentContainerStyle={{
          padding: tokens.contentPadding,
          paddingBottom: insets.bottom + 40,
        }}>
        <Text
          style={[
            type.caption,
            {color: colors.onSurfaceVariant, marginBottom: 14},
          ]}>
          每点一次只在主人手机上取一次坐标，不会持续定位；主人那边会收到一条提示。
        </Text>

        {fix?.ok ? (
          <SoftCard radius={18} style={{padding: 14}}>
            <MapPreview
              lat={Number(fix.lat)}
              lng={Number(fix.lng)}
              height={220}
              caption={fix.address || undefined}
            />
            <Text style={[type.body, {color: colors.onSurface, marginTop: 12}]}>
              {fix.lat?.toFixed(5)}, {fix.lng?.toFixed(5)}
            </Text>
            <Text
              style={[
                type.caption,
                {color: colors.onSurfaceVariant, marginTop: 4},
              ]}>
              {[
                fix.provider ? `${fix.provider}` : null,
                fix.accuracy ? `精度 ${Math.round(Number(fix.accuracy))} 米` : null,
                askedAt
                  ? `${askedAt.getHours()}:${String(askedAt.getMinutes()).padStart(
                      2,
                      '0',
                    )} 取点`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </SoftCard>
        ) : (
          <SoftCard radius={18} style={{padding: 18}}>
            <Text style={[type.body, {color: colors.onSurface}]}>
              {hint ?? (busy ? '正在问主人要位置…' : '还没有位置')}
            </Text>
          </SoftCard>
        )}

        <View style={{height: 16}} />
        <FlatButton
          label={busy ? '获取中…' : '再取一次'}
          onPress={() => load().catch(() => undefined)}
          disabled={busy}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
});
