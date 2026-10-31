import {commerce} from '../../../../server/commerce.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return commerce.detail(request,(await params).id);}

export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}){return commerce.remove(request,(await params).id);}
