import {it,expect,vi} from 'vitest';
import {createPortraitStore} from './portrait-store.mjs';
function fixture(){
 const upload=vi.fn().mockResolvedValue({error:null}),remove=vi.fn().mockResolvedValue({error:null}),rpc=vi.fn().mockResolvedValue({error:null}),maybeSingle=vi.fn().mockResolvedValue({data:null,error:null});
 const chain={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle};
 const store=createPortraitStore({client:{rpc,from:()=>chain,storage:{from:()=>({upload,remove})}}});
 const save=()=>store.save({id:'request',owner_id:'owner',original_path:'original',preview_path:'preview'},Buffer.from('original'),Buffer.from('preview'),'request');
 return{save,rpc,upload,remove,maybeSingle};
}
it('treats an upload failure as confirmed non-delivery',async()=>{const f=fixture();f.upload.mockResolvedValueOnce({error:null}).mockResolvedValueOnce({error:{code:'storage_error'}});await expect(f.save()).rejects.toMatchObject({generationUncertain:false});expect(f.rpc).not.toHaveBeenCalled();expect(f.remove).toHaveBeenCalledWith(['original']);});
it('preserves files after an ambiguous publication response',async()=>{const f=fixture();f.rpc.mockRejectedValue(new Error('connection lost'));await expect(f.save()).rejects.toMatchObject({generationUncertain:true});expect(f.remove).not.toHaveBeenCalled();});
it('recognizes a committed portrait after a lost response',async()=>{const f=fixture();f.rpc.mockRejectedValue(new Error('connection lost'));f.maybeSingle.mockResolvedValue({data:{id:'request'},error:null});await expect(f.save()).resolves.toBeUndefined();expect(f.remove).not.toHaveBeenCalled();});
it('allows restoration after PostgreSQL confirms publication rollback',async()=>{const f=fixture();f.rpc.mockResolvedValue({error:{code:'P0001'}});await expect(f.save()).rejects.toMatchObject({generationUncertain:false});expect(f.remove).toHaveBeenCalledWith(['original','preview']);});
it('keeps an unknown database response uncertain when its verification also fails',async()=>{const f=fixture();f.rpc.mockRejectedValue(new Error('timeout'));f.maybeSingle.mockRejectedValue(new Error('offline'));await expect(f.save()).rejects.toMatchObject({generationUncertain:true});expect(f.remove).not.toHaveBeenCalled();});
