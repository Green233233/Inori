import React, {useRef, useState} from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {ACCENT, withAlpha} from '../theme/palette';
import {Icon} from '../components/Icon';
import {TopBar} from '../components/TopBar';
import {OutlinedButton} from '../components/Ui';
import {SoftCard} from '../components/Surfaces';
import {showToast} from '../components/toast';
import {APP_NAME, DEDICATION, VERSION_NAME} from '../config';

interface Particle {
  id: number;
  x: number;
  size: number;
  icon: string;
  color: string;
  progress: Animated.Value;
  rotate: number;
}

export function AboutScreen({
  onBack,
  onOpenLicenses,
}: {
  onBack: () => void;
  onOpenLicenses: () => void;
}) {
  const {colors, tokens} = useAppTheme();
  const {width, height} = useWindowDimensions();
  const [particles, setParticles] = useState<Particle[]>([]);
  const taps = useRef(0);

  const spawnParticles = () => {
    const next: Particle[] = [];
    for (let i = 0; i < 30; i += 1) {
      next.push({
        id: Date.now() + i,
        x: Math.random(),
        size: 12 + Math.random() * 20,
        icon: Math.random() < 0.5 ? 'favorite' : 'star',
        color:
          Math.random() < 0.5
            ? withAlpha(ACCENT.favoriteRed, 0.8)
            : withAlpha(ACCENT.starYellow, 0.8),
        progress: new Animated.Value(0),
        rotate: Math.random() * 360,
      });
    }
    setParticles(next);
    next.forEach(item => {
      Animated.timing(item.progress, {
        toValue: 1,
        duration: 5000,
        useNativeDriver: true,
      }).start();
    });
    setTimeout(() => setParticles([]), 5400);
  };

  const onVersionTap = () => {
    taps.current += 1;
    if (taps.current >= 5) {
      taps.current = 0;
      spawnParticles();
    }
  };

  return (
    <View style={styles.root}>
      <TopBar title="关于" onBack={onBack} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: tokens.contentPadding,
          paddingBottom: 40,
          alignItems: 'center',
        }}>
        <View style={{height: tokens.aboutTopSpacer}} />
        <SoftCard
          radius={Math.round(tokens.aboutIconSize * 0.28)}
          backgroundColor={colors.primaryContainer}
          style={[
            styles.iconBlock,
            {
              width: tokens.aboutIconSize,
              height: tokens.aboutIconSize,
            },
          ]}>
          <Icon
            name="auto_stories"
            size={tokens.aboutIconSize * 0.58}
            color={colors.onPrimaryContainer}
          />
        </SoftCard>
        <Text
          style={{
            fontSize: tokens.aboutHeroSize,
            fontWeight: '700',
            color: colors.primary,
            marginTop: 20,
          }}>
          {APP_NAME}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`版本 ${VERSION_NAME}`}
          onPress={onVersionTap}
          hitSlop={10}
          style={{marginTop: 8}}>
          <Text style={{fontSize: 16, color: colors.onSurfaceVariant}}>
            {VERSION_NAME}
          </Text>
        </Pressable>

        <View style={{height: 40}} />
        <Text style={[styles.dedication, {color: withAlpha(colors.onSurfaceVariant, 0.7), fontSize: tokens.isNarrow ? 13 : 15}]}>
          {DEDICATION}
        </Text>
        <View style={{height: 20}} />
        <Text
          style={[
            styles.note,
            {color: withAlpha(colors.onSurfaceVariant, 0.7)},
          ]}>
          本软件使用了若干开源组件与图标，详见许可证信息。
        </Text>
        <View style={{height: 24}} />
        <OutlinedButton
          label="开放源代码许可"
          icon="description"
          onPress={onOpenLicenses}
          style={{alignSelf: 'stretch'}}
        />
        <View style={{height: 12}} />
        <OutlinedButton
          label="检查更新"
          icon="update"
          onPress={() => showToast('当前已是最新版本')}
          style={{alignSelf: 'stretch'}}
        />
      </ScrollView>

      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {particles.map(particle => (
          <Animated.View
            key={particle.id}
            style={{
              position: 'absolute',
              top: -40,
              left: particle.x * Math.max(0, width - particle.size),
              opacity: particle.progress.interpolate({
                inputRange: [0, 0.85, 1],
                outputRange: [1, 1, 0],
              }),
              transform: [
                {
                  translateY: particle.progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, height * 1.2],
                  }),
                },
                {
                  rotate: particle.progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [`${particle.rotate}deg`, `${particle.rotate + 360}deg`],
                  }),
                },
              ],
            }}>
            <Icon
              name={particle.icon}
              size={particle.size}
              color={particle.color}
            />
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  iconBlock: {alignItems: 'center', justifyContent: 'center'},
  dedication: {fontStyle: 'italic', textAlign: 'center', paddingHorizontal: 8},
  note: {fontSize: 12, textAlign: 'center'},
});
