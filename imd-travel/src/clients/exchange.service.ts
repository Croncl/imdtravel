import { Injectable } from '@nestjs/common';
import { call, DependencyError } from '../utils/http-client.js';
import { withBreaker } from '../utils/circuit-breaker.js';
import { isValidRate } from '../utils/validate.js';
import { log } from '../common/log.js';

const URL = process.env.EXCHANGE_URL ?? 'http://localhost:8082';
const CONVERT_TIMEOUT_MS = Number(process.env.CONVERT_TIMEOUT_MS ?? 1000);

export interface Rate {
  rate: number;
  asOf: string;
}

// A validação fica DENTRO do breaker (P2 + P7): uma taxa inválida conta como
// erro, e uma corrupção persistente abre o circuito como um timeout abriria.
const convertCall = withBreaker('convert', async (cid: string, deadline?: number) => {
  const data = await call<Rate>('convert', `${URL}/convert`, cid, {
    timeoutMs: CONVERT_TIMEOUT_MS,
    deadline,
  });
  if (!isValidRate(data?.rate)) {
    log('rate.rejected', cid, 0, { rateRecebido: data?.rate ?? null });
    throw new DependencyError(
      'convert',
      'invalid-response',
      `convert: taxa inválida (${JSON.stringify(data?.rate ?? null)})`,
    );
  }
  return data;
});

@Injectable()
export class ExchangeService {
  convert(cid: string, deadline?: number) {
    return convertCall(cid, deadline);
  }
}
