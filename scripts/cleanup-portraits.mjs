import {commerce} from '../src/server/commerce.mjs';
// Schedule this command daily only after testing your private storage and Stripe setup.
try{console.log(await commerce.cleanup());}catch{console.error('Cleanup failed. Check storage and Stripe configuration; no credentials were logged.');process.exitCode=1;}
