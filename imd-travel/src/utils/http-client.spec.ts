import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { call, DependencyError } from './http-client.js';

vi.mock('../common/log.js', () => ({ log: vi.fn() }));

// Servidor local que imita os comportamentos das falhas do /sell.
let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/omissao') return; // aceita e nunca responde
    if (req.url === '/corta') return req.socket.destroy(); // fecha sem resposta
    if (req.url === '/erro') {
      res.writeHead(500).end('{}');
      return;
    }
    res.writeHead(201, { 'Content-Type': 'application/json' }).end('{"ok":true}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

async function erro(url: string, opts = {}) {
  try {
    await call('sell', url, 'cid', { method: 'POST', timeoutMs: 300, ...opts });
  } catch (err) {
    return err as DependencyError;
  }
  throw new Error('deveria ter falhado');
}

describe('call — classificação sent (P4)', () => {
  it('sucesso devolve o corpo', async () => {
    await expect(call('sell', `${base}/ok`, 'cid', { method: 'POST' })).resolves.toEqual({
      ok: true,
    });
  });

  it('omissão (sem resposta até o timeout): sent=true', async () => {
    const e = await erro(`${base}/omissao`);
    expect(e).toBeInstanceOf(DependencyError);
    expect(e).toMatchObject({ reason: 'timeout', sent: true });
  });

  it('conexão cortada (socket hang up): sent=true', async () => {
    const e = await erro(`${base}/corta`);
    expect(e).toMatchObject({ reason: 'unavailable', sent: true });
  });

  it('resposta 5xx: sent=true', async () => {
    const e = await erro(`${base}/erro`);
    expect(e).toMatchObject({ reason: 'unavailable', sent: true });
  });

  it('conexão recusada: sent=false', async () => {
    // Porta 1 em 127.0.0.1: ninguém escutando.
    const e = await erro('http://127.0.0.1:1/sell');
    expect(e).toMatchObject({ reason: 'unavailable', sent: false });
  });

  it('prazo da compra já esgotado: não envia, sent=false', async () => {
    const e = await erro(`${base}/ok`, { deadline: Date.now() - 1 });
    expect(e).toMatchObject({ reason: 'timeout', sent: false });
  });
});
