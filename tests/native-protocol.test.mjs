import assert from 'node:assert/strict';
import test from 'node:test';
import { isNativeReceipt, isTrustedPosUrl, parseNativeRequest } from '../shared/native-protocol.ts';

const receipt = {
  receipt: 'RC-2026-12345678', status: 'Completed', dateTime: 'Oct 14, 2026, 1:12 PM',
  cashier: 'Staff', payment: 'Cash', totalCentavos: 20000, cashReceivedCentavos: 50000, changeCentavos: 30000,
  items: [{ name: 'Bacon & Cheese', quantity: 2, unitPriceCentavos: 10000 }],
};

test('receipt bridge validates integer money and snapshot totals', () => {
  assert.equal(isNativeReceipt(receipt), true);
  for (const invalid of [
    { ...receipt, totalCentavos: 1 },
    { ...receipt, changeCentavos: 0 },
    { ...receipt, cashReceivedCentavos: -1 },
    { ...receipt, items: [{ ...receipt.items[0], quantity: 1.5 }] },
    { ...receipt, items: [] },
    { ...receipt, items: [{ ...receipt.items[0], unitPriceCentavos: Number.MAX_SAFE_INTEGER }] },
  ]) assert.equal(isNativeReceipt(invalid), false);
});

test('digital and cancelled receipts preserve the original totals', () => {
  assert.equal(isNativeReceipt({ ...receipt, status: 'Cancelled' }), true);
  assert.equal(isNativeReceipt({ ...receipt, payment: 'GCash', cashReceivedCentavos: null, changeCentavos: null }), true);
  assert.equal(isNativeReceipt({ ...receipt, payment: 'GCash' }), false);
});

test('only declared bridge actions can reach native printing', () => {
  const request = { version: 1, id: 'request-1', action: 'print', receipt };
  assert.deepEqual(parseNativeRequest(JSON.stringify(request)), request);
  for (const invalid of [
    { ...request, version: 2 }, { ...request, id: '<script>' }, { ...request, action: 'open-url' },
    { ...request, receipt: { ...receipt, totalCentavos: 1 } },
  ]) assert.throws(() => parseNativeRequest(JSON.stringify(invalid)));
  assert.throws(() => parseNativeRequest('x'.repeat(100001)));
});

test('untrusted navigation cannot access the Bluetooth bridge', () => {
  assert.equal(isTrustedPosUrl('https://halara-coffee-club.netlify.app/?halaraApp=staff#/staff/orders'), true);
  for (const url of [
    'http://halara-coffee-club.netlify.app/', 'https://halara-coffee-club.netlify.app.evil.test/',
    'https://halara-coffee-club.netlify.app@evil.test/', 'javascript:alert(1)', 'file:///etc/passwd',
  ]) assert.equal(isTrustedPosUrl(url), false);
});
