/**
 * 核销流程：输入 / 从名下券选择 → 只验不耗的三态校验 → AppDialog 二次确认
 * （可填端到端加密备注）→ 结果页。
 *
 * 核销不可逆，所以确认框是硬性的；失败按 ApiError.code 分三态：
 * 409 already_used 琥珀，409 signature_invalid / 404 not_found / 400 红。
 */
import React, {useCallback, useRef, useState} from 'react';
import {
  Pressable,
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
  AppDialog,
  AppSheet,
  FlatButton,
  TextButton,
} from '../../components/Ui';
import {showToast} from '../../components/toast';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {type} from '../../theme/typography';
import {useQi} from '../qi/QiProvider';
import type {Coupon} from '../../data/pairTypes';
import {errorMessage} from '../../net/ApiClient';
import {
  COUPON_CODE_LENGTH,
  describeRedeemError,
  describeVerifyResult,
  isRewardCoupon,
  listCoupons,
  normalizeCouponInput,
  redeemCoupon,
  verifyCoupon,
  type CouponBanner,
  type CouponVerifyResult,
  type RedeemFailure,
} from '../../data/couponApi';
import {Ticket} from './Ticket';
import {CouponCodeField, StatusBanner} from './controls';
import {
  canEncryptNote,
  NOTE_MAX_LENGTH,
  noteTargetFrom,
  sealNote,
} from './noteCipher';

export interface CouponRedeemProps {
  onBack?: () => void;
  /** 核销成功点「完成」时回调。 */
  onRedeemed?: (coupon: Coupon) => void;
  /** 预填卡密（从券详情进入时传券）。 */
  initialCoupon?: Coupon | null;
  /** 预填卡密（手动从别处带进来）。 */
  initialCode?: string;
}

export default function CouponRedeem({
  onBack,
  onRedeemed,
  initialCoupon,
  initialCode,
}: CouponRedeemProps) {
  const {colors, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {pair} = useQi();
  const pairRef = useRef(pair);
  pairRef.current = pair;

  const [codeDisplay, setCodeDisplay] = useState(
    initialCoupon?.code ?? initialCode ?? '',
  );
  const [verification, setVerification] =
    useState<CouponVerifyResult | null>(null);
  const [banner, setBanner] = useState<CouponBanner | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [result, setResult] = useState<Coupon | null>(null);
  const [failure, setFailure] = useState<RedeemFailure | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerItems, setPickerItems] = useState<Coupon[]>([]);

  const {normalized} = normalizeCouponInput(codeDisplay);
  const complete = normalized.length === COUPON_CODE_LENGTH;
  const remaining = COUPON_CODE_LENGTH - normalized.length;
  const noteReady = canEncryptNote(noteTargetFrom(pair));
  const isReward = isRewardCoupon(
    verification?.coupon?.type ?? initialCoupon?.type,
  );
  const verifiedUnused =
    !!verification &&
    verification.exists &&
    verification.signatureValid &&
    verification.status === 'unused';
  // 奖励券要能加密保存奖励内容，没有对端公钥时不给走。
  const canRedeem = verifiedUnused && (!isReward || noteReady);

  const changeCode = useCallback((next: string) => {
    setCodeDisplay(next);
    setVerification(null);
    setBanner(null);
    setFailure(null);
  }, []);

  const runVerify = useCallback(async () => {
    if (verifying || normalized.length !== COUPON_CODE_LENGTH) {
      return;
    }
    setVerifying(true);
    setBanner(null);
    setFailure(null);
    try {
      const next = await verifyCoupon(normalized);
      setVerification(next);
      setBanner(describeVerifyResult(next));
    } catch (incomplete) {
      setVerification(null);
      setBanner({
        tone: 'red',
        title: '校验失败',
        message: errorMessage(incomplete),
      });
    } finally {
      setVerifying(false);
    }
  }, [normalized, verifying]);

  const confirmRedeem = useCallback(async () => {
    if (redeeming || normalized.length !== COUPON_CODE_LENGTH) {
      return;
    }
    if (isReward && !noteText.trim()) {
      showToast('请先写清楚想要的奖励');
      return;
    }
    setRedeeming(true);
    setFailure(null);
    try {
      let noteCipher: string | undefined;
      if (noteText.trim()) {
        if (!canEncryptNote(noteTargetFrom(pairRef.current))) {
          throw new Error('还没有对方的公钥，备注只能留空');
        }
        noteCipher = await sealNote(
          noteTargetFrom(pairRef.current),
          noteText,
        );
      }
      const coupon = await redeemCoupon(normalized, noteCipher);
      setResult(coupon);
      setConfirmOpen(false);
      setNoteText('');
      showToast(isReward ? '领取成功' : '核销成功');
    } catch (incomplete) {
      setConfirmOpen(false);
      const described = describeRedeemError(incomplete);
      setFailure(described);
      setBanner({
        tone: described.tone,
        title: described.title,
        message: described.message,
      });
    } finally {
      setRedeeming(false);
    }
  }, [isReward, noteText, normalized, redeeming]);

  const openPicker = useCallback(async () => {
    if (pickerLoading) {
      return;
    }
    setPickerOpen(true);
    setPickerLoading(true);
    try {
      const page = await listCoupons({
        status: 'unused',
        limit: 50,
        offset: 0,
      });
      setPickerItems(page.items);
    } catch (incomplete) {
      showToast(errorMessage(incomplete, '读取名下券失败'));
    } finally {
      setPickerLoading(false);
    }
  }, [pickerLoading]);

  const chooseCoupon = useCallback(
    (coupon: Coupon) => {
      changeCode(coupon.code);
      setPickerOpen(false);
    },
    [changeCode],
  );

  if (result) {
    return (
      <View style={styles.root}>
        <TopBar title={isReward ? '领取结果' : '核销结果'} onBack={onBack} />
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingHorizontal: tokens.contentPadding,
              paddingBottom: insets.bottom + 32,
            },
          ]}
          showsVerticalScrollIndicator={false}>
          <StatusBanner
            tone="green"
            title={isReward ? '领取成功' : '核销成功'}
            message={
              result.usedAtDisplay
                ? `已于 ${result.usedAtDisplay} 标记为已用。`
                : '这张券已经标记为已用，不能再次核销。'
            }
          />
          <Ticket coupon={result} />
          <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
            备注（如果有）已端到端加密保存，只有你们两台设备能解开。
          </Text>
          <FlatButton
            label="完成"
            onPress={() => onRedeemed?.(result)}
            icon="check"
          />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <TopBar title="核销和好券" onBack={onBack} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: tokens.contentPadding,
            paddingBottom: insets.bottom + 32,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
          {isReward
            ? '这是小狗给你派发的奖励券：先校验真伪，再写下你想要的奖励并领取。校验不会消耗这张券。'
            : '输入主人给的卡密，先校验真伪，再决定是否核销。校验不会消耗这张券。'}
        </Text>

        <SoftCard radius={18} style={styles.codeCard}>
          <Text style={[type.label, {color: colors.onSurfaceVariant}]}>
            卡密
          </Text>
          <CouponCodeField
            display={codeDisplay}
            onDisplayChange={changeCode}
            onSubmitEditing={() => {
              runVerify().catch(() => undefined);
            }}
            busy={verifying || redeeming}
            invalid={!!banner && banner.tone === 'red' && !complete}
          />
          <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
            {complete
              ? '格式正确：7 位字母 + 7 位数字。'
              : remaining > 0
              ? `还差 ${remaining} 位；允许小写、空格与 · `
              : ''}
          </Text>
          <TextButton
            label="从名下券选择"
            onPress={() => {
              openPicker().catch(() => undefined);
            }}
          />
        </SoftCard>

        {banner ? (
          <StatusBanner
            tone={banner.tone}
            title={banner.title}
            message={banner.message}
          />
        ) : null}

        {failure ? (
          <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
            换一张券，或者检查卡密是否抄错。
          </Text>
        ) : null}

        {canRedeem ? (
          <FlatButton
            label={isReward ? '确认领取' : '确认核销'}
            onPress={() => setConfirmOpen(true)}
            icon="check"
          />
        ) : isReward && verifiedUnused ? (
          <FlatButton
            label="填写奖励内容"
            onPress={() => setConfirmOpen(true)}
            icon="favorite"
          />
        ) : (
          <FlatButton
            label={verifying ? '校验中…' : '校验卡密'}
            onPress={() => {
              runVerify().catch(() => undefined);
            }}
            disabled={!complete || verifying || redeeming}
            icon="check"
          />
        )}
      </ScrollView>

      <AppDialog
        visible={confirmOpen}
        title={isReward ? '确认领取这份奖励？' : '确认核销这张券？'}
        message={
          isReward
            ? '领取后这张奖励券会标记为「已用」，奖励内容会加密保存，小狗能看到。'
            : '核销不可撤销：这张券会立刻变成「已用」，之后谁都再用不了。'
        }
        confirmLabel={
          redeeming ? (isReward ? '领取中…' : '核销中…') : isReward ? '确认领取' : '确认核销'
        }
        onConfirm={() => {
          confirmRedeem().catch(() => undefined);
        }}
        dismissLabel="再想想"
        onDismiss={() => {
          if (!redeeming) {
            setConfirmOpen(false);
          }
        }}
        destructive>
        <View style={styles.dialogNoteWrap}>
          <Text style={[type.label, {color: colors.onSurfaceVariant}]}>
            {isReward ? '奖励内容（必填）' : '核销备注（可选）'}
          </Text>
          <TextInput
            value={noteText}
            onChangeText={setNoteText}
            placeholder={
              !noteReady
                ? '配对后才能加密备注'
                : isReward
                ? '例如：一次按摩 / 一顿火锅'
                : '例如：这次是我不好'
            }
            placeholderTextColor={colors.onSurfaceVariant}
            maxLength={NOTE_MAX_LENGTH}
            multiline
            accessibilityLabel="核销备注"
            editable={noteReady && !redeeming}
            style={[
              styles.dialogNoteInput,
              {
                color: colors.onSurface,
                backgroundColor: colors.surface,
                borderColor: colors.outline,
              },
            ]}
          />
          <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
            {isReward
              ? '这份奖励内容会加密后保存，只有你们两台设备能解开。'
              : '备注会先加密再上传，服务器读不到内容。'}
          </Text>
        </View>
      </AppDialog>

      <AppSheet
        visible={pickerOpen}
        title="选择我的券"
        onClose={() => setPickerOpen(false)}>
        <ScrollView
          style={styles.pickerScroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.pickerContent}>
          {pickerLoading ? (
            <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
              加载中…
            </Text>
          ) : pickerItems.length === 0 ? (
            <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
              名下还没有可用的券。
            </Text>
          ) : (
            pickerItems.map(coupon => (
              <Pressable
                key={coupon.id}
                accessibilityRole="button"
                accessibilityLabel={`选择 ${coupon.code}`}
                onPress={() => chooseCoupon(coupon)}
                style={({pressed}) => [{opacity: pressed ? 0.85 : 1}]}>
                <Ticket coupon={coupon} compact />
              </Pressable>
            ))
          )}
        </ScrollView>
      </AppSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  content: {paddingTop: 4, gap: 14},
  codeCard: {padding: 14, gap: 10},
  dialogNoteWrap: {gap: 6, marginTop: 6},
  dialogNoteInput: {
    minHeight: 64,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  pickerScroll: {maxHeight: 420},
  pickerContent: {gap: 10, paddingBottom: 10},
});
