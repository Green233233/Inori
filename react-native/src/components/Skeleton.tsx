import React, {useEffect, useRef} from 'react';
import {Animated, StyleSheet, View, ViewStyle} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {DURATION, EASE, USE_NATIVE_DRIVER} from '../theme/motion';
import {useReducedMotion} from '../motion/useReducedMotion';

/** Static structural skeleton with a lightweight native opacity pulse. */
export function SkeletonBlock({
  height = 16,
  width = '100%',
  radius = 8,
  style,
}: {
  height?: number;
  width?: number | `${number}%`;
  radius?: number;
  style?: ViewStyle;
}) {
  const {surfaces} = useAppTheme();
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    if (reduced) {
      pulse.setValue(0.7);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: DURATION.skeleton,
          easing: EASE.inOut,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(pulse, {
          toValue: 0.55,
          duration: DURATION.skeleton,
          easing: EASE.inOut,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);

  return (
    <Animated.View
      style={[
        {
          height,
          width,
          borderRadius: radius,
          backgroundColor: surfaces.raisedAlt,
          opacity: pulse,
        },
        style,
      ]}
    />
  );
}

export function HomeSkeleton() {
  return (
    <View style={styles.root}>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={styles.row}>
          <SkeletonBlock width={58} height={78} radius={12} />
          <View style={styles.lines}>
            <SkeletonBlock width="72%" height={15} />
            <SkeletonBlock width="92%" height={11} />
            <SkeletonBlock width="48%" height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {gap: 10},
  row: {flexDirection: 'row', gap: 12, alignItems: 'center'},
  lines: {flex: 1, gap: 9},
});
