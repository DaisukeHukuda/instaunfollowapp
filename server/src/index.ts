import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { app } from './app.js';

// 本番モード（npm start）では web/dist をビルド済み前提で配信する。
// serveStatic の root はプロセスの cwd（server/）からの相対パス。
app.use('/*', serveStatic({ root: '../web/dist' }));
app.get('/', serveStatic({ path: '../web/dist/index.html' }));

serve({ fetch: app.fetch, port: 3900 }, (info) => {
  console.log(`insta-follow-manager: http://localhost:${info.port}`);
});
