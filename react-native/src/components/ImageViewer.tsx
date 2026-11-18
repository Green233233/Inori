/**
 * 全局图片查看器。
 *
 * 所有需要「点开看大图」的地方都走这里：小狗端截图、日记/手账图片、相册分享等。
 *
 * 缩放使用 WebView（Chromium）自带的手势：双指捏合、双击放大、单指拖动都很顺滑，
 * 不额外引入 native 手势库。长按由页面里的 contextmenu 事件回传，再弹出
 * 「保存到本地 / 取消」。
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Modal, Pressable, StyleSheet, Text, View} from 'react-native';
import {WebView as RNWebView} from 'react-native-webview';

const WebView: any = RNWebView;
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAppTheme} from '../theme/AppThemeProvider';
import {type} from '../theme/typography';
import {GlassSurface} from './Surfaces';
import {FlatButton} from './Ui';
import {native} from '../native/InorinalNative';

function fileNameFor(uri: string, fileName?: string): string {
  if (fileName) {
    return fileName;
  }
  const tail = uri.split('?')[0].split('/').pop() ?? '';
  if (tail && tail.includes('.')) {
    return tail;
  }
  return `qi-image-${Date.now()}.jpg`;
}

async function toBase64(uri: string): Promise<string> {
  if (uri.startsWith('data:')) {
    const comma = uri.indexOf(',');
    return comma >= 0 ? uri.slice(comma + 1) : '';
  }
  const path = decodeURIComponent(uri.replace(/^file:\/\//, ''));
  return native.readBase64(path);
}

const VIEWER_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=6.0, user-scalable=yes, viewport-fit=cover">
<style>
  html, body { margin:0; padding:0; height:100%; background:#000; overflow:hidden; }
  #wrap { width:100%; height:100%; position:relative; overflow:hidden; background:#000;
          touch-action:none; -webkit-user-select:none; user-select:none; }
  img { position:absolute; top:0; left:0; width:100%; height:100%; object-fit:contain;
        transform-origin:0 0; will-change:transform;
        -webkit-user-drag:none; -webkit-touch-callout:none; }
</style></head>
<body><div id="wrap"><img id="img" alt="" /></div>
<script>
  var img = document.getElementById('img');
  var wrap = document.getElementById('wrap');
  img.addEventListener('error', function () {
    var src = img.getAttribute('src') || '';
    if (!src) { return; }
    post({type: 'error', len: src.length, head: src.slice(0, 48)});
  });
  img.addEventListener('load', function () { post({type: 'shown'}); });
  var scale = 1, tx = 0, ty = 0;
  var startScale = 1, startTx = 0, startTy = 0, dragStartX = 0, dragStartY = 0;
  var pinchStart = 0, pinchCx = 0, pinchCy = 0;
  var lastTapAt = 0, lastTapX = 0, lastTapY = 0;

  function apply() {
    img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
  }
  function clamp() {
    var w = wrap.clientWidth, h = wrap.clientHeight;
    if (scale <= 1.001) { tx = 0; ty = 0; return; }
    tx = Math.min(0, Math.max(w - w * scale, tx));
    ty = Math.min(0, Math.max(h - h * scale, ty));
  }
  function zoomAt(nextScale, cx, cy) {
    nextScale = Math.min(6, Math.max(1, nextScale));
    var k = nextScale / scale;
    tx = cx - k * (cx - tx);
    ty = cy - k * (cy - ty);
    scale = nextScale;
    clamp(); apply();
    post({type: 'zoom', scale: Math.round(scale * 100) / 100});
  }
  function dist(a, b) {
    var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  wrap.addEventListener('touchstart', function (event) {
    if (event.touches.length === 2) {
      pinchStart = dist(event.touches[0], event.touches[1]);
      startScale = scale;
      pinchCx = (event.touches[0].clientX + event.touches[1].clientX) / 2;
      pinchCy = (event.touches[0].clientY + event.touches[1].clientY) / 2;
      event.preventDefault();
      return;
    }
    if (event.touches.length === 1) {
      var t = event.touches[0];
      startTx = tx; startTy = ty;
      dragStartX = t.clientX; dragStartY = t.clientY;
      var now = Date.now();
      if (now - lastTapAt < 300 &&
          Math.abs(t.clientX - lastTapX) < 40 &&
          Math.abs(t.clientY - lastTapY) < 40) {
        if (scale > 1.05) { zoomAt(1, t.clientX, t.clientY); }
        else { zoomAt(2.5, t.clientX, t.clientY); }
        lastTapAt = 0;
      } else {
        lastTapAt = now; lastTapX = t.clientX; lastTapY = t.clientY;
      }
    }
  }, {passive: false});
  wrap.addEventListener('touchmove', function (event) {
    if (event.touches.length === 2) {
      var d = dist(event.touches[0], event.touches[1]);
      if (pinchStart > 0) { zoomAt(startScale * (d / pinchStart), pinchCx, pinchCy); }
      event.preventDefault();
      return;
    }
    if (event.touches.length === 1 && scale > 1) {
      var t = event.touches[0];
      tx = startTx + (t.clientX - dragStartX);
      ty = startTy + (t.clientY - dragStartY);
      clamp(); apply();
      event.preventDefault();
    }
  }, {passive: false});
  img.addEventListener('contextmenu', function (event) {
    event.preventDefault();
    post({type: 'menu'});
  }, {passive: false});
  document.addEventListener('contextmenu', function (event) {
    event.preventDefault();
  }, {passive: false});
  window.setSource = function (src) {
    scale = 1; tx = 0; ty = 0; apply();
    img.src = src;
  };
  function post(payload) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
    } catch (e) {}
  }
  var bootPosted = false;
  function postLoaded() {
    if (bootPosted) { return; }
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      bootPosted = true;
      post({type: 'loaded'});
    }
  }
  var bootTimer = setInterval(postLoaded, 50);
  setTimeout(function () { if (bootPosted) { clearInterval(bootTimer); } }, 4000);
  setTimeout(postLoaded, 0);
  window.addEventListener('load', postLoaded);
  document.addEventListener('DOMContentLoaded', postLoaded);
  postLoaded();
</script>
</body></html>`;

export function ImageViewer({
  visible,
  uri,
  fileName,
  onClose,
}: {
  visible: boolean;
  uri: string | null;
  fileName?: string;
  onClose: () => void;
}) {
  const {colors} = useAppTheme();
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState('');
  const [pageReady, setPageReady] = useState(false);
  const webRef = useRef<any>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      setMenuOpen(false);
      setHint('');
      setPageReady(false);
    }
  }, [visible, uri]);

  useEffect(
    () => () => {
      if (hintTimer.current) {
        clearTimeout(hintTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (pageReady && uri) {
      webRef.current?.injectJavaScript(
        `window.setSource(${JSON.stringify(uri)}); true;`,
      );
    }
  }, [pageReady, uri]);

  const flash = useCallback((text: string) => {
    setHint(text);
    if (hintTimer.current) {
      clearTimeout(hintTimer.current);
    }
    hintTimer.current = setTimeout(() => setHint(''), 2200);
  }, []);

  const save = useCallback(async () => {
    if (!uri || saving) {
      return;
    }
    setSaving(true);
    setMenuOpen(false);
    try {
      const base64 = await toBase64(uri);
      if (!base64) {
        throw new Error('图片内容为空');
      }
      await native.saveImageToGallery(base64, fileNameFor(uri, fileName));
      flash('已保存到相册');
    } catch (error: any) {
      flash(`保存失败：${error?.message ?? '未知错误'}`);
    } finally {
      setSaving(false);
    }
  }, [uri, fileName, saving, flash]);

  if (!visible || !uri) {
    return null;
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <WebView
          ref={webRef}
          source={{html: VIEWER_HTML, baseUrl: 'file:///android_asset/'}}
          originWhitelist={['file://*', 'about:blank', 'data:*']}
          allowFileAccess
          allowFileAccessFromFileURLs
          javaScriptEnabled
          domStorageEnabled
          setSupportZoom
          setBuiltInZoomControls
          setDisplayZoomControls={false}
          scalesPageToFit
          mixedContentMode="always"
          androidLayerType="hardware"
          onConsoleMessage={(event: any) => {
            console.log('[qi-viewer]', event?.nativeEvent?.message);
          }}
          onError={(event: any) => {
            console.warn('[qi-viewer] webview error', event?.nativeEvent?.description);
          }}
          style={styles.web}
          onMessage={(event: any) => {
            try {
              const payload = JSON.parse(event.nativeEvent.data);
              if (payload.type === 'loaded') {
                setPageReady(true);
              } else if (payload.type === 'menu') {
                setMenuOpen(true);
              } else if (payload.type === 'error') {
                console.log('[qi-viewer] img error', payload.len, payload.head);
                flash('图片加载失败');
              } else if (payload.type === 'zoom') {
                flash(
                  payload.scale > 1.05
                    ? `已放大 ×${payload.scale}`
                    : '已还原大小',
                );
              }
            } catch {}
          }}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭图片"
          style={[styles.closeHit, {top: insets.top + 8}]}
          onPress={onClose}>
          <Text style={styles.closeLabel}>关闭</Text>
        </Pressable>

        {hint ? (
          <View style={[styles.hint, {bottom: insets.bottom + 96}]}>
            <Text style={[type.caption, {color: '#FFFFFF'}]}>{hint}</Text>
          </View>
        ) : null}

        {menuOpen ? (
          <View style={[styles.menuWrap, {paddingBottom: insets.bottom + 16}]}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setMenuOpen(false)}
            />
            <GlassSurface
              strong
              radius={20}
              style={[styles.menu, {backgroundColor: colors.surface}]}>
              <FlatButton
                label={saving ? '保存中…' : '保存到本地'}
                onPress={save}
                disabled={saving}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="取消"
                onPress={() => setMenuOpen(false)}
                style={styles.cancel}>
                <Text style={[type.label, {color: colors.onSurfaceVariant}]}>
                  取消
                </Text>
              </Pressable>
            </GlassSurface>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000000'},
  web: {flex: 1, backgroundColor: '#000000'},
  closeHit: {
    position: 'absolute',
    right: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)',
    zIndex: 3,
  },
  closeLabel: {color: 'rgba(255,255,255,0.9)', fontSize: 14, fontWeight: '600'},
  hint: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  menuWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    zIndex: 4,
  },
  menu: {padding: 14, gap: 6},
  cancel: {alignItems: 'center', paddingVertical: 10},
});
