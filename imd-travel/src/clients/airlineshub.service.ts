import { Injectable } from '@nestjs/common';
import { call, DependencyError } from '../utils/http-client.js';
import { withBreaker } from '../utils/circuit-breaker.js';
import { isValidPrice } from '../utils/validate.js';
import { log } from '../common/log.js';

const URL = process.env.AIRLINESHUB_URL ?? 'http://localhost:8081';
const FLIGHT_TIMEOUT_MS = Number(process.env.FLIGHT_TIMEOUT_MS ?? 1000);
// O /sell normal leva 300–900ms: o timeout precisa de margem acima disso.
const SELL_TIMEOUT_MS = Number(process.env.SELL_TIMEOUT_MS ?? 2000);

export interface Flight {
  flight: string;
  day: string;
  priceUSD: number;
  seatsAvailable: number;
}

export interface SellResult {
  transactionId: string;
  seatsRemaining: number;
}

const getFlightCall = withBreaker(
  'flight',
  async (flight: string, day: string, cid: string, deadline?: number) => {
    const query = new URLSearchParams({ flight, day });
    const data = await call<Flight>('flight', `${URL}/flight?${query}`, cid, {
      timeoutMs: FLIGHT_TIMEOUT_MS,
      deadline,
    });
    // P2: o valueBRL deriva do preço; preço inválido não segue adiante.
    if (!isValidPrice(data?.priceUSD)) {
      log('price.rejected', cid, 0, { priceRecebido: data?.priceUSD ?? null });
      throw new DependencyError('flight', 'invalid-response', 'flight: preço inválido');
    }
    return data;
  },
);

// P3 — no máximo um assento por compra. O POST /sell NÃO é idempotente: cada
// POST aceito vende um assento. Por isso NUNCA é reenviado — nem aqui, nem no
// breaker (o opossum não faz retry), nem no axios (sem interceptador de retry),
// nem no TicketsService. Limite de retentativas = 0 (semântica at-most-once).
const sellCall = withBreaker(
  'sell',
  (flight: string, day: string, cid: string, deadline?: number) =>
    call<SellResult>('sell', `${URL}/sell`, cid, {
      method: 'POST',
      body: { flight, day },
      timeoutMs: SELL_TIMEOUT_MS,
      deadline,
    }),
);

@Injectable()
export class AirlinesHubService {
  getFlight(flight: string, day: string, cid: string, deadline?: number) {
    return getFlightCall(flight, day, cid, deadline);
  }

  sell(flight: string, day: string, cid: string, deadline?: number) {
    return sellCall(flight, day, cid, deadline);
  }
}
