/**
 * 内置 Leaflet 地图（本地资产，不依赖任何地图 SDK / key）。
 *
 * 设计要点：
 *  - 页面是 `file:///android_asset/map/map.html`，leaflet.js / leaflet.css 也放在
 *    `assets/map/`，所以离线也能渲染控件与标记；只有瓦片走 OSM 的 https 地址。
 *  - WebView 只创建一次（source 的 uri 在挂载时确定），之后坐标变化通过
 *    `injectJavaScript` 调页面里的 `window.qiSet(...)` 更新，不重建 WebView。
 *  - 坐标变化小于 1e-5（约 1 米）不注入，避免动画/轮询把桥刷爆。
 *  - 瓦片被墙、WebView 失败、leaflet 缺失都会降级为纯色块 + 中文文案；是否额外
 *    渲染浏览器链接由 [fallbackLink] 控制，方便调用方自己保留一个链接。
 */
import React from 'react';
import {Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import {WebView as RNWebView} from 'react-native-webview';

import {useAppTheme} from '../theme/AppThemeProvider';
import {type} from '../theme/typography';

// react-native-webview 的泛型 props 与 RN 0.88 的 React 类型对不上（props 会
// 收敛成 never），和 EditorScreen / ImageViewer 一样放宽成 any 后使用。
const WebView: any = RNWebView;

const MAP_URL = 'file:///android_asset/map/map.html';
/** 约 1 米：小于它的抖动不值得跨桥注入一次。 */
const MOVE_EPSILON = 1e-5;
/** map.html 正常初始化会立刻 postMessage('ready')，超时仍未 ready 就降级。 */
const LOAD_TIMEOUT_MS = 9000;

export type QiMapProps = {
  lat: number;
  lng: number;
  /** 高度，默认 180。宽度自适应父容器。 */
  height?: number;
  /** 标记旁的文字（通常是中文地址），可为空。 */
  label?: string | null;
  /** 允许拖动/缩放。预览默认 false，避免抢走页面滚动。 */
  interactive?: boolean;
  /** 降级块里是否自带「在地图里打开（浏览器）」链接，默认 true。 */
  fallbackLink?: boolean;
  /** 降级时回调，reason 用于埋点/文案，不影响渲染。 */
  onFallback?: (reason: string) => void;
};

type QiSetPayload = {
  lat: number;
  lng: number;
  label: string;
  interactive: boolean;
};

function buildMapUri(
  lat: number,
  lng: number,
  label: string,
  interactive: boolean,
): string {
  const query = [
    `lat=${encodeURIComponent(String(lat))}`,
    `lng=${encodeURIComponent(String(lng))}`,
    `label=${encodeURIComponent(label)}`,
    `interactive=${interactive ? '1' : '0'}`,
  ].join('&');
  return `${MAP_URL}?${query}`;
}

/** JSON 字符串直接嵌进 JS 之前，转义两个会破坏字符串字面量的行分隔符。 */
function toJsLiteral(payload: QiSetPayload): string {
  return JSON.stringify(payload)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function QiMap({
  lat,
  lng,
  height = 180,
  label,
  interactive = false,
  fallbackLink = true,
  onFallback,
}: QiMapProps) {
  const {colors, surfaces} = useAppTheme();
  const valid = Number.isFinite(lat) && Number.isFinite(lng);
  const safeLabel = (label ?? '').trim();

  const webRef = React.useRef<any>(null);
  const readyRef = React.useRef(false);
  const failedRef = React.useRef(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRef = React.useRef<QiSetPayload>({
    lat,
    lng,
    label: safeLabel,
    interactive,
  });
  const currentRef = React.useRef<QiSetPayload>({
    lat,
    lng,
    label: safeLabel,
    interactive,
  });
  const fallbackCbRef = React.useRef(onFallback);
  fallbackCbRef.current = onFallback;

  const [failed, setFailed] = React.useState(!valid);

  // source 只在挂载时算一次；后续坐标变化都走 injectJavaScript。
  const source = React.useMemo(
    () => ({uri: buildMapUri(lat, lng, safeLabel, interactive)}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const inject = React.useCallback((payload: QiSetPayload) => {
    if (!readyRef.current || !webRef.current) {
      return;
    }
    const script = `(function(){try{window.qiSet&&window.qiSet(${toJsLiteral(
      payload,
    )});}catch(e){}return true;})();`;
    try {
      webRef.current.injectJavaScript(script);
    } catch {
      // WebView 正在销毁时 inject 会抛错，交给 onError/降级，不崩 UI。
    }
  }, []);

  const fail = React.useCallback((reason: string) => {
    if (failedRef.current) {
      return;
    }
    failedRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setFailed(true);
    fallbackCbRef.current?.(reason);
  }, []);

  React.useEffect(() => {
    currentRef.current = {lat, lng, label: safeLabel, interactive};
    if (failedRef.current) {
      return;
    }
    const last = lastRef.current;
    const moved =
      Math.abs(last.lat - lat) > MOVE_EPSILON ||
      Math.abs(last.lng - lng) > MOVE_EPSILON;
    const changed =
      moved || last.label !== safeLabel || last.interactive !== interactive;
    if (!changed) {
      return;
    }
    lastRef.current = {lat, lng, label: safeLabel, interactive};
    inject(lastRef.current);
  }, [lat, lng, safeLabel, interactive, inject]);

  React.useEffect(() => {
    if (!valid) {
      return undefined;
    }
    timerRef.current = setTimeout(() => {
      if (!readyRef.current) {
        fail('webview_timeout');
      }
    }, LOAD_TIMEOUT_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [fail, valid]);

  const onMessage = React.useCallback(
    (event: any) => {
      let payload: any = null;
      try {
        payload = JSON.parse(String(event?.nativeEvent?.data ?? ''));
      } catch {
        return;
      }
      if (!payload || typeof payload !== 'object') {
        return;
      }
      if (payload.type === 'ready') {
        readyRef.current = true;
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        inject(currentRef.current);
        return;
      }
      if (payload.type === 'tileerror') {
        fail(String(payload.reason || 'tiles_unreachable'));
        return;
      }
      if (payload.type === 'fatal') {
        fail(String(payload.reason || 'leaflet_missing'));
      }
    },
    [fail, inject],
  );

  const openInMaps = React.useCallback(() => {
    const url = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
    Linking.openURL(url).catch(() => undefined);
  }, [lat, lng]);

  const reasonText = !valid
    ? '这个位置没有有效的经纬度，暂时画不出地图。'
    : '地图瓦片连不上，可能没网或被网络限制。';

  return (
    <View
      style={[styles.frame, {height, backgroundColor: surfaces.sunken}]}
      accessibilityLabel="位置地图">
      {failed || !valid ? (
        <View style={styles.fallback}>
          <Text style={[type.body, {color: colors.onSurfaceVariant}]}>
            {valid ? '地图没加载出来' : '位置不可用'}
          </Text>
          <Text
            style={[
              type.caption,
              styles.fallbackReason,
              {color: colors.onSurfaceVariant},
            ]}>
            {reasonText}
          </Text>
          {valid ? (
            <Text
              style={[
                type.caption,
                styles.fallbackCoords,
                {color: colors.onSurfaceVariant},
              ]}>
              {lat.toFixed(5)}, {lng.toFixed(5)}
            </Text>
          ) : null}
          {valid && fallbackLink ? (
            <Pressable
              accessibilityRole="link"
              onPress={openInMaps}
              style={styles.fallbackLink}>
              <Text style={[type.caption, {color: colors.primary}]}>
                在地图里打开（浏览器）
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <WebView
          ref={webRef}
          source={source}
          style={styles.fill}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled={false}
          cacheEnabled
          setSupportMultipleWindows={false}
          overScrollMode="never"
          mixedContentMode="never"
          androidLayerType="hardware"
          onMessage={onMessage}
          onError={() => fail('webview_error')}
          onHttpError={() => fail('webview_http_error')}
          onRenderProcessGone={() => fail('webview_crashed')}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {borderRadius: 18, overflow: 'hidden'},
  fill: {flex: 1, backgroundColor: 'transparent'},
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  fallbackReason: {marginTop: 6, textAlign: 'center'},
  fallbackCoords: {marginTop: 6},
  fallbackLink: {marginTop: 10},
});
