import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import Header from './Header';
import type {useAuth} from './useAuth';
import * as api from './photos';
const auth={user:{id:'owner',email:'owner@example.com'},loading:false,configured:true,signingIn:false,signOut:vi.fn(),signIn:vi.fn()} as unknown as ReturnType<typeof useAuth>;
afterEach(()=>vi.restoreAllMocks());
it('opens purchase options from the compact balances and closes without checkout',async()=>{
 const buy=vi.spyOn(api,'buyCreditPackage').mockResolvedValue();render(<Header auth={auth} current="create" remaining={11} unlocks={3} paymentMode="test"/>);
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Your credits — view purchase options'}));
 expect(screen.getByRole('dialog',{name:'A little more possibility.'})).toBeInTheDocument();expect(screen.getByText('11 generation attempts')).toBeInTheDocument();expect(screen.getByText('3 original unlocks')).toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Choose in My Gallery'})).toHaveAttribute('href','/gallery');expect(screen.getByText(/Test checkout — no real charges/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Close purchase options'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(buy).not.toHaveBeenCalled();
});
it('prevents duplicate checkout submissions and closing while checkout starts',async()=>{
 let finish!:()=>void;const buy=vi.spyOn(api,'buyCreditPackage').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 render(<Header auth={auth} current="gallery" remaining={1} unlocks={0} paymentMode="live"/>);fireEvent.click(screen.getByRole('button',{name:/view purchase options/}));
 expect(screen.getByText(/Live checkout — real charges/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Buy credit package — CA$5.49 CAD'}));expect(screen.getByRole('button',{name:'Opening checkout…'})).toBeDisabled();expect(screen.getByRole('button',{name:'Close purchase options'})).toBeDisabled();expect(buy).toHaveBeenCalledTimes(1);
 finish();await waitFor(()=>expect(screen.getByRole('button',{name:/Buy credit package/})).toBeEnabled());
});
it('shows checkout errors and allows retry',async()=>{
 const buy=vi.spyOn(api,'buyCreditPackage').mockRejectedValueOnce(new Error('Checkout is unavailable')).mockResolvedValue();render(<Header auth={auth} current="create" paymentMode="test"/>);fireEvent.click(screen.getByRole('button',{name:/view purchase options/}));fireEvent.click(screen.getByRole('button',{name:/Buy credit package/}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Checkout is unavailable');fireEvent.click(screen.getByRole('button',{name:/Buy credit package/}));await waitFor(()=>expect(buy).toHaveBeenCalledTimes(2));
});
it('refreshes balances and prevents purchase with unknown payment mode',async()=>{
 const refresh=vi.fn().mockResolvedValue(undefined);render(<Header auth={auth} current="gallery" onRefreshCredits={refresh}/>);fireEvent.click(screen.getByRole('button',{name:/view purchase options/}));expect(screen.getByRole('button',{name:/Buy credit package/})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Refresh credits'}));await waitFor(()=>expect(refresh).toHaveBeenCalledOnce());
});
it('removes the modal on account switch and hides balances after sign-out',()=>{
 const {rerender}=render(<Header auth={auth} current="create" paymentMode="test"/>);fireEvent.click(screen.getByRole('button',{name:/view purchase options/}));
 rerender(<Header auth={{...auth,user:{...auth.user!,id:'other'}}} current="create"/>);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 rerender(<Header auth={{...auth,user:null}} current="create"/>);expect(screen.queryByRole('button',{name:/view purchase options/})).not.toBeInTheDocument();
});
