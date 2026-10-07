import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
export default defineConfig({integrations:[react()],server:{port:4321},vite:{server:{proxy:{'/api':'http://127.0.0.1:8780','/ws':{target:'ws://127.0.0.1:8780',ws:true},'/actions.json':'http://127.0.0.1:8780'}}}});
