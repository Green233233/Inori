/**
 * 券详情：票面 + 校验真伪（只读，不消耗）+ 「去核销」入口。
 *
 * 校验结果用三态横幅表达：绿=真实可用，琥珀=已被使用，红=签名不符/不存在。
 * 备注按需解密，解密失败降级为「无法解密」，不会让页面崩溃。
 */
import React, {useCallback, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {TopBar} from '../../components/TopBar';
import {SoftCard} from '../../components/Surfaces';
import {FlatButton, OutlinedButton, TextButton} from '../../components/Ui';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {type} from '../../theme/typography';
import {useQi} from '../qi/QiProvider';
import type {Coupon} from '../../data/pairTypes';
import {errorMessage} from '../../net/ApiClient';
import {
  describeVerifyResult,
  verifyCoupon,
  type CouponBanner,
  type CouponVerifyResult,
} from '../../data/couponApi';
import {Ticket} from './Ticket';
import {StatusBanner} from './controls';
import {NOTE_LOCKED_TEXT, noteTargetFrom, openNote} from './noteCipher';

export interface CouponDetailProps {
  coupon: Coupon;
  onBack?: () => void;
  /** 「去核销」入口；已用券或不需要入口时可不传。 */
  onRedeem?: (coupon: Coupon) => void;
  /** 校验成功后回调（可选，供外部刷新列表）。 */
  onVerified?: (result: CouponVerifyResult) => void;
}

export default function CouponDetail({
  coupon,
  onBack,
  onRedeem,
  onVerified,
}: CouponDetailProps) {
  const {colors, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {pair} = useQi();

  const [verifying, setVerifying] = useState(false);
  const [banner, setBanner] = useState<CouponBanner | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesLoading, setNotesLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [usedNote, setUsedNote] = useState<string | null>(null);

  const verify = useCallback(async () => {
    if (verifying) {
      return;
    }
    setVerifying(true);
    try {
      const result = await verifyCoupon(coupon.normalizedCode);
      setBanner(describeVerifyResult(result));
      onVerified?.(result);
    } catch (failure) {
      setBanner({
        tone: 'red',
        title: '校验失败',
        message: errorMessage(failure),
      });
    } finally {
      setVerifying(false);
    }
  }, [coupon.normalizedCode, onVerified, verifying]);

  const loadNotes = useCallback(async () => {
    if (notesOpen || notesLoading) {
      return;
    }
    setNotesOpen(true);
    setNotesLoading(true);
    try {
      const target = noteTargetFrom(pair);
      const [nextNote, nextUsedNote] = await Promise.all([
        openNote(target, coupon.noteCipher),
        openNote(target, coupon.usedNoteCipher),
      ]);
      setNote(nextNote);
      setUsedNote(nextUsedNote);
    } finally {
      setNotesLoading(false);
    }
  }, [
    coupon.noteCipher,
    coupon.usedNoteCipher,
    notesLoading,
    notesOpen,
    pair,
  ]);

  const hasNoteCipher = !!coupon.noteCipher || !!coupon.usedNoteCipher;
  const lockedSomeNote =
    (!!coupon.noteCipher && note === null) ||
    (!!coupon.usedNoteCipher && usedNote === null);

  return (
    <View style={styles.root}>
      <TopBar title={coupon.typeLabel} onBack={onBack} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: tokens.contentPadding,
            paddingBottom: insets.bottom + 32,
          },
        ]}
        showsVerticalScrollIndicator={false}>
        <Ticket coupon={coupon} />

        {banner ? (
          <View style={styles.block}>
            <StatusBanner
              tone={banner.tone}
              title={banner.title}
              message={banner.message}
            />
          </View>
        ) : null}

        {hasNoteCipher ? (
          <View style={styles.block}>
            <SoftCard radius={16} style={styles.noteCard}>
              <View style={styles.noteHeader}>
                <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
                  加密备注
                </Text>
                {!notesOpen ? (
                  <TextButton
                    label={notesLoading ? '解密中…' : '解密查看'}
                    onPress={() => {
                      loadNotes().catch(() => undefined);
                    }}
                  />
                ) : null}
              </View>
              {notesOpen ? (
                notesLoading ? (
                  <Text
                    style={[
                      type.caption,
                      {color: colors.onSurfaceVariant},
                    ]}>
                    解密中…
                  </Text>
                ) : (
                  <View style={styles.noteBody}>
                    {coupon.noteCipher ? (
                      <Text style={[type.body, {color: colors.onSurface}]}>
                        {note ?? NOTE_LOCKED_TEXT}
                      </Text>
                    ) : null}
                    {coupon.usedNoteCipher ? (
                      <View style={styles.noteBody}>
                        <Text
                          style={[
                            type.label,
                            {color: colors.onSurfaceVariant},
                          ]}>
                          核销备注
                        </Text>
                        <Text style={[type.body, {color: colors.onSurface}]}>
                          {usedNote ?? NOTE_LOCKED_TEXT}
                        </Text>
                      </View>
                    ) : null}
                    {lockedSomeNote ? (
                      <Text
                        style={[
                          type.caption,
                          {color: colors.onSurfaceVariant},
                        ]}>
                        密钥对不上（可能换过设备或解绑过），这段备注已经无法解开。
                      </Text>
                    ) : null}
                  </View>
                )
              ) : (
                <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
                  备注端到端加密，只有你们两台设备能解开。
                </Text>
              )}
            </SoftCard>
          </View>
        ) : null}

        <View style={styles.block}>
          <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
            校验只读不消耗；核销才会把券标记为已用，且不可撤销。
          </Text>
        </View>

        <View style={styles.block}>
          <OutlinedButton
            label={verifying ? '校验中…' : '校验真伪'}
            icon="check"
            onPress={() => {
              verify().catch(() => undefined);
            }}
          />
        </View>

        {coupon.status === 'unused' && onRedeem ? (
          <FlatButton label="去核销" onPress={() => onRedeem(coupon)} />
        ) : coupon.status === 'unused' ? (
          <Text
            style={[
              type.caption,
              styles.usedHint,
              {color: colors.onSurfaceVariant},
            ]}>
            这张券还在有效期内，核销后才会标记为已用。
          </Text>
        ) : (
          <Text
            style={[
              type.caption,
              styles.usedHint,
              {color: colors.onSurfaceVariant},
            ]}>
            {coupon.usedAtDisplay
              ? `已于 ${coupon.usedAtDisplay} 核销，不能再用。`
              : '这张券已经用过了。'}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  content: {paddingTop: 4, gap: 14},
  block: {gap: 8},
  noteCard: {padding: 14, gap: 8},
  noteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  noteBody: {gap: 6},
  usedHint: {textAlign: 'center', paddingVertical: 8},
});
