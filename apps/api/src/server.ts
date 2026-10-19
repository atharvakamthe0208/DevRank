import { app } from './app.js';
import { env } from './config/env.js';
import { getSupabaseServiceClient, isSupabaseServiceConfigured } from './config/supabase.js';
import { startScreeningWorker } from './modules/screening/worker.js';

if (isSupabaseServiceConfigured()) {
  startScreeningWorker(getSupabaseServiceClient());
} else {
  console.warn('Resume screening worker is not running because the server-only service credential is not configured.');
}

app.listen(env.API_PORT, env.API_HOST, () => {
  console.log(`DevRank API listening on ${env.API_HOST}:${env.API_PORT} (${env.NODE_ENV})`);
});
