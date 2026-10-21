import {createApp} from './app.mjs';
const server=createApp().listen(3001,'127.0.0.1',()=>console.log('Forma API: http://127.0.0.1:3001'));
server.requestTimeout=240_000;
