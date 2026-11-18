import { Injectable } from '@nestjs/common';
import { call } from '../utils/http-client.js';

const URL = process.env.AIRLINESHUB_URL ?? 'http://localhost:8081';

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

@Injectable()
export class AirlinesHubService {
  getFlight(flight: string, day: string, cid: string) {
    const query = new URLSearchParams({ flight, day });
    return call<Flight>('flight', `${URL}/flight?${query}`, cid);
  }

  sell(flight: string, day: string, cid: string) {
    return call<SellResult>('sell', `${URL}/sell`, cid, 'POST', { flight, day });
  }
}
