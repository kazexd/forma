import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import CreditWallet from './CreditWallet';
import * as api from './photos';
afterEach(()=>{vi.restoreAllMocks();window.history.replaceState(null,'','/');});
it('shows accumulated balances and offers a repeatable fixed-price package',async()=>{
 const buy=vi.spyOn(api,'buyCreditPackage').mockResolvedValue(),refresh=vi.fn().mockResolvedValue(undefined);
 render(<CreditWallet remaining={13} unlocks={4} onRefresh={refresh}/>);
 expect(screen.getByText(/13 generation attempts remaining/)).toHaveTextContent('4 original unlock credits');
 const button=screen.getByRole('button',{name:/Buy 5 attempts \+ 2 unlocks — US\$5.49/});
 fireEvent.click(button);await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(1));fireEvent.click(button);await waitFor(()=>expect(buy).toHaveBeenCalledTimes(2));
});
it('blocks duplicate submissions while checkout is pending',async()=>{
 let finish!:()=>void;const buy=vi.spyOn(api,'buyCreditPackage').mockImplementation(()=>new Promise(r=>{finish=r;}));
 render(<CreditWallet remaining={0} unlocks={0} onRefresh={async()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:/Buy 5 attempts/}));expect(screen.getByRole('button',{name:/Opening checkout/})).toBeDisabled();expect(buy).toHaveBeenCalledTimes(1);finish();await waitFor(()=>expect(screen.getByRole('button',{name:/Buy 5 attempts/})).toBeEnabled());
});
it('does not trust a successful checkout redirect without server confirmation',async()=>{
 const id='11111111-1111-4111-8111-111111111111';window.history.replaceState(null,'','/gallery?package='+id+'&package_checkout=success');
 vi.spyOn(api,'getPackageStatus').mockResolvedValue('pending');const refresh=vi.fn().mockResolvedValue(undefined);
 const {unmount}=render(<CreditWallet remaining={0} unlocks={0} onRefresh={refresh}/>);
 await screen.findByText(/Payment is not confirmed yet/);expect(screen.queryByText(/credits have been added/)).not.toBeInTheDocument();unmount();
});
it('reconciles a paid package and refreshes balances',async()=>{
 const id='11111111-1111-4111-8111-111111111111';window.history.replaceState(null,'','/gallery?package='+id);
 vi.spyOn(api,'getPackageStatus').mockResolvedValue('paid');const refresh=vi.fn().mockResolvedValue(undefined);
 render(<CreditWallet remaining={0} unlocks={0} onRefresh={refresh}/>);
 await screen.findByText(/5 generation attempts and 2 unlock credits have been added/);expect(refresh).toHaveBeenCalled();
});
it('keeps balances visible and reports checkout errors',async()=>{
 vi.spyOn(api,'buyCreditPackage').mockRejectedValue(new Error('Checkout unavailable'));
 render(<CreditWallet remaining={0} unlocks={2} onRefresh={async()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:/Buy 5 attempts/}));await screen.findByRole('alert');expect(screen.getByRole('alert')).toHaveTextContent('Checkout unavailable');expect(screen.getByText(/2 original unlock credits/)).toBeInTheDocument();
});
