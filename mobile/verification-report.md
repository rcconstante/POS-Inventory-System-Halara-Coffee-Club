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
- Eight protocol/bridge tests pass, including receipt totals, tender/change,
  trusted origins, response matching, errors and timeouts without retries.
- The custom printer module's native lint report contains zero errors. Four
  optional Android KTX style suggestions remain.
- The full dependency lint scan crashes in the upstream Worklets Kotlin lint
  analyzer (`Cannot find a KaModule for the VirtualFile`). The custom module
  was checked separately with the two upstream dependency-analysis tasks
  excluded. This is not a clean full-dependency lint result.
- Bluetooth permission declarations now belong to the native module as well
  as the application, and revoked permission produces useful error handling.
  The custom module now treats lint errors as build failures.

## Required real-tablet acceptance

Argent reports no connected Android device or local emulator. Browser checks
and compilation do not prove native rendering or paper delivery. Install the
updated APK, cancel old Android print jobs, close RTPrinter, pair the RP30A-UB,
and select it once through Account → Receipt printer setup.

Verify staff login and navigation, cash and digital receipt copies, auto-print,
an older order reprint, permission denial/recovery, printer-off recovery, and
Android's hardware Back button. Physical Bluetooth printing and a real payment
write were not exercised in this audit.
