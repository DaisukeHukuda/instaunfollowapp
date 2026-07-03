import { serve } from '@hono/node-server';
import { app } from './app.js';

serve({ fetch: app.fetch, port: 3900 }, (info) => {
  console.log(`insta-follow-manager: http://localhost:${info.port}`);
});
