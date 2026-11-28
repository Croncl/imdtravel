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

export type DependencyErrorReason =
  | 'timeout'
  | 'circuit-open'
  | 'unavailable'
  | 'invalid-response';

// Falha técnica de uma dependência (timeout, conexão recusada, 5xx, circuito
// aberto, resposta inválida). O controller converte-a em 503.
//
// `sent` (P4) diz se o pedido PODE ter chegado à dependência — e portanto se o
// efeito de um POST pode ter acontecido:
//   false → com certeza não chegou (prazo esgotado antes de enviar, conexão
//           recusada, DNS, circuito aberto): nada aconteceu do outro lado.
//   true  → pode ter chegado (timeout depois de enviar, conexão cortada, resposta
//           de erro): o efeito pode ou não ter acontecido.
export class DependencyError extends Error {
  constructor(
    readonly dependency: string,
    readonly reason: DependencyErrorReason,
    message: string,
    readonly sent: boolean = true,
  ) {
    super(message);
    this.name = 'DependencyError';
  }
}

// Erros de rede em que a conexão nem chegou a ser estabelecida.
const NOT_CONNECTED = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH']);

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
    throw new DependencyError(name, 'timeout', `${name}: prazo da compra esgotado`, false);
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
    // Timeout: conservador, o pedido pode ter sido entregue (sent = true).
    if (controller.signal.aborted) {
      log(`call.${name}`, cid, ms, { error: 'timeout', budgetMs: budget });
      throw new DependencyError(name, 'timeout', `${name} excedeu ${budget}ms`);
    }
    const code = (err as { code?: string }).code;
    const sent = !(code && NOT_CONNECTED.has(code));
    log(`call.${name}`, cid, ms, { error: (err as Error).message, code, sent });
    throw new DependencyError(
      name,
      'unavailable',
      `${name}: ${(err as Error).message}`,
      sent,
    );
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
