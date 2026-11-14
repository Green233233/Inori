import {Alert, Platform, ToastAndroid} from 'react-native';

/** Android Toasts, mirroring the Compose app's feedback style. */
export function showToast(message: string, long = false): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(
      message,
      long ? ToastAndroid.LONG : ToastAndroid.SHORT,
    );
  } else {
    Alert.alert('', message);
  }
}
