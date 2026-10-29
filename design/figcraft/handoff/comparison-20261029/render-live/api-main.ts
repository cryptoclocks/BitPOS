// Starts the real API server (apps/api/src/index.ts exports `server`) on a free local port instead of its hard-coded 3001.
import {server} from '../../../../../apps/api/src/index';
const port=Number(process.env.RENDER_API_PORT||3081);
server.listen(port,'127.0.0.1',()=>console.log('api listening',port));
