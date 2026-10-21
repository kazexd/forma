import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
 plugins:[react()],
 server:{proxy:{'/api':{target:'http://127.0.0.1:3001',timeout:240000,proxyTimeout:240000}}},
 test:{include:['src/**/*.test.{ts,tsx}'],environment:'jsdom',setupFiles:['./src/test-setup.ts']}
});

