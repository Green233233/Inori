import React from 'react';
import {Image, Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {type} from '../theme/typography';

const TILE = 256;
const ZOOM = 15;

/** Web-Mercator tile coordinates for a lat/lng pair. */
function tilePoint(lat: number, lng: number) {
  const n = Math.pow(2, ZOOM);
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return {x, y};
}

function tileUrl(x: number, y: number) {
  return `https://tile.openstreetmap.org/${ZOOM}/${x}/${y}.png`;
}

type Props = {
  lat: number;
  lng: number;
  /** 高度，默认 180。宽度自适应父容器。 */
  height?: number;
  /** 显示在底部的小字，例如「精度 30 米 · 12 秒前」。 */
  caption?: string;
};

/**
 * 一张免 key 的地图预览：按坐标拼 2×2 张 OpenStreetMap 瓦片，再叠一个中心点。
 *
 * 为什么不用地图 SDK：接入高德/腾讯需要申请 key 与额外依赖，而这个页面只需要
 * 「大致在哪儿」；OSM 静态瓦片零配置、无 SDK、无后台定位。瓦片取不到时（无网、
 * 被墙）自动降级成坐标文本 + 浏览器打开，不影响主流程。
 */
export function MapPreview({lat, lng, height = 180, caption}: Props) {
  const {colors, surfaces} = useAppTheme();
  const [failed, setFailed] = React.useState(false);
  const loadedRef = React.useRef(0);
  // 瓦片服务被墙或没网时 onError 不一定触发，等 6 秒还没一张成功就降级。
  React.useEffect(() => {
    loadedRef.current = 0;
    const timer = setTimeout(() => {
      if (loadedRef.current === 0) {
        setFailed(true);
      }
    }, 6000);
    return () => clearTimeout(timer);
  }, [lat, lng]);
  const point = tilePoint(lat, lng);
  const baseX = Math.floor(point.x) - 1;
  const baseY = Math.floor(point.y) - 1;
  // 目标点在 2×2 拼图里的像素位置（原点为左上瓦片左上角）。
  const offsetX = (point.x - baseX) * TILE;
  const offsetY = (point.y - baseY) * TILE;
  const tiles = React.useMemo(() => {
    const list: {key: string; dx: number; dy: number; url: string}[] = [];
    for (let dy = 0; dy < 2; dy += 1) {
      for (let dx = 0; dx < 2; dx += 1) {
        list.push({
          key: `${dx}-${dy}`,
          dx,
          dy,
          url: tileUrl(baseX + dx, baseY + dy),
        });
      }
    }
    return list;
  }, [baseX, baseY]);

  const openInMaps = () => {
    const url = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
    Linking.openURL(url).catch(() => undefined);
  };

  return (
    <View>
      <Pressable
        accessibilityLabel="在地图中打开这个位置"
        onPress={openInMaps}
        style={[
          styles.frame,
          {height, backgroundColor: surfaces.sunken},
        ]}>
        {failed ? (
          <View style={styles.fallback}>
            <Text style={[type.body, {color: colors.onSurfaceVariant}]}>
              地图没加载出来，点这里用浏览器打开
            </Text>
            <Text
              style={[
                type.caption,
                {color: colors.onSurfaceVariant, marginTop: 6},
              ]}>
              {lat.toFixed(5)}, {lng.toFixed(5)}
            </Text>
          </View>
        ) : (
          <View
            style={[
              styles.canvas,
              {left: '50%', top: '50%', marginLeft: -offsetX, marginTop: -offsetY},
            ]}>
            {tiles.map(tile => (
              <Image
                key={tile.key}
                source={{
                  uri: tile.url,
                  headers: {'User-Agent': 'Inorinal/0.6.1 (qi app)'},
                }}
                style={[styles.tile, {left: tile.dx * TILE, top: tile.dy * TILE}]}
                onLoad={() => {
                  loadedRef.current += 1;
                }}
                onError={() => setFailed(true)}
              />
            ))}
          </View>
        )}
        {failed ? null : (
          <View
            pointerEvents="none"
            style={[
              styles.pin,
              {borderColor: colors.primary, backgroundColor: colors.surface},
            ]}
          />
        )}
      </Pressable>
      <Pressable accessibilityRole="link" onPress={openInMaps} style={{marginTop: 6}}>
        <Text style={[type.caption, {color: colors.primary}]}>
          在地图里打开（浏览器）
        </Text>
      </Pressable>
      {caption ? (
        <Text
          style={[
            type.caption,
            {color: colors.onSurfaceVariant, marginTop: 6},
          ]}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {borderRadius: 18, overflow: 'hidden'},
  canvas: {position: 'absolute', width: TILE * 2, height: TILE * 2},
  tile: {position: 'absolute', width: TILE, height: TILE},
  pin: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 16,
    height: 16,
    marginLeft: -8,
    marginTop: -8,
    borderRadius: 8,
    borderWidth: 3,
  },
  fallback: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16},
});
