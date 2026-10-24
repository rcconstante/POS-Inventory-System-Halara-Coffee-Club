import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('app.ts', readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const node = source.statements.find((entry) => ts.isFunctionDeclaration(entry) && entry.name?.text === 'beginPayment');
const code = ts.transpileModule(`let paymentPreparing=false; let paymentSaving=false; ${node.getText(source)}; exports.beginPayment=beginPayment;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function checkout({ method='GCash', image='/gcash-qr.png', load }={}) {
  let dialog; let saves=0; let requests=0;
  const ui={ session:{id:'staff-1',role:'staff'}, selectedPayment:method, cart:[{ productId:'coffee',quantity:1 }], paymentQr:{GCash:null,Maya:null}, paymentQrError:null };
  const api={};
  runInNewContext(code,{ exports:api, ui, api:{paymentQrSettings:async()=>{requests++;return load ? await load() : {GCash:image,Maya:image};}},
    renderStaff:()=>{}, confirmPayment:async()=>{saves++;}, cartTotal:()=>100,
    money:new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}), escapeHtml:String,
    errorMessage:e=>e.message, handleError:e=>{throw e;}, openDialog:options=>{dialog=options;}, closeDialog:()=>{},
  });
  return {api,ui,get dialog(){return dialog;},get saves(){return saves;},get requests(){return requests;}};
}

for(const method of ['GCash','Maya']) test(`${method} shows its QR without creating a sale and requires staff acknowledgement`,async()=>{
  const target=checkout({method}); await target.api.beginPayment();
  assert.equal(target.saves,0); assert.equal(target.dialog.title,`Pay with ${method}`);
  const form=(loaded,checked)=>({querySelector:selector=>selector==='.payment-qr-image'?{complete:loaded,naturalWidth:loaded?600:0}:{checked}});
  await assert.rejects(target.dialog.onSubmit(form(false,true)),/Wait for the QR/);
  await assert.rejects(target.dialog.onSubmit(form(true,false)),/full payment arrived/);
  assert.equal(target.saves,0);
  await target.dialog.onSubmit(form(true,true)); assert.equal(target.saves,1);
});

test('removed QR uses existing digital checkout and cash never loads QR',async()=>{
  for(const method of ['Cash','GCash','Maya']){
    const target=checkout({method,image:null});await target.api.beginPayment();
    assert.equal(target.dialog,undefined);assert.equal(target.saves,1);assert.equal(target.requests,method==='Cash'?0:1);
  }
});

test('settings errors block digital confirmation and allow a deliberate retry',async()=>{
  let fail=true;
  const target=checkout({load:()=>{if(fail) throw Error('Settings unavailable');return {GCash:null,Maya:null};}});
  await assert.rejects(target.api.beginPayment(),/unavailable/);assert.equal(target.saves,0);
  assert.equal(target.ui.paymentQrError,'Settings unavailable');
  fail=false;await target.api.beginPayment();assert.equal(target.saves,1);
});

test('repeated taps while loading QR make one request and no sale',async()=>{
  let finish;
  const target=checkout({load:()=>new Promise(resolve=>{finish=resolve;})});
  const first=target.api.beginPayment();await target.api.beginPayment();assert.equal(target.requests,1);
  finish({GCash:'/gcash-qr.png',Maya:null});await first;assert.equal(target.saves,0);assert.ok(target.dialog);
});

test('a missing Maya QR never falls back to the GCash QR',async()=>{
  const target=checkout({method:'Maya',load:()=>({GCash:'/gcash-qr.png',Maya:null})});
  await target.api.beginPayment();assert.equal(target.dialog,undefined);assert.equal(target.saves,1);
});

test('session expiry during QR loading cannot open a payment confirmation',async()=>{
  let finish;
  const target=checkout({load:()=>new Promise(resolve=>{finish=resolve;})});
  const first=target.api.beginPayment();target.ui.session=null;finish({GCash:'/gcash-qr.png',Maya:null});
  await first;assert.equal(target.dialog,undefined);assert.equal(target.saves,0);
});

test('changed cart cannot be confirmed using an older QR amount',async()=>{
  const target=checkout();await target.api.beginPayment();target.ui.cart[0].quantity=2;
  await assert.rejects(target.dialog.onSubmit({}),/order or session changed/);assert.equal(target.saves,0);
});
