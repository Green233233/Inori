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
import {onAccentFor, withAlpha} from '../theme/palette';
import {type} from '../theme/typography';
import {GlassIcon} from '../components/GlassIcon';
import {TopBar} from '../components/TopBar';
import {OutlinedButton} from '../components/Ui';
import {ColorField} from '../components/Surfaces';
import {showToast} from '../components/toast';
import {UpdateSheet} from '../components/UpdatePrompt';
import {useReducedMotion} from '../motion/useReducedMotion';
import {APP_NAME, DEDICATION, VERSION_NAME} from '../config';
import {checkForUpdate, type UpdateCheckResult} from '../api/appUpdate';

interface Particle {
  id: number;
  x: number;
  size: number;
  icon: 'favorite' | 'star';
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
  const reduced = useReducedMotion();
  const [particles, setParticles] = useState<Particle[]>([]);
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null);
  const taps = useRef(0);

  const spawnParticles = () => {
    if (reduced) {
      return;
    }
    const next: Particle[] = [];
    for (let i = 0; i < 24; i += 1) {
      next.push({
        id: Date.now() + i,
        x: Math.random(),
        size: 12 + Math.random() * 18,
        icon: Math.random() < 0.5 ? 'favorite' : 'star',
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

  const onCheckUpdate = async () => {
    if (checking) {
      return;
    }
    setChecking(true);
    try {
      const next = await checkForUpdate();
      if (!next) {
        showToast('网络不太好，稍后再试');
        return;
      }
      if (!next.hasUpdate) {
        showToast('已经是最新版本');
        return;
      }
      setUpdate(next);
    } finally {
      setChecking(false);
    }
  };

  return (
    <View style={styles.root}>
      <TopBar title="关于" onBack={onBack} titleSize={28} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: tokens.contentPadding,
          paddingTop: 8,
          paddingBottom: 40,
        }}>
        <ColorField color={colors.primary} radius={24} style={styles.hero}>
          <View style={styles.iconBubble}>
            <GlassIcon name="book" size={52} tone="onAccent" />
          </View>
          <Text style={[styles.appName, {color: onAccentFor(colors.primary)}]}>
            {APP_NAME}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`版本 ${VERSION_NAME}`}
            onPress={onVersionTap}
            hitSlop={10}>
            <Text
              style={[
                type.caption,
                styles.version,
                {color: withAlpha(onAccentFor(colors.primary), 0.8)},
              ]}>
              {VERSION_NAME}
            </Text>
          </Pressable>
        </ColorField>

        <Text
          style={[
            styles.dedication,
            {
              color: colors.onSurfaceVariant,
              fontSize: tokens.isNarrow ? 13 : 15,
            },
          ]}>
          {DEDICATION}
        </Text>
        <Text style={[type.caption, styles.note, {color: colors.onSurfaceVariant}]}>
          本软件使用了若干开源组件与 Glass Icons，详见许可证信息。
        </Text>

        <View style={styles.actions}>
          <OutlinedButton
            label="开放源代码许可"
            icon="file"
            onPress={onOpenLicenses}
            textColor={colors.onSurface}
          />
          <OutlinedButton
            label={checking ? '检查中…' : '检查更新'}
            icon="refresh"
            onPress={onCheckUpdate}
            textColor={colors.onSurface}
          />
        </View>
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
                    outputRange: [
                      `${particle.rotate}deg`,
                      `${particle.rotate + 360}deg`,
                    ],
                  }),
                },
              ],
            }}>
            <GlassIcon name={particle.icon} size={particle.size} />
          </Animated.View>
        ))}
      </View>

      <UpdateSheet
        visible={update !== null}
        update={update}
        onClose={() => setUpdate(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  hero: {
    minHeight: 248,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBubble: {
    width: 96,
    height: 96,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  appName: {
    fontSize: 38,
    lineHeight: 42,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginTop: 16,
  },
  version: {marginTop: 4},
  dedication: {
    fontStyle: 'italic',
    textAlign: 'center',
    paddingHorizontal: 8,
    marginTop: 28,
  },
  note: {textAlign: 'center', marginTop: 12, opacity: 0.8},
  actions: {marginTop: 28, gap: 10},
});
