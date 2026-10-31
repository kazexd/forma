import {commerce} from '../../../../../server/commerce.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return commerce.checkout(request,(await params).id);}
