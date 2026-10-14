# Android staff migration

The agreed scope is the existing tablet staff POS, its existing Supabase data,
Halara branding, and direct receipt printing to the RP30A-UB. Administration
remains on the website. No database schema changes are required.

## Screen ownership

| Screen / capability | Implementation |
| --- | --- |
| Staff sign-in | Shared web screen, staff mode enforced |
| Dashboard and notifications | Shared web screens |
| Products, cart, payment, saved receipt | Shared web screens and existing API |
| Orders and receipt reprinting | Shared web screens; native print bridge |
| Cash shifts, movements and closing | Shared web screens and existing API |
| Inventory and account security | Shared web screens and existing API |
| Printer setup and connection | Native Android Bluetooth Classic module |
| Receipt rendering | Native ESC/POS raster, two copies, fixed 80mm printer |

The React Native shell deliberately reuses the existing responsive UI in a
restricted WebView. This preserves exact staff flows instead of maintaining a
second checkout implementation. It is not an offline POS or a rewrite into
native controls. Internet remains required for authentication and transactions.

## Verification

Status recorded October 14, 2026.

- Web production build and mobile TypeScript/lint checks pass.
- Expo doctor passes all 21 checks; Android JavaScript export passes.
- Eight protocol/bridge tests cover origin isolation, totals, tender/change,
  response matching, native errors, and timeouts without automatic retries.
- Signed Android release build succeeds, including native Kotlin compilation
  and release checks. APK inspection confirms the custom printer module,
  Hermes bundle, ARM64/ARMv7 libraries, Android 7 minimum, and EAS signing key.
- The web bridge is deployed on the production Halara site.
- The deployed staff website has been opened and signed into with the existing
  thesis demo account using agent-browser; tablet baselines are in `.test/`.
- The local web build passes a browser check using live staff data: all six staff
  views render at tablet size, saved-order printing and printer setup dispatch
  through the bridge, and native mode hides the role chooser and PWA install.
  The bridge destination is substituted in this test; it does not exercise a
  physical Bluetooth connection or establish native runtime parity.
- Native runtime parity and physical printing are pending a connected tablet.
  Argent reports no connected devices or local AVDs, and EAS Simulator is not
  available for this account. Export/compilation does not prove runtime parity.
- Acceptance steps for real hardware are in README.md. No test payment is
  created during browser verification.

EAS preview build credits are exhausted until November 1. The local Android
release uses the same EAS-managed signing key; private credentials stay ignored.
