import { BRIDGE_VERSION, POS_ORIGIN, type NativeReceipt, type NativeRequest, type NativeResponse } from "../shared/native-protocol";

declare global {
  interface Window {
    HalaraNative?: { version: number };
    ReactNativeWebView?: { postMessage(message: string): void };
  }
}

const pending = new Map<string, { resolve(message: string): void; reject(error: Error): void; timer: number }>();

export function isNativePos(): boolean {
  const nativeMode = window.HalaraNative?.version === BRIDGE_VERSION || new URLSearchParams(location.search).get("halaraApp") === "staff";
  return window.location.origin === POS_ORIGIN && nativeMode
    && typeof window.ReactNativeWebView?.postMessage === "function";
}

window.addEventListener("halara-native-response", (event) => {
  const response: Partial<NativeResponse> = (event as CustomEvent<Partial<NativeResponse>>).detail ?? {};
  if (response.version !== 1 || typeof response.id !== "string" || typeof response.success !== "boolean" || typeof response.message !== "string") return;
  const request = pending.get(response.id);
  if (!request) return;
  window.clearTimeout(request.timer);
  pending.delete(response.id);
  if (response.success) request.resolve(response.message);
  else request.reject(new Error(response.message));
});

function send(request: NativeRequest): Promise<string> {
  if (!isNativePos()) return Promise.reject(new Error("Native printing is unavailable in this browser."));
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(request.id);
      reject(new Error("The printer did not respond. Check its connection before retrying; do not repeat a payment."));
    }, request.action === "print" ? 16 * 60_000 : 90_000);
    pending.set(request.id, { resolve, reject, timer });
    try { window.ReactNativeWebView!.postMessage(JSON.stringify(request)); }
    catch (error) { window.clearTimeout(timer); pending.delete(request.id); reject(error); }
  });
}

export function printNativeReceipt(receipt: NativeReceipt): Promise<string> {
  return send({ version: 1, id: crypto.randomUUID(), action: "print", receipt });
}

export function selectNativePrinter(): Promise<string> {
  return send({ version: 1, id: crypto.randomUUID(), action: "select-printer" });
}
