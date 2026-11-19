import {GET as status} from '../../../../server/generation-status.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return status(request,(await params).id);}
