import {render,screen,within} from '@testing-library/react';
import {describe,it,expect} from 'vitest';
import Footer from './Footer';
import PurchasePolicies from './PurchasePolicies';
import Contact from './app/(legal)/contact/page';
import Privacy from './app/(legal)/privacy/page';
import Terms from './app/(legal)/terms/page';

describe('public support and policy content',()=>{
 it('publishes the provided operator and support contact without a login requirement',()=>{
  render(<Contact/>);expect(screen.getByRole('heading',{level:1,name:'Contact Forma'})).toBeInTheDocument();expect(screen.getByText('Zephyr Wong')).toBeInTheDocument();expect(screen.getByText('Ontario, Canada')).toBeInTheDocument();
  expect(screen.getByRole('link',{name:'Email customer support'})).toHaveAttribute('href',expect.stringContaining('mailto:zephyrwong0114@gmail.com'));
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
 });
 it('discloses AI processors, stored results and the manual privacy-request path',()=>{
  render(<Privacy/>);const main=screen.getByRole('main');expect(main).toHaveTextContent('OpenRouter');expect(main).toHaveTextContent('outside Canada');expect(main).toHaveTextContent('not a promise of zero retention');expect(main).toHaveTextContent('handled manually');expect(main).toHaveTextContent('Gallery deletion');expect(main).toHaveTextContent('zephyrwong0114@gmail.com');
 });
 it('states current CAD prices, credit rules and non-waivable consumer protections',()=>{
  render(<Terms/>);const main=screen.getByRole('main');expect(main).toHaveTextContent('CA$3.99 CAD');expect(main).toHaveTextContent('CA$5.49 CAD');expect(main).toHaveTextContent('3 free generation');expect(main).toHaveTextContent('still counts if the AI call fails');expect(main).toHaveTextContent('mandatory protections');expect(main).toHaveTextContent('no physical delivery');
 });
 it('exposes the three public policy routes in the shared footer',()=>{
  render(<Footer/>);const nav=within(screen.getByRole('navigation',{name:'Help and policies'}));
  for(const [name,url] of [['Contact','/contact'],['Privacy Policy','/privacy'],['Terms of Service','/terms']])expect(nav.getByRole('link',{name})).toHaveAttribute('href',url);expect(nav.getAllByRole('link')).toHaveLength(3);
 });
 it('places policy links in purchase disclosures without requiring a sign-in',()=>{
  render(<PurchasePolicies/>);for(const label of ['Terms of Service','Privacy Policy','Contact support']){const link=screen.getByRole('link',{name:label});expect(link).toHaveAttribute('target','_blank');expect(link).toHaveAttribute('rel','noopener noreferrer');}
 });
});
