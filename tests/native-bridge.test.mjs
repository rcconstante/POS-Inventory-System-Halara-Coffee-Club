import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as protocol from '../shared/native-protocol.ts';

function bridge({ native = true, origin = protocol.POS_ORIGIN } = {}) {
  const listeners = new Map();
  const timers = new Map();
  const messages = [];
  let timerId = 0;
  const window = {
    location: { origin },
    HalaraNative: { version: 1 },
    ...(native ? { ReactNativeWebView: { postMessage: (value) => messages.push(JSON.parse(value)) } } : {}),
    addEventListener: (name, listener) => listeners.set(name, listener),
    setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id) => timers.delete(id),
  };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../src/native-pos.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, {
    exports, window, location: { search: '?halaraApp=staff' }, URLSearchParams,
    crypto: { randomUUID: () => 'test-request' }, require: () => protocol,
  });
  return { api: exports, messages, timers, reply: (detail) => listeners.get('halara-native-response')({ detail }) };
}

test('ordinary browsers and other origins cannot invoke the native printer', async () => {
  for (const options of [{ native: false }, { origin: 'https://untrusted.test' }]) {
    const target = bridge(options);
    assert.equal(target.api.isNativePos(), false);
    await assert.rejects(target.api.selectNativePrinter(), /unavailable/);
    assert.equal(target.messages.length, 0);
  }
});

test('a printer response resolves only its matching request and clears the timeout', async () => {
  const target = bridge();
  const request = target.api.selectNativePrinter();
  assert.equal(target.messages[0].action, 'select-printer');
  target.reply({ version: 1, id: 'wrong-request', success: true, message: 'Wrong response' });
  assert.equal(target.timers.size, 1);
  target.reply({ version: 1, id: 'test-request', success: true, message: 'Printer saved' });
  assert.equal(await request, 'Printer saved');
  assert.equal(target.timers.size, 0);
});

test('native connection errors reach the web interface without a retry', async () => {
  const target = bridge();
  const request = target.api.selectNativePrinter();
  target.reply({ version: 1, id: 'test-request', success: false, message: 'Printer is off' });
  await assert.rejects(request, /Printer is off/);
  assert.equal(target.messages.length, 1);
  assert.equal(target.timers.size, 0);
});

test('a missing response times out with payment-safe guidance and no duplicate request', async () => {
  const target = bridge();
  const request = target.api.selectNativePrinter();
  const rejection = assert.rejects(request, /do not repeat a payment/);
  [...target.timers.values()][0]();
  await rejection;
  assert.equal(target.messages.length, 1);
});
