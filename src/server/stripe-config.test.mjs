import {it,expect} from 'vitest';
import {stripeConfiguration} from './stripe-config.mjs';
it('defaults to test and requires an explicit exact live mode plus matching secret prefix',()=>{
 expect(stripeConfiguration({STRIPE_SECRET_KEY:'sk_test_example'})).toMatchObject({mode:'test',live:false,keyValid:true});
 expect(stripeConfiguration({STRIPE_SECRET_KEY:'sk_live_example'}).keyValid).toBe(false);
 expect(stripeConfiguration({STRIPE_MODE:'live',STRIPE_SECRET_KEY:'sk_live_example'})).toMatchObject({mode:'live',live:true,keyValid:true});
 expect(stripeConfiguration({STRIPE_MODE:'live',STRIPE_SECRET_KEY:'sk_test_example'}).keyValid).toBe(false);
 for(const STRIPE_MODE of ['LIVE','', 'typo'])expect(stripeConfiguration({STRIPE_MODE,STRIPE_SECRET_KEY:'sk_live_example'}).valid).toBe(false);
 for(const mode of ['test','live']){expect(stripeConfiguration({STRIPE_MODE:mode,STRIPE_SECRET_KEY:'rk_'+mode+'_example'}).keyValid).toBe(true);expect(stripeConfiguration({STRIPE_MODE:mode,STRIPE_SECRET_KEY:'pk_'+mode+'_example'}).keyValid).toBe(false);}
});
