import {render,waitFor,act} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import Turnstile from './Turnstile';
vi.mock('next/script',()=>({default:()=>null}));
afterEach(()=>{delete window.turnstile;});
it('clears expired tokens, resets after an attempt and removes widgets on unmount',async()=>{
 const renderWidget=vi.fn().mockReturnValue('widget'),remove=vi.fn(),onToken=vi.fn();window.turnstile={render:renderWidget,remove};
 const {rerender,unmount}=render(<Turnstile siteKey="public" resetKey={0} onToken={onToken}/>);
 await waitFor(()=>expect(renderWidget).toHaveBeenCalledTimes(1));const options=renderWidget.mock.calls[0][1];expect(options.action).toBe('generate_portrait');expect(options['response-field']).toBe(false);
 act(()=>options.callback('valid'));expect(onToken).toHaveBeenLastCalledWith('valid');act(()=>options['expired-callback']());expect(onToken).toHaveBeenLastCalledWith('');
 rerender(<Turnstile siteKey="public" resetKey={1} onToken={onToken}/>);await waitFor(()=>expect(renderWidget).toHaveBeenCalledTimes(2));expect(remove).toHaveBeenCalledWith('widget');unmount();expect(remove).toHaveBeenCalledTimes(2);
});
