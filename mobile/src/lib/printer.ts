import { PermissionsAndroid, Platform } from 'react-native';
import HalaraPrinter from '../../modules/halara-printer';
import { isNativeReceipt, type NativeReceipt } from '../../../shared/native-protocol';

let busy = false;

async function permission(): Promise<void> {
  if (Platform.OS !== 'android') throw new Error('Bluetooth printing requires the Android staff app.');
  if (Number(Platform.Version) >= 31) {
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new Error('Allow Nearby devices in Android Settings → Apps → Halara Staff POS → Permissions, then retry.');
    }
  }
}

export async function choosePrinter(): Promise<string> {
  if (busy) throw new Error('Wait for the current printer request to finish.');
  busy = true;
  try {
    await permission();
    const printer = await HalaraPrinter.selectPrinter();
    return `Printer saved: ${printer.name}. You can now print receipts directly.`;
  } finally { busy = false; }
}

export async function printReceipt(receipt: NativeReceipt): Promise<string> {
  if (!isNativeReceipt(receipt)) throw new Error('The saved receipt is invalid. Reopen it from Orders.');
  if (busy) throw new Error('A receipt is already being sent. Wait before reprinting.');
  busy = true;
  try {
    await permission();
    if (!await HalaraPrinter.savedPrinter()) await HalaraPrinter.selectPrinter();
    await HalaraPrinter.printReceipt(JSON.stringify(receipt));
    return 'Receipt sent to the printer. Check the paper before reprinting.';
  } finally { busy = false; }
}
