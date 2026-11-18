import { Injectable } from '@nestjs/common';
import { call } from '../utils/http-client.js';

const URL = process.env.EXCHANGE_URL ?? 'http://localhost:8082';

export interface Rate {
  rate: number;
  asOf: string;
}

@Injectable()
export class ExchangeService {
  convert(cid: string) {
    return call<Rate>('convert', `${URL}/convert`, cid);
  }
}
