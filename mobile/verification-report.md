# Staff app verification — October 24, 2026

## Version 1.0.3 — shared GCash and Maya QR

- 31 JavaScript tests pass, including method-specific QR selection, manual
  acknowledgement, image loading failure, no-QR fallback, session expiry,
  changed-cart rejection and the existing receipt/auto-print checks.
- Web production build and mobile typecheck/lint pass. The QR decoder is lazy
  loaded. Compatible dependency patches also clear the four npm audit findings;
  the web dependency audit now reports zero vulnerabilities.
- The supplied image is cropped and decoded before/after processing with an
  identical payload. It seeds GCash only. Maya is empty until an admin uploads
  its own image. Each method has independent admin settings and removal.
- Browser checks cover desktop, portrait tablet and narrow-screen QR dialogs,
  admin photo upload/removal, shared settings after reload, failure recovery,
  cancellation and existing browser/native receipt dispatch. Settings and sale
  writes are intercepted; no real sale or wallet-routing change is made by QA.
  Simulated successful GCash and Maya sales also reach the receipt and native
  auto-print bridge with matching payment methods and totals. QR confirmation
  controls remain visible at 1280×800, 800×1280 and 390×844.
- Live migration 010 permissions were checked: staff read succeeds, staff RPC
  changes and direct updates are denied, anonymous reads are denied, and server
  PNG validation accepts the crop and rejects external URLs/SVG/truncated PNG.
  Migration 011 adds Maya; verify it is applied before publishing the UI.
- Signed APK 1.0.3 (version code 4) builds successfully. Its certificate matches
  prior releases, supports ARM64/ARMv7 and Android 7+, and the four native raster
  encoder tests pass. APK SHA-256:
  `e64a33fb8ee187932afd335a673a097976bc0bdce62d82a7405ff9b6a245a00c`.
- Printer transport, pacing and tear feed are unchanged from 1.0.2. Actual
  tablet file picking and clean physical printing still require hardware QA.

## Earlier printing and shared-screen verification

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
- Twenty-one protocol, bridge, printer-service and checkout tests pass. The October
  16 printing audit adds saved-printer reuse, first-use selection, Android
  permission handling, selection cancellation, concurrent requests, manual
  recovery after transmission failure, auto-print default/settings, save-before-
  print ordering and preservation of the payment reference on retry. Tests run
  the production TypeScript functions with substituted OS/native/API boundaries;
  they do not communicate with a physical printer or create live sales.
- Four native JVM encoder tests pass: complete raster byte preservation and
  correct band lengths/pacing, exact feed commands without cutting, malformed
  image rejection, and write failure without retries.
- The custom printer module's native lint report contains zero errors. Four
  optional Android KTX style suggestions remain.
- Android 1.0.2 (version code 3) builds successfully, including the final
  timeout scheduling adjustment. Its signing certificate matches 1.0.1 and
  1.0.0, so it can update the installed app. APK metadata confirms ARM64/ARMv7
  libraries and Android 7 minimum. SHA-256:
  `fe2523d366295cff7422125e054624f8bc673d32de0443c088be509cbcb7d3c2`.
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

The user subsequently supplied a photo of paper output with readable receipt
sections mixed with garbled binary-looking text. This demonstrates some physical
output, but not successful printing of complete, clean receipts. Buffer overrun
or raster-command desynchronization is an inference from that pattern, not a
confirmed hardware diagnosis.

Version 1.0.2 addresses the unpaced raster stream: each command contains at most
eight rows/584 bytes, with a flush and 60ms pacing delay. Encoder tests verify
the declared payload sizes and preservation of every pixel byte across bands,
including a final partial band. Initialization and feed commands use the same
paced writer. Customer and store copies remain automatic, with a TEAR HERE
marker and about 20mm blank feed on each side. The final copy gets about 40mm
feed (assuming 203dpi). No cutter command is sent.

The former fixed 45-second job timer could interrupt long paced receipts. It now
checks for 45 seconds without write progress, with a 15-minute maximum job
duration. The bridge waits 16 minutes for printing and retains the shorter
90-second setup timeout. No interrupted job is automatically retried.

The fixed 576-dot ESC/POS raster output targets 80mm Bluetooth Classic SPP
printers, including the intended RP30A-UB. It is not universal printer support.
Clean paper output with version 1.0.2 remains unverified. USB, Wi-Fi, BLE-only
and 58mm native printing are not implemented.

The connection and raster approach was checked against Android's
[Bluetooth connection documentation](https://developer.android.com/develop/connectivity/bluetooth/connect-bluetooth-devices)
and Epson's [GS v 0 raster reference](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_lv_0.html).
These document the protocol; they do not certify this third-party printer.

Argent reports no connected Android device or local emulator. Browser checks
and compilation do not prove native rendering or paper delivery. Install the
updated APK, cancel old Android print jobs, close RTPrinter, power-cycle the
printer to clear residual data, and select the paired RP30A-UB once through
Account → Receipt printer setup if it was not already saved.

Verify staff login and navigation, cash and digital receipt copies, auto-print,
an older order reprint, permission denial/recovery, printer-off recovery, and
Android's hardware Back button, rotation and keyboard scrolling. Physical Bluetooth printing and a real payment
write were not exercised in this audit.
