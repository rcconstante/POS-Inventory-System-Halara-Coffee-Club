import { NativeModule, requireNativeModule } from 'expo';

export interface PairedPrinter { name: string; address: string }

declare class HalaraPrinterModule extends NativeModule {
  selectPrinter(): Promise<PairedPrinter>;
  savedPrinter(): Promise<PairedPrinter | null>;
  printReceipt(receiptJson: string): Promise<void>;
}

export default requireNativeModule<HalaraPrinterModule>('HalaraPrinter');
