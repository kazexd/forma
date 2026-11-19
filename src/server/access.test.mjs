import {describe,it,expect} from 'vitest';
import {checkOrigin,applicationOrigin} from './access.mjs';
const origin='https://forma-production.onrender.com';
const env={NODE_ENV:'production',RENDER_EXTERNAL_URL:origin,RENDER_EXTERNAL_HOSTNAME:'forma-production.onrender.com'};
const request=(headers={})=>new Request('http://localhost:10000/api/credit-packages/checkout',{method:'POST',headers});
describe('trusted public origin behind Render proxy',()=>{
 it('accepts the public HTTPS origin when Next sees an internal HTTP URL',()=>{expect(checkOrigin(request({Origin:origin,'sec-fetch-site':'same-origin'}),env)).toBe(origin);});
 it('builds checkout redirects from the canonical origin even without an Origin header',()=>{expect(checkOrigin(request(),env)).toBe(origin);});
 it('supports Render hostname fallback and explicit custom domains',()=>{expect(applicationOrigin({RENDER_EXTERNAL_HOSTNAME:'forma-production.onrender.com'})).toBe(origin);expect(applicationOrigin({...env,APP_ORIGIN:'https://portraits.example.com/'})).toBe('https://portraits.example.com');});
 it.each(['https://evil.example','https://forma-production.onrender.com.evil.example','http://forma-production.onrender.com','null','http://localhost:10000'])('rejects untrusted origin %s',Origin=>{expect(()=>checkOrigin(request({Origin}),env)).toThrow('Cross-site');});
 it('does not trust attacker-controlled Host/forwarded headers',()=>{expect(()=>checkOrigin(request({Origin:'https://evil.example',Host:'evil.example','x-forwarded-host':'evil.example','x-forwarded-proto':'https'}),env)).toThrow('Cross-site');});
 it('still rejects a cross-site fetch even if its Origin is allowed',()=>{expect(()=>checkOrigin(request({Origin:origin,'sec-fetch-site':'cross-site'}),env)).toThrow('Cross-site');});
 it.each(['https://user:password@example.com','https://example.com/path','https://example.com?query=1','https://example.com/#fragment','http://example.com','not-a-url'])('fails closed for invalid operator config %s',APP_ORIGIN=>{expect(()=>checkOrigin(request(),{...env,APP_ORIGIN})).toThrow('configured correctly');});
 it('preserves local loopback browser origins when no platform origin is configured',()=>{expect(checkOrigin(request({Origin:'http://127.0.0.1:5173'}),{})).toBe('http://127.0.0.1:5173');expect(applicationOrigin({NODE_ENV:'development',APP_ORIGIN:'http://localhost:5173'})).toBe('http://localhost:5173');});
});
