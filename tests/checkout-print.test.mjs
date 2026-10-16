import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Execute the actual checkout functions without bootstrapping the DOM or issuing sales.
const source = ts.createSourceFile('app.ts', readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const names = new Set(['getAutoPrint', 'confirmPayment']);
const functions = source.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(functions.length, names.size);
const code = ts.transpileModule(`let paymentSaving = false; const autoPrintStorageKey = 'halara-pos-autoprint';
${functions.map((node) => node.getText(source)).join('\n')}
exports.confirmPayment = confirmPayment; exports.getAutoPrint = getAutoPrint;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function checkout({ autoPrint = null, save, refresh } = {}) {
  const calls = [];
  const sale = { id: 'saved-sale' };
  const ui = { selectedPayment: 'Cash', cart: [{ productId: 'coffee', quantity: 1 }], cashReceived: 200,
    paymentReference: null, completedSale: null, data: { sales: [] }, session: { role: 'staff' } };
  const exports = {};
  runInNewContext(code, {
    exports, ui, crypto: { randomUUID: () => 'stable-reference' },
    window: { localStorage: { getItem: () => autoPrint } },
    currentCashShift: () => ({}), cartTotal: () => 100,
    persistPosState: () => {}, renderStaff: () => {}, toast: (message) => calls.push(message),
    navigateStaff: (screen) => calls.push(screen),
    api: { createSale: async (...args) => { calls.push(['save', ...args]); await save?.(); return { id: sale.id }; } },
    refreshAll: async () => { calls.push('refresh'); await refresh?.(); ui.data.sales = [sale]; },
    printReceipt: () => { assert.equal(ui.completedSale, sale); calls.push('print'); },
  });
  return { api: exports, calls, ui };
}

test('auto-print defaults on and occurs only after sale persistence and refresh', async () => {
  const target = checkout();
  assert.equal(target.api.getAutoPrint(), true);
  await target.api.confirmPayment();
  assert.deepEqual(target.calls.map((call) => Array.isArray(call) ? call[0] : call), ['save', 'refresh', 'success', 'print']);
});

test('explicit auto-print off retains checkout without sending a receipt', async () => {
  const target = checkout({ autoPrint: 'false' });
  await target.api.confirmPayment();
  assert.equal(target.calls.includes('success'), true);
  assert.equal(target.calls.includes('print'), false);
});

test('failed sale never prints and manual retry retains the payment reference', async () => {
  let fail = true;
  const target = checkout({ save: () => { if (fail) throw new Error('Network unavailable'); } });
  await assert.rejects(target.api.confirmPayment(), /Network unavailable/);
  assert.equal(target.calls.includes('print'), false);
  fail = false;
  await target.api.confirmPayment();
  const saves = target.calls.filter(Array.isArray);
  assert.equal(saves.length, 2);
  assert.equal(saves[0][4], 'stable-reference');
  assert.equal(saves[1][4], saves[0][4]);
  assert.equal(target.calls.filter((call) => call === 'print').length, 1);
});

test('repeated checkout taps during persistence create one sale and one print request', async () => {
  let finish;
  const target = checkout({ save: () => new Promise((resolve) => { finish = resolve; }) });
  const first = target.api.confirmPayment();
  await target.api.confirmPayment();
  assert.equal(target.calls.filter(Array.isArray).length, 1);
  assert.equal(target.calls.includes('print'), false);
  finish();
  await first;
  assert.equal(target.calls.filter((call) => call === 'print').length, 1);
});

test('refresh failure does not print an older completed receipt', async () => {
  const target = checkout({ refresh: () => { throw new Error('Refresh failed'); } });
  target.ui.completedSale = { id: 'older-sale' };
  await assert.rejects(target.api.confirmPayment(), /Refresh failed/);
  assert.equal(target.calls.includes('print'), false);
});
