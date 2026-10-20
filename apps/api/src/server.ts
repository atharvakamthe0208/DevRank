import type { Express } from 'express';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from './app.js';
import { env } from './config/env.js';
import { getSupabaseServiceClient, isSupabaseServiceConfigured } from './config/supabase.js';
import { startScreeningWorker } from './modules/screening/worker.js';

if (isSupabaseServiceConfigured()) {
  startScreeningWorker(getSupabaseServiceClient());
} else {
  console.warn('Resume screening worker is not running because the server-only service credential is not configured.');
}

type ListenerConfiguration = Pick<typeof env, 'API_PORT' | 'API_HOST' | 'NODE_ENV'>;
type ListenerProcess = { reportError: (message: string) => void; exit: (code: number) => void };

const defaultListenerProcess: ListenerProcess = {
  reportError: (message) => console.error(message),
  exit: (code) => process.exit(code),
};

export function startApiServer(
  application: Express = app,
  configuration: ListenerConfiguration = env,
  processControl: ListenerProcess = defaultListenerProcess,
) {
  const server = application.listen(configuration.API_PORT, configuration.API_HOST, () => {
    console.log(`DevRank API listening on ${configuration.API_HOST}:${configuration.API_PORT} (${configuration.NODE_ENV})`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    const message = error.code === 'EADDRINUSE'
      ? `DevRank API could not start: ${configuration.API_HOST}:${configuration.API_PORT} is already in use. Stop the other DevRank process or set API_PORT to a free port.`
      : `DevRank API could not start on ${configuration.API_HOST}:${configuration.API_PORT} (${error.code ?? 'UNKNOWN'}).`;
    processControl.reportError(message);
    processControl.exit(1);
  });

  return server;
}

const invokedScript = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedScript === import.meta.url) startApiServer();
