import React, {useRef} from 'react';
import {Animated, Pressable, StyleSheet} from 'react-native';
import {GlassIcon} from '../components/GlassIcon';
import {spring, USE_NATIVE_DRIVER} from '../theme/motion';
import {useReducedMotion} from './useReducedMotion';

/** Small pop feedback for the card favorite affordance. */
export function FavoriteButton({
  active,
  onPress,
}: {
  active: boolean;
  onPress: () => void;
}) {
  const reduced = useReducedMotion();
  const pop = useRef(new Animated.Value(0)).current;

  const handlePress = () => {
    if (!reduced) {
      pop.setValue(0);
      Animated.sequence([
        Animated.spring(pop, {
          toValue: 1,
          ...spring.pop,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.spring(pop, {
          toValue: 0,
          ...spring.press,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]).start();
    }
    onPress();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={active ? '取消收藏' : '收藏'}
      accessibilityState={{selected: active}}
      focusable={false}
      hitSlop={8}
      onPress={handlePress}
      style={[
        styles.root,
        active && {backgroundColor: '#FF375F'},
      ]}>
      <Animated.View
        style={{
          transform: [
            {
              scale: pop.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 1.28],
              }),
            },
          ],
        }}>
        <GlassIcon name="favorite" size={20} tone={active ? 'onAccent' : 'auto'} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
