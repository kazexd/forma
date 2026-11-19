// Only call this on a session retrieved directly from Stripe with line_items expanded.
const id=value=>typeof value==='string'?value:value?.id;
const integer=value=>Number.isSafeInteger(value)&&value>=0;
export function checkoutReceipt(session,record){
 const lines=session.line_items;
 if(session.status!=='complete'||!['paid','no_payment_required'].includes(session.payment_status))throw new Error('Checkout is not settled');
 if(!lines||lines.has_more!==false||lines.data?.length!==1)throw new Error('Checkout line items mismatch');
 const line=lines.data[0],price=line.price;
 if(line.quantity!==1||!price||price.id!==record.price_id||price.unit_amount!==record.price_amount||price.currency!==record.price_currency||price.livemode!==record.stripe_livemode||line.currency!==record.price_currency||session.currency!==record.price_currency)throw new Error('Checkout price mismatch');
 const subtotal=session.amount_subtotal,discount=session.total_details?.amount_discount,tax=session.total_details?.amount_tax,total=session.amount_total,shipping=session.total_details?.amount_shipping??0;
 if(![subtotal,discount,tax,total,shipping].every(integer)||shipping!==0||subtotal!==record.price_amount||discount>subtotal||line.amount_subtotal!==subtotal||line.amount_discount!==discount||line.amount_tax!==tax||line.amount_total!==total)throw new Error('Checkout totals mismatch');
 // Stripe computes taxes. This accommodates inclusive/exclusive tax without enabling tax collection.
 const inclusiveTax=subtotal-discount+tax-total;
 if(!integer(inclusiveTax)||inclusiveTax>tax)throw new Error('Checkout tax totals mismatch');
 const refs=[];
 if(session.discounts!=null&&!Array.isArray(session.discounts))throw new Error('Invalid checkout discounts');
 for(const applied of session.discounts??[]){
  for(const field of ['coupon','promotion_code']){const value=id(applied?.[field]);if(value!=null){if(typeof value!=='string'||!value||value.length>255)throw new Error('Invalid discount reference');refs.push(field+':'+value);}}
 }
 const discountRefs=[...new Set(refs)].sort();
 if(discountRefs.length>20||(discount>0&&(record.promotions_enabled!==true||!discountRefs.length)))throw new Error('Unverified checkout discount');
 if(total===0){if(discount!==subtotal||tax!==0||!discountRefs.length)throw new Error('Zero-cost checkout requires a verified full discount');}
 else if(session.payment_status!=='paid')throw new Error('Positive checkout total is unpaid');
 return {price_id:price.id,currency:session.currency,subtotal,discount,tax,inclusive_tax:inclusiveTax,total,payment_status:session.payment_status,discount_refs:discountRefs};
}
