import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import AccountWelcome from './AccountWelcome';
vi.mock('./auth',()=>({getAccessToken:vi.fn().mockResolvedValue('test-token')}));
afterEach(()=>vi.unstubAllGlobals());
it('welcomes an eligible account and persists acknowledgement before closing',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({welcome:true})).mockResolvedValueOnce(Response.json({acknowledged:true}));vi.stubGlobal('fetch',fetcher);
 render(<AccountWelcome userId="new"/>);
 expect(await screen.findByRole('dialog',{name:'Welcome to Forma.'})).toBeInTheDocument();expect(screen.getByText('3 free generation attempts')).toBeInTheDocument();
 expect(screen.getByText(/Accepted attempts count even if generation fails/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Let’s create your portrait'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 expect(fetcher).toHaveBeenLastCalledWith('/api/account-welcome',expect.objectContaining({method:'POST',headers:{Authorization:'Bearer test-token'}}));
});
it('does not interrupt existing or acknowledged accounts',async()=>{const fetcher=vi.fn().mockResolvedValue(Response.json({welcome:false}));vi.stubGlobal('fetch',fetcher);render(<AccountWelcome userId="existing"/>);await waitFor(()=>expect(fetcher).toHaveBeenCalled());expect(screen.queryByRole('dialog')).not.toBeInTheDocument();});
it('keeps the dialog open and allows retry when acknowledgement fails',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({welcome:true})).mockResolvedValueOnce(new Response(null,{status:503})).mockResolvedValueOnce(Response.json({acknowledged:true}));vi.stubGlobal('fetch',fetcher);render(<AccountWelcome userId="new"/>);
 fireEvent.click(await screen.findByRole('button',{name:'Close welcome'}));await screen.findByRole('alert');expect(screen.getByRole('dialog')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Close welcome'}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
it('ignores a stale eligibility response after switching accounts',async()=>{
 let finish!:(r:Response)=>void;const fetcher=vi.fn().mockImplementationOnce(()=>new Promise(r=>{finish=r;})).mockResolvedValue(Response.json({welcome:false}));vi.stubGlobal('fetch',fetcher);
 const {rerender}=render(<AccountWelcome key="first" userId="first"/>);await waitFor(()=>expect(fetcher).toHaveBeenCalled());rerender(<AccountWelcome key="second" userId="second"/>);finish(Response.json({welcome:true}));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
