import {describe,it,expect} from 'vitest';
import {checkoutReceipt} from './checkout-receipt.mjs';
const record=()=>({price_id:'price_portrait',price_amount:399,price_currency:'cad',stripe_livemode:true,promotions_enabled:true});
function session({discount=0,tax=0,inclusive=0,status='paid'}={}){const total=399-discount+tax-inclusive;return {status:'complete',payment_status:status,livemode:true,currency:'cad',amount_subtotal:399,amount_total:total,total_details:{amount_discount:discount,amount_tax:tax,amount_shipping:0},discounts:discount?[{promotion_code:'promo_example',coupon:'coupon_example'}]:[],line_items:{has_more:false,data:[{quantity:1,price:{id:'price_portrait',unit_amount:399,currency:'cad',livemode:true},currency:'cad',amount_subtotal:399,amount_discount:discount,amount_tax:tax,amount_total:total}]}};}
describe('authoritative Stripe receipt validation',()=>{
 it.each([0,100,200,399])('verifies the base price and a %i-cent applied discount',discount=>{const receipt=checkoutReceipt(session({discount,status:discount===399?'no_payment_required':'paid'}),record());expect(receipt).toMatchObject({subtotal:399,discount,total:399-discount,currency:'cad'});expect(receipt.discount_refs).toEqual(discount?['coupon:coupon_example','promotion_code:promo_example']:[]);});
 it('supports Stripe-calculated inclusive and exclusive tax without assuming tax exemption',()=>{expect(checkoutReceipt(session({tax:52}),record())).toMatchObject({tax:52,inclusive_tax:0,total:451});expect(checkoutReceipt(session({tax:46,inclusive:46}),record())).toMatchObject({tax:46,inclusive_tax:46,total:399});});
 it.each([
  s=>{s.status='open';},s=>{s.payment_status='unpaid';},s=>{s.amount_subtotal=398;},s=>{s.amount_total=1;},s=>{s.currency='usd';},s=>{s.line_items.data[0].quantity=2;},s=>{s.line_items.data[0].price.id='other_price';},s=>{s.line_items.data[0].price.unit_amount=1;},s=>{s.line_items.data[0].price.livemode=false;},s=>{s.line_items.has_more=true;},s=>{s.line_items.data.push(s.line_items.data[0]);},s=>{delete s.line_items;},s=>{s.total_details.amount_shipping=1;},s=>{s.total_details.amount_discount=-1;},s=>{s.amount_total=NaN;}
 ])('rejects mismatched or incomplete checkout evidence %#',change=>{const s=session();change(s);expect(()=>checkoutReceipt(s,record())).toThrow();});
 it('rejects a positive unpaid total, fake zero-total order, missing discount refs and disabled legacy promotions',()=>{
  expect(()=>checkoutReceipt(session({discount:100,status:'no_payment_required'}),record())).toThrow();
  const fake=session();fake.amount_total=0;fake.line_items.data[0].amount_total=0;expect(()=>checkoutReceipt(fake,record())).toThrow();
  const free=session({discount:399,status:'no_payment_required'});free.discounts=[];expect(()=>checkoutReceipt(free,record())).toThrow();
  expect(()=>checkoutReceipt(session({discount:399,status:'no_payment_required'}),{...record(),promotions_enabled:false})).toThrow();
 });
 it('accepts expanded discount references without depending on current coupon validity',()=>{const s=session({discount:399,status:'no_payment_required'});s.discounts=[{promotion_code:{id:'promo_example',active:false},coupon:{id:'coupon_example',valid:false}}];expect(checkoutReceipt(s,record()).total).toBe(0);});
});
