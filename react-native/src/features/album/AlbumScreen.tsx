/**
 * 相册分享：只有配对双方能看的加密照片。
 * 主人端 / 小狗端共用；分享者可以删除自己上传的照片。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ImageViewer} from '../../components/ImageViewer';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {withAlpha} from '../../theme/palette';
import {type} from '../../theme/typography';
import {GlassIcon} from '../../components/GlassIcon';
import {SoftCard} from '../../components/Surfaces';
import {AppDialog, FlatButton} from '../../components/Ui';
import {TopBar} from '../../components/TopBar';
import {showToast} from '../../components/toast';
import {useQi} from '../qi/QiProvider';
import {
  AlbumItem,
  deletePhoto,
  loadAlbum,
  loadPhotoImage,
  refreshAlbum,
  sharePhoto,
} from '../../sync/album';

export function AlbumScreen({onBack}: {onBack: () => void}) {
  const {colors, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {pair, state} = useQi();
  const [items, setItems] = useState<AlbumItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AlbumItem | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(pair ? await refreshAlbum(pair) : await loadAlbum());
    } catch (error: any) {
      showToast(error?.message ?? '刷新失败');
      setItems(await loadAlbum());
    } finally {
      setLoading(false);
    }
  }, [pair]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const share = async () => {
    if (!pair || sharing) {
      return;
    }
    setSharing(true);
    try {
      const item = await sharePhoto(pair, state.deviceId);
      setItems(previous => [item, ...previous]);
      showToast('照片已加密上传');
    } catch (error: any) {
      showToast(error?.message ?? '分享失败');
    } finally {
      setSharing(false);
    }
  };

  const open = async (item: AlbumItem) => {
    if (!pair) {
      return;
    }
    setLoadingId(item.id);
    try {
      setViewerUri(await loadPhotoImage(pair, item));
    } catch (error: any) {
      showToast(error?.message ?? '加载失败');
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <View style={styles.root}>
      <TopBar title="相册分享" onBack={onBack} />
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
          照片在手机上加好密再上传，服务器只保存密文分块；解绑后对方就再也看不到。
        </Text>

        <FlatButton
          label={sharing ? '正在加密上传…' : '分享一张照片'}
          onPress={() => {
            share().catch(() => undefined);
          }}
          disabled={sharing}
          style={styles.primary}
        />

        {items.length === 0 ? (
          <SoftCard radius={18} style={styles.empty}>
            <GlassIcon name="photo" size={34} />
            <Text
              style={[
                type.body,
                {color: colors.onSurfaceVariant, marginTop: 10, textAlign: 'center'},
              ]}>
              还没有共享照片。选一张，只有你们两个人能看。
            </Text>
          </SoftCard>
        ) : (
          items.map(item => {
            const mine = item.authorDeviceId === state.deviceId;
            return (
              <SoftCard key={item.id} radius={16} style={styles.card}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`查看照片 ${item.name}`}
                  onPress={() => {
                    open(item).catch(() => undefined);
                  }}
                  style={styles.row}>
                  <View style={[styles.thumb, {backgroundColor: colors.surfaceVariant}]}>
                    {loadingId === item.id ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : (
                      <GlassIcon name="photo" size={24} />
                    )}
                  </View>
                  <View style={{flex: 1}}>
                    <Text
                      style={[type.body, {color: colors.onSurface}]}
                      numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
                      {mine ? '我分享的' : 'TA 分享的'} ·{' '}
                      {new Date(item.at).toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
                  </View>
                  <GlassIcon name="chevronRight" size={18} />
                </Pressable>
                {mine ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="删除这张照片"
                    onPress={() => setPendingDelete(item)}
                    style={styles.deleteRow}>
                    <Text style={[type.caption, {color: withAlpha(colors.error, 0.9)}]}>
                      删除
                    </Text>
                  </Pressable>
                ) : null}
              </SoftCard>
            );
          })
        )}
      </ScrollView>

      <ImageViewer
        visible={!!viewerUri}
        uri={viewerUri}
        fileName="qi-photo.jpg"
        onClose={() => setViewerUri(null)}
      />

      <AppDialog
        visible={!!pendingDelete}
        title="删除这张照片？"
        message="删除后对方也看不到了。"
        confirmLabel="删除"
        dismissLabel="取消"
        destructive
        onDismiss={() => setPendingDelete(null)}
        onConfirm={() => {
          const item = pendingDelete;
          setPendingDelete(null);
          if (!pair || !item) {
            return;
          }
          deletePhoto(pair, item)
            .then(() =>
              setItems(previous => previous.filter(row => row.id !== item.id)),
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
  card: {padding: 12, marginTop: 10},
  row: {flexDirection: 'row', alignItems: 'center', gap: 12},
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteRow: {alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 4},
});
