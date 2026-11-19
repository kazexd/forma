export function stripeConfiguration(env=process.env){
 const mode=env.STRIPE_MODE??'test';
 const valid=mode==='test'||mode==='live';
 const live=mode==='live';
 const key=env.STRIPE_SECRET_KEY;
 const keyValid=valid&&typeof key==='string'&&(key.startsWith(live?'sk_live_':'sk_test_')||key.startsWith(live?'rk_live_':'rk_test_'));
 return {mode,live,valid,keyValid};
}
