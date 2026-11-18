/**
 * 主人端「和好券」管理页。
 *
 * 一屏四段：统计条 → 签发卡（类型 / 数量 / 加密备注）→ 筛选与搜索 → 记录列表
 * （分页加载更多 + 下拉刷新）。右上角「券设置」用 AppSheet 展示公钥指纹、
 * 审计日志与 CSV 导出。
 *
 * 备注一律端到端加密：明文只在输入框里，``sealNote`` 之后才发给服务器；
 * 列表里不展示明文，点开券详情时才按需解密。
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {TopBar} from '../../components/TopBar';
import {SoftCard} from '../../components/Surfaces';
import {
  AppSheet,
  Divider,
  FlatButton,
  OutlinedButton,
  RoundIconButton,
  TextButton,
} from '../../components/Ui';
import {GlassIcon} from '../../components/GlassIcon';
import {showToast} from '../../components/toast';
import {native} from '../../native/InorinalNative';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {type, tabularNums} from '../../theme/typography';
import {useQi} from '../qi/QiProvider';
import type {Coupon} from '../../data/pairTypes';
import {errorMessage} from '../../net/ApiClient';
import {
  COUPON_MAX_COUNT,
  COUPON_MIN_COUNT,
  COUPON_TYPE_LABELS,
  couponStatusLabel,
  generateCoupons,
  getAudit,
  getKeyInfo,
  listCoupons,
  type CouponAuditEntry,
  type CouponKeyInfo,
  type CouponStatusFilter,
  type CouponType,
  type CouponTypeFilter,
} from '../../data/couponApi';
import {Ticket} from './Ticket';
import {
  SearchInput,
  Segmented,
  Stepper,
  ToggleRow,
  type SegmentedOption,
} from './controls';
import {
  canEncryptNote,
  NOTE_LOCKED_TEXT,
  NOTE_MAX_LENGTH,
  noteTargetFrom,
  openNote,
  sealNote,
} from './noteCipher';
import {buildCouponCsv, couponsCsvFileName, encodeCsvBase64} from './csv';
import type {CouponCsvRow} from './csv';

const PAGE_SIZE = 20;
const AUDIT_PAGE_SIZE = 20;

const STATUS_OPTIONS: ReadonlyArray<SegmentedOption<CouponStatusFilter>> = [
  {value: 'all', label: '全部'},
  {value: 'unused', label: '可用'},
  {value: 'used', label: '已用'},
];

const TYPE_OPTIONS: ReadonlyArray<SegmentedOption<CouponTypeFilter>> = [
  {value: 'all', label: '全部'},
  {value: 'hehao', label: COUPON_TYPE_LABELS.hehao},
  {value: 'exam', label: COUPON_TYPE_LABELS.exam},
];

const AUDIT_LABELS: Record<string, string> = {
  coupon_generate: '签发券',
  coupon_redeem: '核销券',
  coupon_redeem_denied: '拒绝核销',
};

type ActionKey = 'generate' | 'settings' | 'audit' | 'export' | null;

interface Stats {
  available: number;
  used: number;
  today: number;
}

interface CouponQuery {
  status: CouponStatusFilter;
  type: CouponTypeFilter;
  q: string;
}

interface DetailState {
  coupon: Coupon;
  note: string | null;
  usedNote: string | null;
  loading: boolean;
}

function isToday(iso: string): boolean {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

async function fetchAllCoupons(): Promise<Coupon[]> {
  const all: Coupon[] = [];
  let offset = 0;
  // 最多 10 页（100/页）；异常数据也不会把导出卡死。
  for (let page = 0; page < 10; page += 1) {
    const response = await listCoupons({limit: 100, offset});
    all.push(...response.items);
    offset += response.items.length;
    if (response.items.length === 0 || offset >= response.total) {
      break;
    }
  }
  return all;
}

export interface CouponManagementProps {
  onBack?: () => void;
  /** 奖励券由主人核销领取；只有传了才会在详情里出现「去领取」。 */
  onRedeem?: (coupon: Coupon) => void;
}

export default function CouponManagement({
  onBack,
  onRedeem,
}: CouponManagementProps) {
  const {colors, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {pair} = useQi();

  const [couponType, setCouponType] = useState<CouponType>('hehao');
  const [count, setCount] = useState(COUPON_MIN_COUNT);
  const [noteEnabled, setNoteEnabled] = useState(false);
  const [noteText, setNoteText] = useState('');

  const [statusFilter, setStatusFilter] =
    useState<CouponStatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<CouponTypeFilter>('all');
  const [searchDraft, setSearchDraft] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');

  const [items, setItems] = useState<Coupon[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats>({
    available: 0,
    used: 0,
    today: 0,
  });
  const [listLoading, setListLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [action, setAction] = useState<ActionKey>(null);
  const [error, setError] = useState<string | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyInfo, setKeyInfo] = useState<CouponKeyInfo | null>(null);
  const [audit, setAudit] = useState<CouponAuditEntry[] | null>(null);

  const [detail, setDetail] = useState<DetailState | null>(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const pairRef = useRef(pair);
  pairRef.current = pair;
  const queryRef = useRef({
    status: statusFilter,
    type: typeFilter,
    q: appliedSearch,
  });
  queryRef.current = {
    status: statusFilter,
    type: typeFilter,
    q: appliedSearch,
  };
  const requestSeq = useRef(0);

  const noteTarget = noteTargetFrom(pair);
  const noteReady = canEncryptNote(noteTarget);

  const fetchFirstPage = useCallback(async (query?: CouponQuery) => {
    const active = query ?? queryRef.current;
    const sequence = ++requestSeq.current;
    setListLoading(true);
    try {
      const page = await listCoupons({
        ...active,
        limit: PAGE_SIZE,
        offset: 0,
      });
      if (sequence !== requestSeq.current) {
        return;
      }
      setItems(page.items);
      setTotal(page.total);
      setError(null);
    } catch (failure) {
      if (sequence === requestSeq.current) {
        setError(errorMessage(failure));
      }
    } finally {
      if (sequence === requestSeq.current) {
        setListLoading(false);
      }
    }
  }, []);

  const loadStats = useCallback(async () => {
    const [unused, used, page] = await Promise.all([
      listCoupons({status: 'unused', limit: 1, offset: 0}),
      listCoupons({status: 'used', limit: 1, offset: 0}),
      listCoupons({status: 'all', type: 'all', limit: 100, offset: 0}),
    ]);
    setStats({
      available: unused.total,
      used: used.total,
      today: page.items.filter(item => isToday(item.createdAt)).length,
    });
  }, []);

  useEffect(() => {
    fetchFirstPage({
      status: statusFilter,
      type: typeFilter,
      q: appliedSearch,
    }).catch(() => undefined);
  }, [fetchFirstPage, statusFilter, typeFilter, appliedSearch]);

  useEffect(() => {
    loadStats().catch(() => undefined);
  }, [loadStats]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchFirstPage(), loadStats()]);
    } finally {
      setRefreshing(false);
    }
  }, [fetchFirstPage, loadStats]);

  const onLoadMore = useCallback(async () => {
    if (moreLoading || listLoading) {
      return;
    }
    setMoreLoading(true);
    try {
      const page = await listCoupons({
        ...queryRef.current,
        limit: PAGE_SIZE,
        offset: itemsRef.current.length,
      });
      setItems(previous => [...previous, ...page.items]);
      setTotal(page.total);
    } catch (failure) {
      showToast(errorMessage(failure, '加载更多失败'));
    } finally {
      setMoreLoading(false);
    }
  }, [listLoading, moreLoading]);

  const onGenerate = useCallback(async () => {
    if (action) {
      return;
    }
    setAction('generate');
    setError(null);
    try {
      let noteCipher: string | undefined;
      if (noteEnabled) {
        if (!noteText.trim()) {
          throw new Error('备注是空的：写点什么，或者关掉加密备注');
        }
        if (!noteReady) {
          throw new Error('还没有对方的公钥，等完成配对后再加密备注');
        }
        noteCipher = await sealNote(noteTargetFrom(pairRef.current), noteText);
      }
      const created = await generateCoupons({
        type: couponType,
        count,
        noteCipher,
      });
      showToast(`已签发 ${created.length} 张${COUPON_TYPE_LABELS[couponType]}`);
      setCount(COUPON_MIN_COUNT);
      setNoteEnabled(false);
      setNoteText('');
      await Promise.all([fetchFirstPage(), loadStats()]);
    } catch (failure) {
      const message = errorMessage(failure);
      setError(message);
      showToast(message);
    } finally {
      setAction(null);
    }
  }, [
    action,
    count,
    fetchFirstPage,
    loadStats,
    noteEnabled,
    noteReady,
    noteText,
    couponType,
  ]);

  const openSettings = useCallback(async () => {
    if (action) {
      return;
    }
    setSettingsOpen(true);
    setAction('settings');
    try {
      const [info, entries] = await Promise.all([
        getKeyInfo(),
        getAudit(AUDIT_PAGE_SIZE),
      ]);
      setKeyInfo(info);
      setAudit(entries);
    } catch (failure) {
      showToast(errorMessage(failure, '读取券设置失败'));
    } finally {
      setAction(null);
    }
  }, [action]);

  const refreshAudit = useCallback(async () => {
    if (action) {
      return;
    }
    setAction('audit');
    try {
      setAudit(await getAudit(AUDIT_PAGE_SIZE));
    } catch (failure) {
      showToast(errorMessage(failure, '读取审计日志失败'));
    } finally {
      setAction(null);
    }
  }, [action]);

  const exportCsv = useCallback(async () => {
    if (action) {
      return;
    }
    setAction('export');
    try {
      const all = await fetchAllCoupons();
      const target = noteTargetFrom(pairRef.current);
      const rows: CouponCsvRow[] = [];
      for (const coupon of all) {
        rows.push({
          coupon,
          note: await openNote(target, coupon.noteCipher),
        });
      }
      const path = await native.saveDocument(
        encodeCsvBase64(buildCouponCsv(rows)),
        couponsCsvFileName(),
        'text/csv',
      );
      showToast(
        path ? `已导出 ${all.length} 张：${path}` : `已导出 ${all.length} 张`,
        true,
      );
    } catch (failure) {
      showToast(errorMessage(failure, '导出失败'));
    } finally {
      setAction(null);
    }
  }, [action]);

  const openDetail = useCallback(async (coupon: Coupon) => {
    setDetail({
      coupon,
      note: null,
      usedNote: null,
      loading: !!(coupon.noteCipher || coupon.usedNoteCipher),
    });
    const target = noteTargetFrom(pairRef.current);
    const [note, usedNote] = await Promise.all([
      openNote(target, coupon.noteCipher),
      openNote(target, coupon.usedNoteCipher),
    ]);
    setDetail(current =>
      current && current.coupon.id === coupon.id
        ? {...current, note, usedNote, loading: false}
        : current,
    );
  }, []);

  const clearFilters = useCallback(() => {
    setStatusFilter('all');
    setTypeFilter('all');
    setSearchDraft('');
    setAppliedSearch('');
  }, []);

  const filtersActive =
    statusFilter !== 'all' || typeFilter !== 'all' || appliedSearch.length > 0;
  const hasMore = items.length < total;

  const header = (
    <View style={styles.headerWrap}>
      {error && !listLoading ? (
        <View
          style={[
            styles.errorBox,
            {
              backgroundColor: colors.surfaceVariant,
              borderColor: colors.outline,
            },
          ]}>
          <GlassIcon name="info" size={16} />
          <Text
            style={[type.caption, styles.errorText, {color: colors.onSurface}]}>
            {error}
          </Text>
        </View>
      ) : null}

      <SoftCard radius={20} style={styles.statsCard}>
        <StatCell label="可用" value={stats.available} />
        <View style={[styles.statDivider, {backgroundColor: colors.outline}]} />
        <StatCell label="已用" value={stats.used} />
        <View style={[styles.statDivider, {backgroundColor: colors.outline}]} />
        <StatCell label="今日" value={stats.today} />
      </SoftCard>

      <SoftCard radius={20} style={styles.generateCard}>
        <View style={styles.cardTitleRow}>
          <Text style={[type.section, {color: colors.onSurface}]}>
            签发新券
          </Text>
          <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
            {COUPON_MIN_COUNT}–{COUPON_MAX_COUNT} 张
          </Text>
        </View>

        <Segmented
          options={[
            {value: 'hehao', label: COUPON_TYPE_LABELS.hehao},
            {value: 'exam', label: COUPON_TYPE_LABELS.exam},
          ]}
          value={couponType}
          onChange={setCouponType}
        />

        <View style={styles.countRow}>
          <View style={styles.countLabelWrap}>
            <Text style={[type.body, {color: colors.onSurface}]}>数量</Text>
            <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
              一次最多 50 张
            </Text>
          </View>
          <Stepper
            value={count}
            min={COUPON_MIN_COUNT}
            max={COUPON_MAX_COUNT}
            onChange={setCount}
            disabled={action === 'generate'}
          />
        </View>

        <ToggleRow
          label="加密备注"
          hint={
            noteReady
              ? '备注端到端加密，只有你们两台设备能解开'
              : '等小狗端加入并完成配对后可用'
          }
          value={noteEnabled}
          onValueChange={setNoteEnabled}
          disabled={!noteReady || action === 'generate'}
        />

        {noteEnabled ? (
          <TextInput
            value={noteText}
            onChangeText={setNoteText}
            placeholder="例如：今天不吵架，揉十分钟头"
            placeholderTextColor={colors.onSurfaceVariant}
            multiline
            maxLength={NOTE_MAX_LENGTH}
            accessibilityLabel="加密备注"
            style={[
              styles.noteInput,
              {
                color: colors.onSurface,
                backgroundColor: colors.surface,
                borderColor: colors.outline,
              },
            ]}
          />
        ) : null}

        <FlatButton
          label={
            action === 'generate'
              ? '签发中…'
              : `签发 ${count} 张${COUPON_TYPE_LABELS[couponType]}`
          }
          onPress={() => {
            onGenerate().catch(() => undefined);
          }}
          disabled={action !== null}
          icon="add"
          style={styles.generateButton}
        />
      </SoftCard>

      <View style={styles.filterBlock}>
        <Text style={[type.label, styles.filterLabel, {color: colors.onSurfaceVariant}]}>
          状态
        </Text>
        <Segmented
          options={STATUS_OPTIONS}
          value={statusFilter}
          onChange={setStatusFilter}
        />
        <Text style={[type.label, styles.filterLabel, {color: colors.onSurfaceVariant}]}>
          类型
        </Text>
        <Segmented
          options={TYPE_OPTIONS}
          value={typeFilter}
          onChange={setTypeFilter}
        />
        <View style={styles.searchRow}>
          <View style={styles.searchGrow}>
            <SearchInput
              value={searchDraft}
              onChangeText={text => {
                setSearchDraft(text);
                if (!text) {
                  setAppliedSearch('');
                }
              }}
              onSubmit={() => setAppliedSearch(searchDraft.trim())}
            />
          </View>
          <TextButton label="搜索" onPress={() => setAppliedSearch(searchDraft.trim())} />
        </View>
      </View>

      <View style={styles.sectionRow}>
        <Text style={[type.section, {color: colors.onSurface}]}>记录</Text>
        <Text
          style={[
            type.caption,
            tabularNums,
            {color: colors.onSurfaceVariant},
          ]}>
          共 {total} 张
        </Text>
      </View>
    </View>
  );

  const empty = listLoading ? (
    <Text
      style={[type.caption, styles.loadingText, {color: colors.onSurfaceVariant}]}>
      加载中…
    </Text>
  ) : (
    <View style={styles.emptyWrap}>
      <View
        style={[
          styles.emptyIcon,
          {backgroundColor: colors.surfaceVariant},
        ]}>
        <GlassIcon name="file" size={40} />
      </View>
      <Text style={[type.headline, {color: colors.onSurface}]}>
        {filtersActive ? '没有符合条件的券' : '还没有签发过券'}
      </Text>
      <Text
        style={[
          type.body,
          styles.emptyText,
          {color: colors.onSurfaceVariant},
        ]}>
        {filtersActive
          ? '换个筛选条件，或者清除后看看全部记录。'
          : '吵架之后需要一个台阶，就先从这里签发一张。'}
      </Text>
      {filtersActive ? (
        <TextButton label="清除筛选" onPress={clearFilters} />
      ) : null}
    </View>
  );

  return (
    <View style={styles.root}>
      <TopBar
        title="和好券"
        onBack={onBack}
        right={
          <RoundIconButton
            name="settings"
            accessibilityLabel="券设置"
            size={20}
            onPress={() => {
              openSettings().catch(() => undefined);
            }}
          />
        }
      />
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
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
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
        renderItem={({item}) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.typeLabel} ${item.code} ${couponStatusLabel(
              item.status,
            )}`}
            onPress={() => {
              openDetail(item).catch(() => undefined);
            }}
            style={({pressed}) => [
              styles.row,
              {opacity: pressed ? 0.85 : 1},
            ]}>
            <Ticket coupon={item} compact />
            {item.noteCipher ? (
              <Text
                style={[
                  type.caption,
                  styles.noteHint,
                  {color: colors.onSurfaceVariant},
                ]}>
                含加密备注 · 点开查看
              </Text>
            ) : null}
          </Pressable>
        )}
        ListFooterComponent={
          items.length === 0 ? undefined : (
            <View style={styles.footerWrap}>
              {hasMore ? (
                <OutlinedButton
                  label={
                    moreLoading
                      ? '加载中…'
                      : `加载更多（还有 ${Math.max(0, total - items.length)} 张）`
                  }
                  icon="chevronRight"
                  onPress={() => {
                    onLoadMore().catch(() => undefined);
                  }}
                />
              ) : (
                <Text
                  style={[
                    type.caption,
                    styles.footerText,
                    {color: colors.onSurfaceVariant},
                  ]}>
                  已全部加载 · 共 {total} 张
                </Text>
              )}
            </View>
          )
        }
      />

      <AppSheet
        visible={settingsOpen}
        title="券设置"
        onClose={() => setSettingsOpen(false)}>
        <ScrollView
          style={styles.sheetScroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.sheetContent}>
          {keyInfo ? (
            <View style={styles.sheetBlock}>
              <Text
                style={[
                  type.label,
                  styles.blockLabel,
                  {color: colors.onSurfaceVariant},
                ]}>
                签名算法
              </Text>
              <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
                {keyInfo.algorithm} · v{keyInfo.version}
              </Text>
              <Text
                style={[
                  type.label,
                  styles.blockLabel,
                  {color: colors.onSurfaceVariant},
                ]}>
                公钥指纹
              </Text>
              <Text
                selectable
                style={[styles.mono, {color: colors.onSurface}]}>
                {keyInfo.fingerprint}
              </Text>
              <Text
                style={[
                  type.label,
                  styles.blockLabel,
                  {color: colors.onSurfaceVariant},
                ]}>
                公钥 PEM
              </Text>
              <Text
                selectable
                numberOfLines={6}
                style={[styles.mono, {color: colors.onSurfaceVariant}]}>
                {keyInfo.publicKeyPem}
              </Text>
            </View>
          ) : (
            <Text
              style={[
                type.caption,
                styles.sheetLoading,
                {color: colors.onSurfaceVariant},
              ]}>
              {action === 'settings' ? '读取公钥信息…' : '暂时读不到公钥信息'}
            </Text>
          )}

          <Divider color={colors.outline} />

          <View style={styles.sheetBlock}>
            <View style={styles.auditHeader}>
              <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
                审计日志
              </Text>
              <TextButton
                label={action === 'audit' ? '刷新中…' : '刷新'}
                onPress={() => {
                  refreshAudit().catch(() => undefined);
                }}
              />
            </View>
            {audit && audit.length > 0 ? (
              audit.map(entry => (
                <View key={`${entry.at}-${entry.action}`} style={styles.auditRow}>
                  <Text
                    style={[
                      type.caption,
                      styles.auditAction,
                      {color: colors.onSurface},
                    ]}>
                    {AUDIT_LABELS[entry.action] ?? entry.action}
                  </Text>
                  <Text
                    style={[type.caption, {color: colors.onSurfaceVariant}]}
                    numberOfLines={1}>
                    {entry.atDisplay ?? entry.at}
                    {entry.detail ? ` · ${entry.detail}` : ''}
                  </Text>
                  <Text
                    style={[styles.auditActor, tabularNums, {color: colors.onSurfaceVariant}]}
                    numberOfLines={1}>
                    {entry.actor.slice(0, 12)}
                  </Text>
                </View>
              ))
            ) : (
              <Text
                style={[type.caption, {color: colors.onSurfaceVariant}]}>
                {audit ? '还没有券相关操作。' : '读取中…'}
              </Text>
            )}
          </View>

          <Divider color={colors.outline} />

          <View style={styles.sheetBlock}>
            <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
              导出记录
            </Text>
            <Text
              style={[
                type.caption,
                styles.blockLabel,
                {color: colors.onSurfaceVariant},
              ]}>
              CSV 含卡密、类型、状态、时间、备注与签名短码；备注在导出时解密。
            </Text>
            <OutlinedButton
              label={action === 'export' ? '导出中…' : '导出全部 CSV'}
              icon="cloudDownload"
              onPress={() => {
                exportCsv().catch(() => undefined);
              }}
            />
          </View>
        </ScrollView>
      </AppSheet>

      <AppSheet
        visible={detail !== null}
        title="券详情"
        onClose={() => setDetail(null)}>
        {detail ? (
          <ScrollView
            style={styles.sheetScroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.sheetContent}>
            <Ticket coupon={detail.coupon} />
            <View style={styles.sheetBlock}>
              <Text
                style={[
                  type.label,
                  styles.blockLabel,
                  {color: colors.onSurfaceVariant},
                ]}>
                签发备注
              </Text>
              <Text style={[type.body, {color: colors.onSurface}]}>
                {detail.coupon.noteCipher == null
                  ? '无'
                  : detail.loading
                  ? '解密中…'
                  : detail.note ?? NOTE_LOCKED_TEXT}
              </Text>
              {detail.coupon.usedNoteCipher ? (
                <>
                  <Text
                    style={[
                      type.label,
                      styles.blockLabel,
                      {color: colors.onSurfaceVariant},
                    ]}>
                    核销备注
                  </Text>
                  <Text style={[type.body, {color: colors.onSurface}]}>
                    {detail.loading
                      ? '解密中…'
                      : detail.usedNote ?? NOTE_LOCKED_TEXT}
                  </Text>
                </>
              ) : null}
              <Text
                style={[
                  type.caption,
                  styles.noteHint,
                  {color: colors.onSurfaceVariant},
                ]}>
                备注使用端到端加密，只有你们两台设备能解开。
              </Text>
            </View>

            {detail.coupon.type === 'reward' &&
            detail.coupon.status === 'unused' &&
            onRedeem ? (
              <View style={styles.sheetBlock}>
                <Text
                  style={[
                    type.caption,
                    {color: colors.onSurfaceVariant},
                  ]}>
                  这是小狗派发的奖励券：领取时写下你想要的奖励，内容会加密保存。
                </Text>
                <FlatButton
                  label="去领取奖励"
                  icon="favorite"
                  onPress={() => {
                    setDetail(null);
                    onRedeem(detail.coupon);
                  }}
                />
              </View>
            ) : null}
          </ScrollView>
        ) : null}
      </AppSheet>
    </View>
  );
}

function StatCell({label, value}: {label: string; value: number}) {
  const {colors} = useAppTheme();
  return (
    <View style={styles.statCell}>
      <Text
        style={[styles.statValue, tabularNums, {color: colors.onSurface}]}>
        {value}
      </Text>
      <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  listContent: {paddingTop: 4, gap: 10},
  headerWrap: {gap: 14, paddingBottom: 4},
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorText: {flex: 1},
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  statCell: {flex: 1, alignItems: 'center', gap: 2},
  statValue: {fontSize: 24, fontWeight: '700'},
  statDivider: {width: StyleSheet.hairlineWidth, alignSelf: 'stretch'},
  generateCard: {padding: 16, gap: 12},
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  countLabelWrap: {gap: 2},
  noteInput: {
    minHeight: 68,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  generateButton: {marginTop: 2},
  filterBlock: {gap: 8},
  filterLabel: {marginTop: 2, letterSpacing: 0.6},
  searchRow: {flexDirection: 'row', alignItems: 'center', gap: 4},
  searchGrow: {flex: 1},
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  row: {gap: 4},
  noteHint: {marginTop: 2, marginLeft: 4},
  loadingText: {paddingVertical: 24, textAlign: 'center'},
  emptyWrap: {alignItems: 'center', paddingVertical: 28, gap: 8},
  emptyIcon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyText: {textAlign: 'center'},
  footerWrap: {alignItems: 'center', paddingVertical: 12},
  footerText: {textAlign: 'center'},
  sheetScroll: {maxHeight: 420},
  sheetContent: {gap: 14, paddingBottom: 10},
  sheetBlock: {gap: 6},
  sheetLoading: {paddingVertical: 8},
  blockLabel: {marginTop: 4},
  mono: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: 'monospace',
  },
  auditHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  auditRow: {gap: 1, paddingVertical: 4},
  auditAction: {fontWeight: '600'},
  auditActor: {fontSize: 10},
});
