/**
 * 角色头像：主人 / 小狗的剪影、名字首字，或用户自选的照片。
 *
 * 剪影用纯 View 绘制（无新增依赖、无 SVG）：一个圆头 + 肩线，小狗再加两只耳朵
 * 与鼻口，主人加一枚小小的领结，避免两端看起来一样。
 */
import React from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';

export type AvatarStyle = 'role' | 'initial' | 'photo';

export function RoleAvatar({
  role,
  name,
  size = 76,
  avatarStyle = 'role',
  imageUri,
  ringColor,
  onColor = '#FFFFFF',
}: {
  role: 'MASTER' | 'PUPPY' | null;
  name?: string;
  size?: number;
  avatarStyle?: AvatarStyle;
  imageUri?: string | null;
  ringColor?: string;
  onColor?: string;
}) {
  const radius = size / 2;
  const inner = size - 8;

  if (avatarStyle === 'photo' && imageUri) {
    return (
      <View
        style={[
          styles.shell,
          {
            width: size,
            height: size,
            borderRadius: radius,
            borderColor: ringColor ?? 'rgba(255,255,255,0.5)',
          },
        ]}>
        <Image
          source={{uri: imageUri}}
          style={{width: inner, height: inner, borderRadius: inner / 2}}
          resizeMode="cover"
        />
      </View>
    );
  }

  if (avatarStyle === 'initial') {
    const letter = (name ?? '').trim().charAt(0) || (role === 'PUPPY' ? '狗' : '主');
    return (
      <View
        style={[
          styles.shell,
          {
            width: size,
            height: size,
            borderRadius: radius,
            borderColor: ringColor ?? 'rgba(255,255,255,0.5)',
            backgroundColor: 'rgba(255,255,255,0.16)',
          },
        ]}>
        <Text
          style={{
            color: onColor,
            fontSize: size * 0.42,
            fontWeight: '700',
          }}>
          {letter}
        </Text>
      </View>
    );
  }

  const head = inner * 0.34;
  const shoulderWidth = inner * 0.66;
  const shoulderHeight = inner * 0.34;
  const isPuppy = role === 'PUPPY';

  return (
    <View
      style={[
        styles.shell,
        {
          width: size,
          height: size,
          borderRadius: radius,
          borderColor: ringColor ?? 'rgba(255,255,255,0.5)',
          backgroundColor: 'rgba(255,255,255,0.14)',
        },
      ]}>
      <View
        style={{
          width: head,
          height: head,
          borderRadius: head / 2,
          backgroundColor: onColor,
          marginTop: inner * 0.2,
        }}
      />
      {isPuppy ? (
        <>
          <View
            style={[
              styles.ear,
              {
                width: head * 0.5,
                height: head * 0.86,
                borderRadius: head * 0.28,
                left: inner * 0.5 - head * 0.72,
                top: inner * 0.17,
                transform: [{rotate: '-24deg'}],
                backgroundColor: onColor,
              },
            ]}
          />
          <View
            style={[
              styles.ear,
              {
                width: head * 0.5,
                height: head * 0.86,
                borderRadius: head * 0.28,
                right: inner * 0.5 - head * 0.72,
                top: inner * 0.17,
                transform: [{rotate: '24deg'}],
                backgroundColor: onColor,
              },
            ]}
          />
          <View
            style={{
              width: head * 0.34,
              height: head * 0.26,
              borderRadius: head * 0.18,
              backgroundColor: 'rgba(0,0,0,0.28)',
              marginTop: -head * 0.26,
            }}
          />
        </>
      ) : null}
      <View
        style={{
          position: 'absolute',
          bottom: inner * 0.1,
          width: shoulderWidth,
          height: shoulderHeight,
          borderTopLeftRadius: shoulderWidth / 2,
          borderTopRightRadius: shoulderWidth / 2,
          backgroundColor: onColor,
        }}
      />
      {!isPuppy ? (
        <View
          style={{
            position: 'absolute',
            bottom: inner * 0.1 + shoulderHeight * 0.34,
            width: inner * 0.2,
            height: inner * 0.1,
            borderRadius: inner * 0.03,
            backgroundColor: 'rgba(0,0,0,0.32)',
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  ear: {position: 'absolute'},
});
