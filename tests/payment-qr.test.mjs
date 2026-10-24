import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const exports={};
runInNewContext(ts.transpileModule(readFileSync(new URL('../src/payment-qr.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});

test('QR images cannot introduce external URLs, SVG or oversized payloads',()=>{
  assert.equal(exports.isPaymentQrImage('/gcash-qr.png'),true);
  assert.equal(exports.isPaymentQrImage('data:image/png;base64,iVBORw0KGgo='),true);
  for(const value of ['javascript:alert(1)','https://other.test/a.png','data:image/svg+xml;base64,PHN2Zz4=',null,'data:image/png;base64,'+'A'.repeat(400000)]) assert.equal(exports.isPaymentQrImage(value),false);
});

test('crop adds a four-module white scanning border without clipping near-edge QR',()=>{
  const bounds=exports.qrCropBounds([{x:0,y:0},{x:210,y:0},{x:0,y:210},{x:210,y:210}],1);
  assert.equal(bounds.x,-40);assert.equal(bounds.y,-40);assert.equal(bounds.side,290);
  assert.throws(()=>exports.qrCropBounds([{x:NaN,y:0}],1));
  assert.throws(()=>exports.qrCropBounds(Array(4).fill({x:0,y:0}),1));
});
