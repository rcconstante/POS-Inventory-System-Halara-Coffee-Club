import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as protocol from '../shared/native-protocol.ts';

const receipt = {
  receipt: 'RC-2026-12345678', status: 'Completed', dateTime: 'Oct 16, 2026',
  cashier: 'Staff', payment: 'Cash', totalCentavos: 20000,
  cashReceivedCentavos: 50000, changeCentavos: 30000,
  items: [{ name: 'Bacon & Cheese', quantity: 2, unitPriceCentavos: 10000 }],
};
const code = ts.transpileModule(readFileSync(new URL('../mobile/src/lib/printer.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function service({ os = 'android', version = 36, granted = true, saved = true, send } = {}) {
  const calls = [];
  const printer = { name: 'RP30A-UB', address: '00:11:22:33:44:55' };
  const native = {
    savedPrinter: async () => { calls.push('saved'); return saved ? printer : null; },
    selectPrinter: async () => { calls.push('select'); saved = true; return printer; },
    printReceipt: async (json) => { calls.push(['print', JSON.parse(json)]); await send?.(); },
  };
  const reactNative = {
    Platform: { OS: os, Version: version },
    PermissionsAndroid: {
      PERMISSIONS: { BLUETOOTH_CONNECT: 'connect' }, RESULTS: { GRANTED: 'granted' },
      request: async () => { calls.push('permission'); return granted ? 'granted' : 'denied'; },
    },
  };
  const exports = {};
  runInNewContext(code, { exports, require: (name) => {
    if (name === 'react-native') return reactNative;
    if (name === '../../modules/halara-printer') return { default: native };
    if (name === '../../../shared/native-protocol') return protocol;
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return { api: exports, calls, native };
}

test('saved printer prints directly with the original receipt and no chooser', async () => {
  const target = service();
  assert.match(await target.api.printReceipt(receipt), /Check the paper/);
  assert.deepEqual(target.calls, ['permission', 'saved', ['print', receipt]]);
});

test('first use selects once and subsequent receipts reuse the saved printer', async () => {
  const target = service({ saved: false });
  await target.api.printReceipt(receipt);
  await target.api.printReceipt(receipt);
  assert.equal(target.calls.filter((call) => call === 'select').length, 1);
  assert.equal(target.calls.filter(Array.isArray).length, 2);
});

test('older Android versions print without requesting Android 12 permission', async () => {
  const target = service({ version: 30 });
  await target.api.printReceipt(receipt);
  assert.deepEqual(target.calls, ['saved', ['print', receipt]]);
});

test('permission denial, unsupported platform and invalid receipts cannot send bytes', async () => {
  for (const [options, value, pattern] of [
    [{ granted: false }, receipt, /Nearby devices/],
    [{ os: 'ios' }, receipt, /Android staff app/],
    [{}, { ...receipt, totalCentavos: 1 }, /invalid/],
  ]) {
    const target = service(options);
    await assert.rejects(target.api.printReceipt(value), pattern);
    assert.equal(target.calls.filter(Array.isArray).length, 0);
    assert.equal(target.calls.includes('select'), false);
  }
});

test('repeated taps and setup while printing cannot send a second job', async () => {
  let finish;
  const target = service({ send: () => new Promise((resolve) => { finish = resolve; }) });
  const first = target.api.printReceipt(receipt);
  await assert.rejects(target.api.printReceipt(receipt), /already being sent/);
  await assert.rejects(target.api.choosePrinter(), /current printer request/);
  // Allow permission and saved-printer promises to reach the native boundary.
  for (let count = 0; count < 5; count++) await Promise.resolve();
  assert.equal(target.calls.filter(Array.isArray).length, 1);
  finish();
  await first;
});

test('failed transmission is not retried and releases the lock for a manual retry', async () => {
  let fail = true;
  const target = service({ send: () => { if (fail) throw new Error('Printer disconnected'); } });
  await assert.rejects(target.api.printReceipt(receipt), /disconnected/);
  assert.equal(target.calls.filter(Array.isArray).length, 1);
  fail = false;
  await target.api.printReceipt(receipt);
  assert.equal(target.calls.filter(Array.isArray).length, 2);
});

test('cancelled selection sends nothing and allows subsequent setup', async () => {
  const target = service({ saved: false });
  const select = target.native.selectPrinter;
  target.native.selectPrinter = async () => { throw new Error('Printer selection cancelled'); };
  await assert.rejects(target.api.printReceipt(receipt), /cancelled/);
  assert.equal(target.calls.filter(Array.isArray).length, 0);
  target.native.selectPrinter = select;
  assert.match(await target.api.choosePrinter(), /Printer saved: RP30A-UB/);
  await target.api.printReceipt(receipt);
  assert.equal(target.calls.filter(Array.isArray).length, 1);
});
