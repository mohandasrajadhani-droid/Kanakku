import { PermissionsAndroid, Platform } from 'react-native';
import SmsAndroid from 'react-native-get-sms-android';
import type { RawSms } from './parser';

export async function ensureSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const has = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
  if (has) return true;
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS, {
    title: 'Read bank messages',
    message: 'Kanakku reads your bank and UPI SMS to record payments automatically. Everything stays on this phone.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

export function readInbox(minDate: number): Promise<RawSms[]> {
  return new Promise((resolve, reject) => {
    SmsAndroid.list(
      JSON.stringify({ box: 'inbox', minDate, maxCount: 20000 }),
      (err: string) => reject(new Error(err)),
      (_count: number, list: string) => {
        try { resolve(JSON.parse(list)); } catch (e) { reject(e); }
      },
    );
  });
}
