import { Injectable } from '@nestjs/common';
import { call } from '../utils/http-client.js';
import { withBreaker } from '../utils/circuit-breaker.js';

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
  (flight: string, day: string, cid: string, deadline?: number) => {
    const query = new URLSearchParams({ flight, day });
    return call<Flight>('flight', `${URL}/flight?${query}`, cid, {
      timeoutMs: FLIGHT_TIMEOUT_MS,
      deadline,
    });
  },
);

// Nunca reenviar: o opossum não faz retry, e o POST /sell não é idempotente.
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
