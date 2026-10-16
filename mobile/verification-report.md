# Staff app verification — October 14, 2026

The Android app loads the production Halara staff POS in a restricted WebView.
Staff authentication, products, inventory, shifts and orders use the same
Supabase backend as the website. There is no second database or copied catalog.

## Exercised in the running browser

The local production web build was exercised against live staff data, with the
native printer destination substituted by a test receiver. Payment write
requests were intercepted and deliberately failed; no sales or cash movements
were created during this audit.

| Check | Result |
| --- | --- |
| Home, Orders, Products, Cash, Inventory, Account | Passed at 1280×800, 800×1280, 1024×768 and 390×844 |
| Horizontal overflow and selected navigation | Passed all 24 screen/size combinations |
| Lucide SVG rendering and button names | Passed; no unresolved icons or unnamed buttons |
| Empty search, recovery and editing mid-query | Passed |
| Add, increase, decrease and clear cart | Passed |
| Cash/GCash/Maya selection and insufficient-cash validation | Passed |
| Cash change and payment failure recovery | Passed |
| Checkout controls, Back and repeated clicks during a slow save | Passed; one request while saving |
| Payment retries retain the same submission reference | Passed with intercepted writes |
| Saved receipt snapshot and native print dispatch | Passed with a test printer receiver |
| Printer failure feedback | Passed with a test failure response |
| Dialog focus loop, Escape, return focus and browser Back | Passed |
| Missing product images recover to Lucide thumbnails | Passed with forced image failures |
| Browser JavaScript errors | None observed |

Lucide is the existing icon library. The audit preserves the palette, layout,
type styles, navigation and icon family. Improvements add accessible labels,
current-tab semantics, keyboard behavior and image recovery.

## Code and native checks

- Web production build, mobile TypeScript and Expo lint pass.
- Expo doctor passes all 21 checks.
- Twenty protocol, bridge, printer-service and checkout tests pass. The October
  16 printing audit adds saved-printer reuse, first-use selection, Android
  permission handling, selection cancellation, concurrent requests, manual
  recovery after transmission failure, auto-print default/settings, save-before-
  print ordering and preservation of the payment reference on retry. Tests run
  the production TypeScript functions with substituted OS/native/API boundaries;
  they do not communicate with a physical printer or create live sales.
- The custom printer module's native lint report contains zero errors. Four
  optional Android KTX style suggestions remain.
- Android 1.0.1 (version code 2) builds successfully. Its signature matches
  1.0.0, and APK inspection confirms the production site URL, native printer
  bridge, ARM64/ARMv7 libraries and Android 7 minimum.
- The full dependency lint scan crashes in the upstream Worklets Kotlin lint
  analyzer (`Cannot find a KaModule for the VirtualFile`). The custom module
  was checked separately with the two upstream dependency-analysis tasks
  excluded. This is not a clean full-dependency lint result.
  The scoped command is `gradlew :halara-printer:lintRelease -x
  :react-native-worklets:lintAnalyzeRelease -x
  :expo-modules-core:lintAnalyzeRelease`.
- Bluetooth permission declarations now belong to the native module as well
  as the application, and revoked permission produces useful error handling.
  The custom module now treats lint errors as build failures.

## Required real-tablet acceptance

The October 16 code audit found no additional failure in the tested dispatch
path; no printer implementation or APK binary changed in that audit. Version
1.0.1 remains the current APK. Its fixed 576-dot ESC/POS raster output targets
80mm Bluetooth Classic SPP printers, including the intended RP30A-UB. It is not
universal printer support, and compatibility with that physical unit remains
unverified. USB, Wi-Fi, BLE-only and 58mm native printing are not implemented.

The connection and raster approach was checked against Android's
[Bluetooth connection documentation](https://developer.android.com/develop/connectivity/bluetooth/connect-bluetooth-devices)
and Epson's [GS v 0 raster reference](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_lv_0.html).
These document the protocol; they do not certify this third-party printer.

Argent reports no connected Android device or local emulator. Browser checks
and compilation do not prove native rendering or paper delivery. Install the
updated APK, cancel old Android print jobs, close RTPrinter, pair the RP30A-UB,
and select it once through Account → Receipt printer setup.

Verify staff login and navigation, cash and digital receipt copies, auto-print,
an older order reprint, permission denial/recovery, printer-off recovery, and
Android's hardware Back button, rotation and keyboard scrolling. Physical Bluetooth printing and a real payment
write were not exercised in this audit.
