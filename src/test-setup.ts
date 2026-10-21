import '@testing-library/jest-dom/vitest';
import {vi,afterEach} from 'vitest';
import {cleanup} from '@testing-library/react';
afterEach(()=>cleanup());
URL.createObjectURL=vi.fn(()=>`blob:test-${Math.random()}`);
URL.revokeObjectURL=vi.fn();
HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
