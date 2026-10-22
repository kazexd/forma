import Busboy from 'busboy';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export const MAX_FILE_BYTES=10*1024*1024;
export const MAX_REQUEST_BYTES=51*1024*1024;
export class UploadError extends Error{
 constructor(message,status=400){super(message);this.status=status;}
}
// Bound both individual files and the total stream, including requests without Content-Length.
export async function parseUpload(request){
 const contentType=request.headers.get('content-type')??'';
 if(!contentType.startsWith('multipart/form-data;'))throw new UploadError('Upload photos using multipart/form-data.');
 const contentLength=Number(request.headers.get('content-length'));
 if(contentLength>MAX_REQUEST_BYTES)throw new UploadError('The upload exceeds the 51 MB request limit.',413);
 if(!request.body)throw new UploadError('Please select exactly 5 photos.');
 let parser;
 try{parser=Busboy({headers:{'content-type':contentType},limits:{files:5,fileSize:MAX_FILE_BYTES+1,fields:2,fieldSize:100,parts:8}});}catch{throw new UploadError('The multipart upload could not be read.');}
 const fields={},files=[];
 let problem=null,total=0;
 const reject=(message,status=400)=>{problem??=new UploadError(message,status);};
 parser.on('field',(name,value,info)=>{
  if(!['style','consent'].includes(name)||Object.hasOwn(fields,name)||info.valueTruncated||info.nameTruncated)reject('Upload one style and one consent value.');
  else fields[name]=value;
 });
 parser.on('file',(name,file,info)=>{
  if(name!=='photos'||!['image/jpeg','image/png','image/webp'].includes(info.mimeType))reject('Choose JPEG, PNG or WebP images in the photos field.');
  const chunks=[];let size=0;
  file.on('limit',()=>reject('Each photo must be 10 MB or smaller.',413));
  file.on('data',chunk=>{size+=chunk.length;if(size>MAX_FILE_BYTES)reject('Each photo must be 10 MB or smaller.',413);if(!problem)chunks.push(chunk);});
  file.on('end',()=>{if(!problem)files.push({buffer:Buffer.concat(chunks),mimetype:info.mimeType});});
 });
 for(const event of ['filesLimit','fieldsLimit','partsLimit'])parser.on(event,()=>reject('Upload exactly 5 photos with one style and consent.'));
 const limiter=new Transform({transform(chunk,_encoding,done){total+=chunk.length;if(total>MAX_REQUEST_BYTES)return done(new UploadError('The upload exceeds the 51 MB request limit.',413));done(null,chunk);}});
 try{await pipeline(Readable.fromWeb(request.body),limiter,parser);}catch(error){throw error instanceof UploadError?error:new UploadError('The multipart upload could not be read.');}
 if(problem)throw problem;
 if(files.length!==5)throw new UploadError('Please select exactly 5 photos.');
 return {fields,files};
}
