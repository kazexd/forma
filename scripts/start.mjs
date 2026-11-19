import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

export function startOptions(env=process.env){
 const port=env.PORT??'5173';
 if(!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535)throw new Error('PORT must be an integer between 1 and 65535.');
 return ['start','--hostname','0.0.0.0','--port',String(Number(port))];
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const next=fileURLToPath(new URL('../node_modules/next/dist/bin/next',import.meta.url));
  const child=spawn(process.execPath,[next,...startOptions()],{stdio:'inherit',env:process.env});
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
  child.on('error',()=>{console.error('Could not start the production server.');process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code??1;});
 }catch(error){console.error(error.message);process.exitCode=1;}
}
