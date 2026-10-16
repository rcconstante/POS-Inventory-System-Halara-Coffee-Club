# Halara Staff POS — Android

React Native / Expo SDK 57 staff app. The production staff POS runs in an
origin-restricted WebView so tablet screens, menus, checkout, cash shifts,
inventory, order history, account settings, and Supabase RLS stay shared with the
website. This is a native shell around the existing interface, not a separate
rewrite of every screen. Internet is required for authentication and sales.

The local `halara-printer` Expo module connects directly to a paired Bluetooth
Classic SPP printer. It sends ESC/POS raster commands for both receipt copies,
including Unicode product names, payment method, cashier, tender, and change.
The fixed 576-dot content width targets the RP30A-UB's 80mm hardware. It does not
use Chrome's print dialog, Android's print queue, or RTPrinter System.

Compatibility requires Bluetooth Classic SPP and ESC/POS raster support with
a 576-dot print area. The current formatter targets 80mm printers. A Bluetooth
name alone does not establish compatibility: 58mm, BLE-only, USB and Wi-Fi
printers are not supported by this native transport. Changing printers requires
selecting the new paired device once in Receipt printer setup.

## Install and connect

1. Install the signed preview APK on the tablet. Android 7 or newer is required.
2. Cancel the old stuck Android print jobs and close RTPrinter/other printing
   apps so they release the printer, then pair it in Android Bluetooth settings.
3. Sign in with a Staff account. Admin accounts are rejected by the web API's
   role check; an existing Admin session is signed out in native mode.
4. Open Account → Receipt printer setup, allow Nearby devices when prompted,
   and select the paired receipt printer once.
5. Open a saved order and tap Print receipt. Subsequent jobs reconnect to the
   saved printer automatically. Checkout auto-print uses the same native path.

Printing does not create a sale or retry a payment. Interrupted transmissions
are not automatically retried, because some paper may already have printed.
The app reports bytes sent, not confirmed physical printing. Test the actual
tablet/printer before accepting the printing integration.

## Development and checks

```sh
npm ci
npm run typecheck
npm run lint
npx expo-doctor
npx expo export --platform android
```

From the repository root with Node 24, run `node --test tests/*.test.mjs` for
receipt validation, origin restrictions, bridge responses, timeout checks,
saved-printer reuse, permission failures, cancellation, duplicate-tap protection,
and checkout auto-print ordering. These tests substitute the native transport
boundary; they do not establish physical printer compatibility or paper delivery.

The custom Bluetooth module requires a native build; Expo Go cannot run it.
Use `npm run android` for a local native development build. `npm start` runs
Metro; it does not add the Bluetooth module to Expo Go.
The root web deployment must include `src/native-pos.ts` before installing the
app, or the existing website cannot dispatch to the native printer bridge.
The bridge accepts requests only from the configured HTTPS production origin.
No service-role credentials are bundled, and receipt payloads are validated in
both TypeScript and Kotlin.

## Signed APK build

```sh
npx eas-cli@latest build --platform android --profile preview
```

The preview profile generates an APK for direct installation. Production
generates an Android App Bundle. Preserve the signing credentials managed by
EAS so later APKs can update the same application. Changing Kotlin code requires
a new APK; compatible staff web UI changes deploy with the website.

When EAS build quota is exhausted, a local release can use the same signing key:
download credentials with `npx eas-cli@latest credentials --platform android`,
select `credentials.json` → download, and keep those ignored files private.
With Java 17 and Android SDK 36 installed, run `npx expo prebuild --platform
android --no-install`, then from `android/` run:

```sh
gradlew :app:assembleRelease -I ../scripts/release-signing.gradle
```

The signing init script overrides the generated debug signing configuration
without editing generated native files. Never commit `credentials.json` or the
keystore. A local build avoids EAS build credits.

On Windows, use a short real checkout path, such as `D:\h`. CMake/Ninja can
exceed Windows' filename limit in long paths. Drive aliases made with `subst`
can also produce conflicting dependency roots during React Native autolinking.

## Acceptance on the real tablet

- Confirm login and all staff screens match the web POS at the same tablet size.
- Print a saved cash receipt and a GCash receipt, checking both copies and change.
- Check automatic printing after one saved payment without duplicate sales.
- Reprint an older order while a newer checkout receipt exists.
- Turn the printer off, deny Nearby devices, cancel selection, and restore the
  connection; each failure must show a useful message without retrying payment.
- Check long product names, a long order, cancellation stamps, and paper feed.

An emulator cannot validate Bluetooth RFCOMM delivery to the physical printer.
