# GCash and Maya payment QR

Apply migrations `010_gcash_payment_qr.sql` and `011_maya_payment_qr.sql` in that
order before deploying this UI. Existing installations that already applied
010 only need 011. Neither script changes orders, stock or cash balances.

An admin manages each method separately in **Settings → GCash payment QR** and
**Settings → Maya payment QR**. Choose a JPG, PNG or WebP photo (up to 5 MB),
review the automatically cropped preview, then save. Remove QR and save to
restore that method's existing confirmation flow. Saving one method preserves
an unsaved draft in the other form. Settings are stored in Supabase and shared
by the web POS and staff Android app; they are not device-local preferences.

The supplied image is the initial GCash QR. Maya starts without a QR and never
uses the GCash image as a fallback. Test the recipient in the respective payment
app before accepting customer payments. This is manual payment collection,
not a GCash/Maya gateway or an automatic payment verification integration.

With a QR configured, checkout is **payment method → Show QR → staff checks
the receiving account → acknowledge full payment → Confirm payment → receipt**.
Showing or closing the QR does not create a sale. Failed QR loading blocks
confirmation, while payment failure retains the existing reference for a safe
retry. A changed cart or expired staff session invalidates the QR confirmation.
After a successful sale, the existing receipt and auto-print flow runs.

`jsQR` loads only when processing an uploaded photo. Cropping retains a four-
module white scanning border and verifies that the cropped image decodes to
the original payload. No payment links or account details are reconstructed.
Unclear images fail with a retry message. Uploaded output is a bounded PNG;
database validation checks its signature, dimensions and size. Settings updates
are admin-only RPCs; RLS permits workspace reads, with no anonymous reads or
direct authenticated updates.

The staff APK remains staff-only. Upload and management belong to the admin's
web Settings; staff use the shared QR at checkout. Android file picking and
physical printing should still be checked on the actual tablet. No printer
transport or receipt formatter code changed in this release.

## Verification

Run `node --test tests/*.test.mjs`, `npm run build`, mobile typecheck and lint,
and `gradlew :halara-printer:testReleaseUnitTest :app:assembleRelease` for the
native release. Browser QA uses live read-only catalog/account data and
intercepted payment/settings writes, testing both QR methods, upload/removal,
manual acknowledgement, loading errors, no-QR fallback and existing web/native
receipt dispatch. It does not create production sales or change wallet routing.
