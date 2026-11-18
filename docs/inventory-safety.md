# Inventory accuracy checks — November 18, 2026

The reported shortage is not conclusively attributed to a stock-addition bug.
Recorded espresso usage matched completed sales, including large Add Espresso
orders. The 50 g recipe and historical transactions were not changed by this fix.

A separate unit-integrity defect was reproduced: changing an existing material
from g to kg relabelled its stock and recipes without converting their numbers.
Migration 012 now rejects unit changes once stock, recipes or history exist.
Unused materials can still choose their initial unit. No historical quantities
are rewritten. The live guard was verified using an invalid recipe as a rollback
sentinel; the product and recipe were identical after the rejected edits.

Stock entry now explicitly selects a delivery unit, converts compatible g/kg and
mL/L quantities into the stored inventory unit, and previews the expected balance.
For example, 5 kg is submitted as 5,000 g for a gram-based ingredient. Cost is
independent of quantity. Invalid or sub-precision quantities are rejected.

Editing a delivery corrects its original total; only the difference affects
stock. Completed sales remain deducted. The history table labels the live
balance “On hand now” to distinguish it from the saved delivery quantity.

QA includes 36 automated tests, including isolated PostgreSQL execution of the
actual stock, sale and refund functions. SQL checks cover additions, corrections,
decimals, rejection, cancellation, payment retries and restored-order snapshots.
They use local auth fixtures and do not establish production concurrency behavior.
Browser QA intercepts stock writes and verifies conversion, payloads, edit flows,
unit locking and three screen sizes without changing live balances.

The same UI is served to the staff Android WebView. No native printer code or
APK rebuild is needed for this web change. Admin inventory editing remains in
the web dashboard.
