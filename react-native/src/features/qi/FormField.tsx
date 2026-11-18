import React from 'react';
import {KeyboardTypeOptions, StyleSheet, Text, TextInput, View} from 'react-native';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {type} from '../../theme/typography';

export function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  autoCapitalize = 'none',
  hint,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  hint?: string;
  maxLength?: number;
}) {
  const {colors} = useAppTheme();
  return (
    <View style={styles.wrap}>
      <Text style={[type.label, {color: colors.onSurfaceVariant}]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.onSurfaceVariant}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        maxLength={maxLength}
        accessibilityLabel={label}
        style={[
          styles.input,
          {
            color: colors.onSurface,
            backgroundColor: colors.surfaceVariant,
            borderColor: colors.outline,
          },
        ]}
      />
      {hint ? (
        <Text style={[type.caption, styles.hint, {color: colors.onSurfaceVariant}]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {marginTop: 14},
  input: {
    marginTop: 6,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  hint: {marginTop: 6},
});
