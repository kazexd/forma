import {commerce} from '../src/server/commerce.mjs';
// Resume explicit owner-confirmed deletions only; never delete portraits by age.
try{console.log(await commerce.cleanup());}catch{console.error('Cleanup failed. Check storage and Stripe configuration; no credentials were logged.');process.exitCode=1;}
