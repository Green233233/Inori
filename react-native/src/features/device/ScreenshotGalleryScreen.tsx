/**
 * 主人端「截屏记录」：每一次「查看屏幕」都在本机留一张加密的图。
 *
 * 数据全在原生 [ScreenshotStore]（`filesDir/qi/shots/<id>.enc`），图片字节用配对
 * 密钥 AES-256-GCM 加密，明文 header（时间/尺寸）作为 AAD 一起认证。这意味着：
 *  - 列表只读 header，解绑之后仍能看到「什么时候存了几张」；
 *  - 缩略图/大图必须解出来才能显示，解绑或换人之后这里会显示「已锁定」，
 *    点开也只会拿到一句「解绑之后打不开」——正是产品要的语义。
 *
 * 缩略图只给最新的前若干条解码，再往下的行保留占位图，点开时按需解密，
 * 避免一次把 100 张 720p 图全塞进 JS 内存。
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {useAppTheme} from '../../theme/AppThemeProvider';
import {tabularNums, type} from '../../theme/typography';
import {GlassIcon} from '../../components/GlassIcon';
import {ImageViewer} from '../../components/ImageViewer';
import {SoftCard, separatorColor} from '../../components/Surfaces';
import {TopBar} from '../../components/TopBar';
import {AppDialog, RoundIconButton} from '../../components/Ui';
import {showToast} from '../../components/toast';
import {useQi} from '../qi/QiProvider';
import {
  qiScreenshotGallery,
  type ScreenshotPairKey,
  type ScreenshotShot,
} from '../../native/QiDevice';

/** 首屏最多解码多少张缩略图；更早的记录只在点开时才解密。 */
const THUMB_LIMIT = 12;

function timeLabel(at: number): string {
  if (!at) {
    return '时间未知';
  }
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) {
    return '时间未知';
  }
  const now = new Date();
  const hm = date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return hm;
  }
  const md = `${date.getMonth() + 1}月${date.getDate()}日`;
  if (date.getFullYear() === now.getFullYear()) {
    return `${md} ${hm}`;
  }
  return `${date.getFullYear()}年${md} ${hm}`;
}

function sizeLabel(bytes: number): string {
  if (!bytes) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function metaLabel(shot: ScreenshotShot): string {
  const size = sizeLabel(shot.size);
  const pixels = shot.width && shot.height ? `${shot.width}×${shot.height}` : '';
  return [pixels, size].filter(Boolean).join(' · ') || 'JPEG';
}

function fileNameFor(shot: ScreenshotShot): string {
  const date = new Date(shot.at || Date.now());
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(
    2,
    '0',
  )}${String(date.getDate()).padStart(2, '0')}-${String(
    date.getHours(),
  ).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
  return `qi-shot-${stamp}.jpg`;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return typeof error === 'string' && error ? error : '未知错误';
}

function ShotRow({
  shot,
  uri,
  locked,
  onOpen,
  onDelete,
}: {
  shot: ScreenshotShot;
  uri: string | null;
  locked: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const {colors, surfaces, isDark, tokens} = useAppTheme();
  return (
    <SoftCard
      radius={16}
      onPress={onOpen}
      accessibilityLabel={`查看 ${timeLabel(shot.at)} 的截屏`}>
      <View
        style={[
          styles.row,
          {
            paddingHorizontal: tokens.cardInnerPaddingHorizontal,
            paddingVertical: tokens.cardInnerPaddingVertical,
          },
        ]}>
        <View
          style={[
            styles.thumb,
            {
              backgroundColor: surfaces.sunken,
              borderColor: surfaces.highlightSoft,
            },
          ]}>
          {uri ? (
            <Image source={{uri}} style={styles.thumbImage} resizeMode="cover" />
          ) : locked ? (
            <GlassIcon name="info" size={20} />
          ) : (
            <ActivityIndicator size="small" color={colors.onSurfaceVariant} />
          )}
        </View>
        <View style={styles.rowText}>
          <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
            {timeLabel(shot.at)}
          </Text>
          <Text
            style={[
              type.caption,
              tabularNums,
              {color: colors.onSurfaceVariant, marginTop: 2},
            ]}>
            {locked ? '已锁定 · 解绑后无法解密' : metaLabel(shot)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="删除这条截屏"
          hitSlop={12}
          focusable={false}
          onPress={onDelete}
          style={({pressed}) => [
            styles.delete,
            {
              backgroundColor: pressed ? surfaces.sunken : 'transparent',
              borderColor: separatorColor(colors.outline, isDark),
            },
          ]}>
          <GlassIcon name="delete" size={20} />
        </Pressable>
      </View>
    </SoftCard>
  );
}

export function ScreenshotGalleryScreen({onBack}: {onBack: () => void}) {
  const {colors, tokens, surfaces} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {pair} = useQi();
  const [shots, setShots] = useState<ScreenshotShot[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [locked, setLocked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewer, setViewer] = useState<{uri: string; name: string} | null>(null);
  const [pendingDelete, setPendingDelete] =
    useState<ScreenshotShot | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const pairKey = useMemo<ScreenshotPairKey | null>(() => {
    if (!pair?.pairId || !pair.peerPubkey) {
      return null;
    }
    return {pairId: pair.pairId, peerPublicB64: pair.peerPubkey};
  }, [pair?.pairId, pair?.peerPubkey]);

  /**
   * 先只列 header，再给最新的几条解缩略图。
   * 解某一具体条失败（已解绑）只把那条标成「已锁定」，不影响整页。
   */
  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!qiScreenshotGallery.available) {
        if (aliveRef.current) {
          setHint('这个版本还不带「截屏记录」，重新安装最新的 App 就能用');
          setLoading(false);
        }
        return;
      }
      if (mode === 'refresh') {
        setRefreshing(true);
      }
      try {
        const rows = await qiScreenshotGallery.list();
        if (!aliveRef.current) {
          return;
        }
        setShots(rows);
        setHint(null);
        const fresh: Record<string, string> = {};
        const misses: Record<string, boolean> = {};
        for (const shot of rows.slice(0, THUMB_LIMIT)) {
          if (!pairKey) {
            // 没有当前配对就没有密钥：不必逐张试，直接标成「已锁定」。
            misses[shot.id] = true;
            continue;
          }
          try {
            fresh[shot.id] = await qiScreenshotGallery.read(shot.id, pairKey);
          } catch {
            // 解不开 = 已经没有配对密钥了，交给行内显示「已锁定」。
            misses[shot.id] = true;
          }
          if (!aliveRef.current) {
            return;
          }
        }
        setThumbs(fresh);
        setLocked(misses);
      } catch (error) {
        if (aliveRef.current) {
          setHint(`读取截屏记录失败：${messageOf(error)}`);
        }
      } finally {
        if (aliveRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [pairKey],
  );

  useEffect(() => {
    load('initial').catch(() => undefined);
  }, [load]);

  const open = useCallback(
    async (shot: ScreenshotShot) => {
      const cached = thumbs[shot.id];
      if (cached) {
        setViewer({uri: cached, name: fileNameFor(shot)});
        return;
      }
      try {
        const uri = await qiScreenshotGallery.read(shot.id, pairKey);
        if (!aliveRef.current) {
          return;
        }
        setThumbs(prev => ({...prev, [shot.id]: uri}));
        setViewer({uri, name: fileNameFor(shot)});
      } catch (error) {
        if (!aliveRef.current) {
          return;
        }
        setLocked(prev => ({...prev, [shot.id]: true}));
        showToast(messageOf(error), true);
      }
    },
    [pairKey, thumbs],
  );

  const removeConfirmed = useCallback(async () => {
    const shot = pendingDelete;
    setPendingDelete(null);
    if (!shot) {
      return;
    }
    try {
      await qiScreenshotGallery.remove(shot.id);
      if (!aliveRef.current) {
        return;
      }
      setShots(prev => prev.filter(row => row.id !== shot.id));
      setThumbs(prev => {
        const next = {...prev};
        delete next[shot.id];
        return next;
      });
      showToast('已删除这条截屏');
    } catch (error) {
      showToast(messageOf(error));
    }
  }, [pendingDelete]);

  const header = (
    <View>
      <TopBar
        title="截屏记录"
        onBack={onBack}
        right={
          <RoundIconButton
            name="refresh"
            accessibilityLabel="刷新截屏记录"
            onPress={() => {
              load('refresh').catch(() => undefined);
            }}
          />
        }
      />
      {hint ? (
        <View
          style={[
            styles.hint,
            {
              backgroundColor: surfaces.raised,
              borderColor: surfaces.highlightSoft,
            },
          ]}>
          <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
            {hint}
          </Text>
        </View>
      ) : null}
    </View>
  );

  if (loading) {
    return (
      <View
        style={[styles.root, {backgroundColor: colors.background}]}
        testID="screenshot-gallery-loading">
        {header}
        <View style={styles.center}>
          <ActivityIndicator color={colors.onSurfaceVariant} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, {backgroundColor: colors.background}]}>
      <FlatList
        data={shots}
        keyExtractor={item => item.id}
        ListHeaderComponent={header}
        contentContainerStyle={{
          paddingHorizontal: tokens.contentPadding,
          paddingBottom: insets.bottom + 40,
        }}
        ItemSeparatorComponent={() => (
          <View style={{height: tokens.listSpacing}} />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              load('refresh').catch(() => undefined);
            }}
            tintColor={colors.onSurfaceVariant}
            colors={[colors.primary]}
            progressBackgroundColor={surfaces.raised}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <GlassIcon name="photo" size={44} />
            <Text
              style={[
                type.body,
                {color: colors.onSurfaceVariant, marginTop: 14, textAlign: 'center'},
              ]}>
              还没有截屏记录。回到「设备管控中心 → 查看屏幕」拍一张，这里就会出现
            </Text>
          </View>
        }
        renderItem={({item}) => (
          <ShotRow
            shot={item}
            uri={thumbs[item.id] ?? null}
            locked={!!locked[item.id]}
            onOpen={() => {
              open(item).catch(() => undefined);
            }}
            onDelete={() => setPendingDelete(item)}
          />
        )}
      />
      <ImageViewer
        visible={!!viewer}
        uri={viewer?.uri ?? null}
        fileName={viewer?.name}
        onClose={() => setViewer(null)}
      />
      <AppDialog
        visible={!!pendingDelete}
        title="删除这条截屏？"
        message="删除后本机再也找不回来，小狗端那份不受影响。"
        confirmLabel="删除"
        dismissLabel="取消"
        destructive
        onConfirm={() => {
          removeConfirmed().catch(() => undefined);
        }}
        onDismiss={() => setPendingDelete(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  hint: {
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {flexDirection: 'row', alignItems: 'center'},
  thumb: {
    width: 96,
    height: 60,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImage: {width: '100%', height: '100%'},
  rowText: {flex: 1, marginLeft: 12},
  delete: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 96,
    paddingHorizontal: 32,
  },
});
