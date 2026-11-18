/**
 * 小狗端「我的券」：未用 / 已用分段 + 券列表（点开详情）+ 空状态单动作。
 *
 * 券面本身是纯展示的 Ticket；只有传了 onOpenCoupon 时才把券包成可点行。
 * 空状态只保留一个动作：去找主人要一张（可用 onAskMaster 接到真实流程，
 * 未接时退化为刷新列表）。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {TopBar} from '../../components/TopBar';
import {AppSheet, FlatButton, RoundIconButton, TextButton} from '../../components/Ui';
import {GlassIcon} from '../../components/GlassIcon';
import {showToast} from '../../components/toast';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {type} from '../../theme/typography';
import type {Coupon} from '../../data/pairTypes';
import {errorMessage} from '../../net/ApiClient';
import {
  COUPON_MAX_COUNT,
  couponStatusLabel,
  generateCoupons,
  listCoupons,
  type CouponStatus,
} from '../../data/couponApi';
import {Ticket} from './Ticket';
import {Segmented, type SegmentedOption} from './controls';

const PAGE_LIMIT = 50;

const SEGMENTS: ReadonlyArray<SegmentedOption<CouponStatus>> = [
  {value: 'unused', label: '未用'},
  {value: 'used', label: '已用'},
];

export interface CouponWalletProps {
  onBack?: () => void;
  onOpenCoupon?: (coupon: Coupon) => void;
  /** 空状态「去找主人要一张」的动作；不传时退化为刷新列表。 */
  onAskMaster?: () => void;
}

export default function CouponWallet({
  onBack,
  onOpenCoupon,
  onAskMaster,
}: CouponWalletProps) {
  const {colors, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();

  const [segment, setSegment] = useState<CouponStatus>('unused');
  const [items, setItems] = useState<Coupon[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    try {
      const page = await listCoupons({
        status: segment,
        limit: PAGE_LIMIT,
        offset: 0,
      });
      setItems(page.items);
      setTotal(page.total);
      setError(null);
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      setLoading(false);
    }
  }, [segment]);

  const [issueOpen, setIssueOpen] = useState(false);
  const [issueCount, setIssueCount] = useState(1);
  const [issuing, setIssuing] = useState(false);

  const issueReward = useCallback(async () => {
    setIssuing(true);
    try {
      const created = await generateCoupons({
        type: 'reward',
        count: issueCount,
      });
      setIssueOpen(false);
      setIssueCount(1);
      showToast(`已派发 ${created.length} 张奖励券，等主人来领`);
      await fetchPage();
    } catch (failure) {
      showToast(errorMessage(failure));
    } finally {
      setIssuing(false);
    }
  }, [fetchPage, issueCount]);

  useEffect(() => {
    fetchPage().catch(() => undefined);
  }, [fetchPage]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchPage();
    } finally {
      setRefreshing(false);
    }
  }, [fetchPage]);

  const askMaster = useCallback(() => {
    if (onAskMaster) {
      onAskMaster();
      return;
    }
    showToast('已刷新，等主人签发后会出现在这里');
    fetchPage().catch(() => undefined);
  }, [fetchPage, onAskMaster]);

  const refreshFromBar = useCallback(() => {
    if (loading || refreshing) {
      return;
    }
    fetchPage()
      .then(ok => {
        if (ok) {
          showToast('已刷新');
        }
      })
      .catch(() => undefined);
  }, [fetchPage, loading, refreshing]);

  return (
    <View style={styles.root}>
      <TopBar
        title="我的券"
        onBack={onBack}
        right={
          <RoundIconButton
            name="refresh"
            accessibilityLabel="刷新券列表"
            size={20}
            onPress={refreshFromBar}
          />
        }
      />

      <View style={{paddingHorizontal: tokens.contentPadding}}>
        <FlatButton
          label="派发奖励券"
          icon="favorite"
          onPress={() => setIssueOpen(true)}
        />
        <Text
          style={[
            type.caption,
            styles.rewardHint,
            {color: colors.onSurfaceVariant},
          ]}>
          奖励券由你派发：主人来领时写下想要的奖励，内容端到端加密，只有你们能看。
        </Text>
      </View>

      <View
        style={[
          styles.segmentWrap,
          {paddingHorizontal: tokens.contentPadding},
        ]}>
        <Segmented
          options={SEGMENTS}
          value={segment}
          onChange={setSegment}
        />
      </View>

      <FlatList
        data={items}
        keyExtractor={item => String(item.id)}
        contentContainerStyle={[
          styles.listContent,
          {
            paddingHorizontal: tokens.contentPadding,
            paddingBottom: insets.bottom + 32,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              onRefresh().catch(() => undefined);
            }}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.surface}
          />
        }
        ListHeaderComponent={
          items.length > 0 ? (
            <Text
              style={[
                type.caption,
                styles.listMeta,
                {color: colors.onSurfaceVariant},
              ]}>
              共 {total} 张
              {total > items.length ? ` · 仅显示最近 ${items.length} 张` : ''}
            </Text>
          ) : undefined
        }
        ListEmptyComponent={
          loading ? (
            <Text
              style={[
                type.caption,
                styles.loadingText,
                {color: colors.onSurfaceVariant},
              ]}>
              加载中…
            </Text>
          ) : (
            <View style={styles.emptyWrap}>
              <View
                style={[
                  styles.emptyIcon,
                  {backgroundColor: colors.surfaceVariant},
                ]}>
                <GlassIcon
                  name={segment === 'unused' ? 'favorite' : 'check'}
                  size={40}
                />
              </View>
              <Text style={[type.headline, {color: colors.onSurface}]}>
                {segment === 'unused' ? '还没有可用的券' : '还没有用过的券'}
              </Text>
              <Text
                style={[
                  type.body,
                  styles.emptyText,
                  {color: colors.onSurfaceVariant},
                ]}>
                {segment === 'unused'
                  ? '和好券是主人签发的通行证，吵架之后可以用来换一个台阶。'
                  : '用掉的券会留在这里，记录当时为什么和好。'}
              </Text>
              {error ? (
                <Text
                  style={[
                    type.caption,
                    styles.emptyText,
                    {color: colors.error},
                  ]}>
                  {error}
                </Text>
              ) : null}
              {segment === 'unused' ? (
                <FlatButton
                  label="去找主人要一张"
                  onPress={askMaster}
                  icon="favorite"
                  style={styles.emptyButton}
                />
              ) : null}
            </View>
          )
        }
        ListFooterComponent={
          error && items.length > 0 ? (
            <Text
              style={[
                type.caption,
                styles.loadingText,
                {color: colors.error},
              ]}>
              {error}
            </Text>
          ) : undefined
        }
        renderItem={({item}) => (
          <WalletRow coupon={item} onOpenCoupon={onOpenCoupon} />
        )}
      />

      <AppSheet
        visible={issueOpen}
        title="派发奖励券"
        onClose={() => {
          if (!issuing) {
            setIssueOpen(false);
          }
        }}>
        <View style={{gap: 12}}>
          <Text style={[type.body, {color: colors.onSurface}]}>
            主人领取时会填写他想要的奖励内容，这份内容会加密保存。
          </Text>
          <View style={styles.countRow}>
            <TextButton
              label="－"
              onPress={() => setIssueCount(value => Math.max(1, value - 1))}
            />
            <Text style={[type.title, {color: colors.onSurface}]}>
              {issueCount} 张
            </Text>
            <TextButton
              label="＋"
              onPress={() =>
                setIssueCount(value =>
                  Math.min(COUPON_MAX_COUNT, value + 1),
                )
              }
            />
          </View>
          <FlatButton
            label={issuing ? '派发中…' : `派发 ${issueCount} 张奖励券`}
            disabled={issuing}
            onPress={() => {
              issueReward().catch(() => undefined);
            }}
          />
        </View>
      </AppSheet>
    </View>
  );
}

function WalletRow({
  coupon,
  onOpenCoupon,
}: {
  coupon: Coupon;
  onOpenCoupon?: (coupon: Coupon) => void;
}) {
  if (!onOpenCoupon) {
    return <Ticket coupon={coupon} compact />;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${coupon.typeLabel} ${coupon.code} ${couponStatusLabel(
        coupon.status,
      )}`}
      onPress={() => onOpenCoupon(coupon)}
      style={({pressed}) => [{opacity: pressed ? 0.85 : 1}]}>
      <Ticket coupon={coupon} compact />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rewardHint: {marginTop: 6, marginBottom: 2},
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  root: {flex: 1},
  segmentWrap: {paddingTop: 4, paddingBottom: 10},
  listContent: {gap: 10},
  listMeta: {marginBottom: 2},
  loadingText: {paddingVertical: 24, textAlign: 'center'},
  emptyWrap: {alignItems: 'center', paddingVertical: 36, gap: 10},
  emptyIcon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyText: {textAlign: 'center'},
  emptyButton: {marginTop: 8},
});
