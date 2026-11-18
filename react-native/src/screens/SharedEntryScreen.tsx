/**
 * 对方的共享日记（只读）。
 *
 * 用原生视图渲染文字与图片块：不创建 WebView，打开更快，也不会触发旧版
 * WebView 的渲染进程崩溃；图片点击交给全局 ImageViewer。
 */
import React, {useEffect, useMemo, useState} from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {type} from '../theme/typography';
import {TopBar} from '../components/TopBar';
import {SkeletonBlock} from '../components/Skeleton';
import {ImageViewer} from '../components/ImageViewer';
import {toSharedBlocks} from '../journal/sharedBlocks';
import {getPartnerEntry} from '../sync/partnerStore';
import {JournalEntry} from '../data/types';

function SharedImage({uri, onPress}: {uri: string; onPress: () => void}) {
  const [ratio, setRatio] = useState(4 / 3);

  useEffect(() => {
    let cancelled = false;
    Image.getSize(
      uri,
      (width, height) => {
        if (!cancelled && width > 0 && height > 0) {
          setRatio(width / height);
        }
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [uri]);

  return (
    <Pressable onPress={onPress} accessibilityLabel="查看图片">
      <Image
        source={{uri}}
        style={[styles.image, {aspectRatio: ratio}]}
        resizeMode="contain"
      />
    </Pressable>
  );
}

export function SharedEntryScreen({
  entryId,
  onBack,
}: {
  entryId: string;
  onBack: () => void;
}) {
  const {colors, tokens} = useAppTheme();
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPartnerEntry(entryId)
      .then(found => {
        if (!cancelled) {
          setEntry(found);
          setLoading(false);
        }
      })
      .catch(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [entryId]);

  const blocks = useMemo(
    () => toSharedBlocks(entry?.content ?? ''),
    [entry?.content],
  );

  return (
    <View style={styles.root}>
      <TopBar title="TA 的日记" onBack={onBack} />
      {loading ? (
        <View style={{padding: tokens.contentPadding}}>
          <SkeletonBlock height={28} />
          <SkeletonBlock height={180} style={{marginTop: 16}} />
        </View>
      ) : !entry ? (
        <View style={[styles.center, {padding: tokens.contentPadding}]}>
          <Text style={[type.body, {color: colors.onSurfaceVariant}]}>
            这篇共享日记已经不可见了
          </Text>
        </View>
      ) : (
        <>
          <View
            style={{paddingHorizontal: tokens.contentPadding, paddingTop: 2}}>
            <Text
              style={[styles.title, {color: colors.onSurface}]}
              numberOfLines={2}>
              {entry.title || '未命名日记'}
            </Text>
            <Text
              style={[
                type.caption,
                {color: colors.onSurfaceVariant, marginTop: 2},
              ]}>
              {entry.date} · 只读 · 由 TA 分享
            </Text>
          </View>
          <ScrollView
            style={[styles.paper, {borderColor: colors.outline}]}
            contentContainerStyle={styles.paperContent}
            showsVerticalScrollIndicator={false}>
            {blocks.length === 0 ? (
              <Text style={[type.body, {color: colors.onSurfaceVariant}]}>
                （这一页没有可显示的正文）
              </Text>
            ) : (
              blocks.map((block, index) =>
                block.kind === 'image' ? (
                  <SharedImage
                    key={`img-${index}`}
                    uri={block.uri}
                    onPress={() => setPreview(block.uri)}
                  />
                ) : (
                  <Text
                    key={`text-${index}`}
                    style={[
                      styles.body,
                      {color: colors.onSurface, marginLeft: block.bullet ? 8 : 0},
                    ]}>
                    {block.text}
                  </Text>
                ),
              )
            )}
          </ScrollView>
        </>
      )}

      <ImageViewer
        visible={!!preview}
        uri={preview}
        onClose={() => setPreview(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  title: {fontSize: 22, fontWeight: '700', lineHeight: 30},
  paper: {
    flex: 1,
    marginTop: 10,
    marginHorizontal: 10,
    marginBottom: 8,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: '#FFFDF7',
  },
  paperContent: {padding: 18, paddingBottom: 40, gap: 6},
  body: {fontSize: 16, lineHeight: 30, letterSpacing: 0.2},
  image: {
    width: '100%',
    borderRadius: 10,
    marginVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
});
