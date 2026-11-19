/**
 * 位置预览：内置 Leaflet 地图（本地资产）+ 中文地址文案。
 *
 * 早先这里是「2×2 张 OSM 静态瓦片 + 6 秒降级」的纯 RN 实现；现在地图本身交给
 * [QiMap]（WebView + 本地 leaflet），这一层只保留调用方原本依赖的导出/属性，
 * 并负责：地址当主文案、经纬度当小字、始终留一个「在地图里打开（浏览器）」。
 *
 * 非交互预览会在 WebView 上盖一层透明按钮：点地图等于打开浏览器，和旧体验一致；
 * 需要拖动/缩放时传 `interactive`，覆盖层会自动让开。
 */
import React from 'react';
import {Linking, Pressable, StyleSheet, Text, View} from 'react-native';

import {useAppTheme} from '../theme/AppThemeProvider';
import {type} from '../theme/typography';
import {QiMap} from './QiMap';

type Props = {
  lat: number;
  lng: number;
  /** 高度，默认 180。宽度自适应父容器。 */
  height?: number;
  /** 显示在底部的小字（旧调用方把地址放在这里，仍然兼容）。 */
  caption?: string;
  /** 主文案（通常是中文地址）；缺省时退回 caption。 */
  label?: string | null;
  /** 允许拖动/缩放，默认 false（预览模式，点按打开浏览器）。 */
  interactive?: boolean;
};

export function MapPreview({
  lat,
  lng,
  height = 180,
  caption,
  label,
  interactive = false,
}: Props) {
  const {colors} = useAppTheme();
  const address = (label ?? caption ?? '').trim();
  const extraCaption =
    caption && address && caption.trim() !== address ? caption : null;

  const openInMaps = () => {
    const url = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
    Linking.openURL(url).catch(() => undefined);
  };

  return (
    <View>
      <View>
        <QiMap
          lat={lat}
          lng={lng}
          height={height}
          label={address || undefined}
          interactive={interactive}
          // 下面已经有一个常驻链接，降级块里不再重复。
          fallbackLink={false}
        />
        {!interactive ? (
          <Pressable
            accessibilityLabel="在地图中打开这个位置"
            onPress={openInMaps}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
      </View>
      {address ? (
        <Text
          style={[type.body, styles.address, {color: colors.onSurface}]}
          numberOfLines={2}>
          {address}
        </Text>
      ) : null}
      <Text
        style={[
          type.caption,
          address ? styles.coords : styles.coordsWithoutAddress,
          {color: colors.onSurfaceVariant},
        ]}>
        {lat.toFixed(5)}, {lng.toFixed(5)}
      </Text>
      {extraCaption ? (
        <Text
          style={[
            type.caption,
            styles.extraCaption,
            {color: colors.onSurfaceVariant},
          ]}>
          {extraCaption}
        </Text>
      ) : null}
      <Pressable accessibilityRole="link" onPress={openInMaps} style={styles.link}>
        <Text style={[type.caption, {color: colors.primary}]}>
          在地图里打开（浏览器）
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  address: {marginTop: 8},
  coords: {marginTop: 2},
  coordsWithoutAddress: {marginTop: 8},
  extraCaption: {marginTop: 4},
  link: {marginTop: 6},
});
