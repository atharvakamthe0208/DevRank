import { once } from 'node:events';
import { createServer, type Server } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startApiServer } from '../src/server.js';

let portOccupier: Server | undefined;

afterEach(async () => {
  if (portOccupier?.listening) {
    await new Promise<void>((resolve, reject) => {
      portOccupier!.close((error) => error ? reject(error) : resolve());
    });
  }
  portOccupier = undefined;
});

describe('API server startup', () => {
  it('reports EADDRINUSE with the configured port and exits without touching the occupying listener', async () => {
    portOccupier = createServer();
    portOccupier.listen(0, '127.0.0.1');
    await once(portOccupier, 'listening');
    const address = portOccupier.address();
    if (!address || typeof address === 'string') throw new Error('Port fixture did not bind to an ephemeral port');

    const reportError = vi.fn();
    const exit = vi.fn();
    const server = startApiServer(express(), {
      API_PORT: address.port,
      API_HOST: '127.0.0.1',
      NODE_ENV: 'test',
    }, { reportError, exit });
    const errorEvent = once(server, 'error');
    const [error] = await errorEvent as [NodeJS.ErrnoException];

    expect(error.code).toBe('EADDRINUSE');
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining(`127.0.0.1:${address.port} is already in use`));
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining('set API_PORT to a free port'));
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(portOccupier.listening).toBe(true);
  });
});
