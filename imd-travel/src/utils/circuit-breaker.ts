import { HttpException } from '@nestjs/common';
import CircuitBreaker from 'opossum';
import { log } from '../common/log.js';
import { DependencyError } from './http-client.js';

// Parâmetros do Circuit Breaker (P7), configuráveis por env.
// Mínimo de chamadas na janela antes de o breaker poder abrir.
const CB_VOLUME_THRESHOLD = Number(process.env.CB_VOLUME_THRESHOLD ?? 5);
// Janela móvel de amostras. Tem de ser maior que o tempo de juntar
// CB_VOLUME_THRESHOLD falhas com timeout (5 × 1s), senão o breaker nunca abre.
const CB_ROLLING_WINDOW_MS = Number(process.env.CB_ROLLING_WINDOW_MS ?? 20000);
const CB_ERROR_THRESHOLD_PCT = Number(process.env.CB_ERROR_THRESHOLD_PCT ?? 50);
const CB_RESET_TIMEOUT_MS = Number(process.env.CB_RESET_TIMEOUT_MS ?? 10000);

// Registo de todos os breakers, por nome (usado pelo futuro GET /status).
export const breakers = new Map<string, CircuitBreaker>();

type AsyncFn<A extends unknown[], R> = (...args: A) => Promise<R>;

// Envolve uma chamada a uma dependência num Circuit Breaker.
// - O timeout é feito em http-client (AbortController), que cancela o pedido de
//   verdade. O timeout do opossum fica desligado: ele só deixaria de esperar,
//   com a ligação ainda aberta na dependência. Um timeout conta como falha.
// - 404/409 (HttpException) são respostas de negócio: não contam como falha.
// - Com o circuito aberto, a chamada falha de imediato com DependencyError.
// - Depois de CB_RESET_TIMEOUT_MS, deixa passar uma chamada de teste (half-open):
//   se der certo, fecha; se falhar, volta a abrir.
export function withBreaker<A extends unknown[], R>(
  name: string,
  fn: AsyncFn<A, R>,
): AsyncFn<A, R> {
  const cb = new CircuitBreaker<A, R>(fn, {
    name,
    timeout: false,
    volumeThreshold: CB_VOLUME_THRESHOLD,
    rollingCountTimeout: CB_ROLLING_WINDOW_MS,
    errorThresholdPercentage: CB_ERROR_THRESHOLD_PCT,
    resetTimeout: CB_RESET_TIMEOUT_MS,
    errorFilter: (err) => err instanceof HttpException,
  });

  cb.on('open', () => log('cb.open', '-', 0, { dependency: name }));
  cb.on('halfOpen', () => log('cb.halfOpen', '-', 0, { dependency: name }));
  cb.on('close', () => log('cb.close', '-', 0, { dependency: name }));
  breakers.set(name, cb);

  return async (...args: A) => {
    try {
      return await cb.fire(...args);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'EOPENBREAKER') {
        // Circuito aberto: a chamada nem foi feita (sent = false).
        throw new DependencyError(name, 'circuit-open', `${name}: circuito aberto`, false);
      }
      throw err;
    }
  };
}
