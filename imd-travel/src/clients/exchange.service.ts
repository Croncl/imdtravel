import { Injectable } from '@nestjs/common';
import { call } from '../utils/http-client.js';
import { withBreaker } from '../utils/circuit-breaker.js';

const URL = process.env.EXCHANGE_URL ?? 'http://localhost:8082';
const CONVERT_TIMEOUT_MS = Number(process.env.CONVERT_TIMEOUT_MS ?? 1000);

export interface Rate {
  rate: number;
  asOf: string;
}

const convertCall = withBreaker('convert', (cid: string, deadline?: number) =>
  call<Rate>('convert', `${URL}/convert`, cid, {
    timeoutMs: CONVERT_TIMEOUT_MS,
    deadline,
  }),
);

@Injectable()
export class ExchangeService {
  convert(cid: string, deadline?: number) {
    return convertCall(cid, deadline);
  }
}
