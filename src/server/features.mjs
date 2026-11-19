// Production starts closed; local development keeps its existing behavior.
export function featureEnabled(name,env=process.env){
 const value=env[name];
 return value===undefined?env.NODE_ENV!=='production':value==='true';
}
