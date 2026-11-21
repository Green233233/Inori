/**
 * 对方的共享日记（只读）。
 *
 * 媒体文件暂按 P1 范围只同步正文；这里以纯文本呈现，避免加载不到本地媒体路径。
 */
import React, {useEffect, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {type} from '../theme/typography';
import {GlassIcon} from '../components/GlassIcon';
import {SoftCard, ColorField} from '../components/Surfaces';
import {Pill} from '../components/Ui';
import {TopBar} from '../components/TopBar';
import {SkeletonBlock} from '../components/Skeleton';
import {getPartnerEntry} from '../sync/partnerStore';
import {htmlToPlainText} from '../data/html';
import {JournalEntry} from '../data/types';
import {CATEGORY_LABEL, MOOD_LABEL, WEATHER_LABEL} from '../data/types';

export function PartnerEntryScreen({
  entryId,
  onBack,
}: {
  entryId: string;
  onBack: () => void;
}) {
  const {colors, tokens} = useAppTheme();
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [loading, setLoading] = useState(true);

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

  const text = entry ? htmlToPlainText(entry.content ?? '').trim() : '';

  return (
    <View style={styles.root}>
      <TopBar title="TA 的日记" onBack={onBack} />
      {loading ? (
        <View style={{padding: tokens.contentPadding}}>
          <SkeletonBlock height={28} />
          <SkeletonBlock height={120} style={{marginTop: 16}} />
        </View>
      ) : !entry ? (
        <View style={[styles.center, {padding: tokens.contentPadding}]}>
          <GlassIcon name="info" size={40} />
          <Text style={[type.body, {color: colors.onSurfaceVariant, marginTop: 12}]}>
            这篇共享日记已不可见
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: tokens.contentPadding,
            paddingBottom: 40,
          }}
          showsVerticalScrollIndicator={false}>
          <Text style={[type.display, {color: colors.onSurface}]}>
            {entry.title || '未命名日记'}
          </Text>
          <Text style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 4}]}>
            {entry.date} · 只读
          </Text>

          <ColorField color={colors.secondary} radius={18} style={styles.hero}>
            <Text style={[type.body, {color: '#FFFFFF', opacity: 0.92}]}>
              {text || '本页无文字内容'}
            </Text>
          </ColorField>

          <SoftCard radius={16} style={styles.meta}>
            <Pill
              text={CATEGORY_LABEL[entry.category]}
              color={colors.onSurfaceVariant}
              background={colors.surfaceVariant}
            />
            <Pill
              text={WEATHER_LABEL[entry.weather]}
              color={colors.onSurfaceVariant}
              background={colors.surfaceVariant}
            />
            <Pill
              text={MOOD_LABEL[entry.mood]}
              color={colors.onSurfaceVariant}
              background={colors.surfaceVariant}
            />
          </SoftCard>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  hero: {marginTop: 18, padding: 18, minHeight: 120},
  meta: {
    marginTop: 14,
    padding: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
});
