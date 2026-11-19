import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import PackagePaymentStatus from './PackagePaymentStatus';
import * as api from './photos';
afterEach(()=>{vi.restoreAllMocks();window.history.replaceState(null,'','/');});
it('does not trust a successful checkout redirect without server confirmation',async()=>{
 const id='11111111-1111-4111-8111-111111111111';window.history.replaceState(null,'','/gallery?package='+id+'&package_checkout=success');
 vi.spyOn(api,'getPackageStatus').mockResolvedValue('pending');const refresh=vi.fn().mockResolvedValue(undefined);
 const {unmount}=render(<PackagePaymentStatus onRefresh={refresh}/>);
 await screen.findByText(/Payment is not confirmed yet/);expect(screen.queryByText(/credits have been added/)).not.toBeInTheDocument();unmount();
});
it('reconciles a paid package and refreshes balances',async()=>{
 const id='11111111-1111-4111-8111-111111111111';window.history.replaceState(null,'','/gallery?package='+id);
 vi.spyOn(api,'getPackageStatus').mockResolvedValue('paid');const refresh=vi.fn().mockResolvedValue(undefined);
 render(<PackagePaymentStatus onRefresh={refresh}/>);
 await screen.findByText(/5 generation attempts and 2 unlock credits have been added/);expect(refresh).toHaveBeenCalled();
});
