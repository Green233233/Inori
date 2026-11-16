import {useCallback, useRef} from 'react';
import {Animated, GestureResponderEvent} from 'react-native';
import {DURATION, EASE, USE_NATIVE_DRIVER, spring} from '../theme/motion';
import {useReducedMotion} from './useReducedMotion';

/** Press feedback on the compositor only (scale + optional lift). */
export function usePressScale({
  pressedScale = 0.97,
  lift = 0,
}: {pressedScale?: number; lift?: number} = {}) {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(0)).current;

  const animate = useCallback(
    (to: number, withSpring: boolean) => {
      const target = reduced ? 0 : to;
      if (withSpring) {
        Animated.spring(value, {
          toValue: target,
          ...spring.press,
          useNativeDriver: USE_NATIVE_DRIVER,
        }).start();
      } else {
        Animated.timing(value, {
          toValue: target,
          duration: DURATION.feedback,
          easing: EASE.out,
          useNativeDriver: USE_NATIVE_DRIVER,
        }).start();
      }
    },
    [reduced, value],
  );

  const onPressIn = useCallback(
    (_event: GestureResponderEvent) => animate(1, false),
    [animate],
  );
  const onPressOut = useCallback(
    (_event: GestureResponderEvent) => animate(0, true),
    [animate],
  );

  const style = {
    transform: [
      {scale: value.interpolate({inputRange: [0, 1], outputRange: [1, pressedScale]})},
      {translateY: value.interpolate({inputRange: [0, 1], outputRange: [0, -lift]})},
    ],
  };
  return {onPressIn, onPressOut, style};
}
