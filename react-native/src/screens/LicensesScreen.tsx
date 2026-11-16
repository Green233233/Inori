import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {withAlpha} from '../theme/palette';
import {TopBar} from '../components/TopBar';
import {SoftCard} from '../components/Surfaces';

const LICENSES: {
  name: string;
  license: string;
  source: string;
  note: string;
}[] = [
  {
    name: 'React Native',
    license: 'MIT License',
    source: 'https://github.com/facebook/react-native',
    note: '应用界面运行时与原生桥接。',
  },
  {
    name: 'React',
    license: 'MIT License',
    source: 'https://github.com/facebook/react',
    note: '界面组件模型。',
  },
  {
    name: 'react-native-webview',
    license: 'MIT License',
    source: 'https://github.com/react-native-webview/react-native-webview',
    note: '手账编辑器的 WebView 容器。',
  },
  {
    name: 'react-native-safe-area-context',
    license: 'MIT License',
    source: 'https://github.com/th3rdwave/react-native-safe-area-context',
    note: '安全区适配。',
  },
  {
    name: 'JSZip',
    license: 'MIT License',
    source: 'https://github.com/Stuk/jszip',
    note: 'ZIP 备份导出与导入。',
  },
  {
    name: 'Nucleo Glass Icons',
    license: 'Nucleo free icon license',
    source: 'https://nucleoapp.com/svg-glass-icons',
    note: '应用内导航、分类、天气、心情与操作图标（构建时栅格化）。',
  },
  {
    name: 'LXGW WenKai',
    license: 'SIL Open Font License 1.1',
    source: 'https://github.com/lxgw/LxgwWenKai',
    note: '编辑器手写风格字体。',
  },
  {
    name: 'Moveable',
    license: 'MIT License',
    source: 'https://github.com/daybrush/moveable',
    note: '编辑器贴纸拖移、缩放与旋转控制。',
  },
  {
    name: 'Atrament',
    license: 'MIT License',
    source: 'https://github.com/jakubfiala/atrament',
    note: '编辑器涂鸦笔触绘制。',
  },
  {
    name: 'Rough.js',
    license: 'MIT License',
    source: 'https://github.com/rough-stuff/rough',
    note: '编辑器涂鸦手绘风格渲染。',
  },
];

export function LicensesScreen({onBack}: {onBack: () => void}) {
  const {colors, tokens} = useAppTheme();
  return (
    <View style={styles.root}>
      <TopBar title="开放源代码许可" onBack={onBack} titleSize={24} />
      <ScrollView
        contentContainerStyle={{
          padding: tokens.contentPadding,
          paddingTop: 8,
          paddingBottom: 40,
        }}>
        <Text style={[styles.intro, {color: colors.onSurfaceVariant}]}>
          感谢以下开源项目与资源。完整许可证文本请以各项目官方仓库为准。
        </Text>
        <SoftCard
          radius={16}
          style={[styles.card, {marginTop: 16}]}>
          {LICENSES.map((item, index) => (
            <View
              key={item.name}
              style={[
                styles.row,
                index < LICENSES.length - 1
                  ? {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: withAlpha(colors.outline, 0.3),
                    }
                  : null,
              ]}>
              <Text style={[styles.name, {color: colors.onSurface}]}>
                {item.name}
              </Text>
              <Text style={[styles.license, {color: colors.primary}]}>
                {item.license}
              </Text>
              <Text style={[styles.note, {color: colors.onSurfaceVariant}]}>
                {item.note}
              </Text>
              <Text
                style={[
                  styles.source,
                  {color: withAlpha(colors.onSurfaceVariant, 0.8)},
                ]}>
                {item.source}
              </Text>
            </View>
          ))}
        </SoftCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  intro: {fontSize: 14, lineHeight: 21},
  card: {borderRadius: 12, overflow: 'hidden'},
  row: {padding: 16},
  name: {fontSize: 16, fontWeight: '700'},
  license: {fontSize: 13, marginTop: 4},
  note: {fontSize: 13, marginTop: 4, lineHeight: 19},
  source: {fontSize: 12, marginTop: 4},
});
