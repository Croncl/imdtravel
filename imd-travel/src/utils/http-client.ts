import { HttpException } from '@nestjs/common';
import axios from 'axios';
import { log } from '../common/log.js';

// Limite padrão por chamada (P1), usado quando a dependência não declara o seu.
// Cada pedido é abortado via AbortController quando o excede: a ligação é
// cancelada, não apenas ignorada.
export const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS ?? 3500);

// validateStatus devolve toda resposta, e o status é verificado abaixo.
const http = axios.create({
  headers: { 'Content-Type': 'application/json' },
  validateStatus: () => true,
});

// Falha técnica de uma dependência (timeout, conexão recusada, 5xx, circuito
// aberto). O controller converte-a em 503.
export class DependencyError extends Error {
  constructor(
    readonly dependency: string,
    readonly reason: 'timeout' | 'circuit-open' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'DependencyError';
  }
}

export interface CallOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  // Timeout desta chamada; por omissão HTTP_TIMEOUT_MS.
  timeoutMs?: number;
  // Instante absoluto (Date.now()) em que acaba o prazo da compra inteira.
  // O timeout efectivo é min(timeoutMs, deadline - agora).
  deadline?: number;
}

export async function call<T>(
  name: string,
  url: string,
  cid: string,
  { method = 'GET', body, timeoutMs = HTTP_TIMEOUT_MS, deadline }: CallOptions = {},
): Promise<T> {
  const start = Date.now();
  const budget = Math.min(timeoutMs, (deadline ?? Infinity) - start);
  if (budget <= 0) {
    throw new DependencyError(name, 'timeout', `${name}: prazo da compra esgotado`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  let res;
  try {
    res = await http.request<T>({
      url,
      method,
      data: body,
      headers: { 'X-Correlation-Id': cid },
      signal: controller.signal,
    });
  } catch (err) {
    const ms = Date.now() - start;
    if (controller.signal.aborted) {
      log(`call.${name}`, cid, ms, { error: 'timeout', budgetMs: budget });
      throw new DependencyError(name, 'timeout', `${name} excedeu ${budget}ms`);
    }
    log(`call.${name}`, cid, ms, { error: (err as Error).message });
    throw new DependencyError(name, 'unavailable', `${name}: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  log(`call.${name}`, cid, Date.now() - start, { status: res.status });

  // 404 (voo/dia inexistente) e 409 (sold-out) são respostas de negócio: repassa ao cliente.
  if (res.status === 404 || res.status === 409) {
    throw new HttpException(res.data as object, res.status);
  }
  if (res.status < 200 || res.status >= 300) {
    throw new DependencyError(name, 'unavailable', `${name} respondeu ${res.status}`);
  }
  return res.data;
}
