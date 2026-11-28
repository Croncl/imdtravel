import { Injectable } from '@nestjs/common';
import { call } from '../utils/http-client.js';
import { withBreaker } from '../utils/circuit-breaker.js';

const URL = process.env.FIDELITY_URL ?? 'http://localhost:8083';
const BONUS_TIMEOUT_MS = Number(process.env.BONUS_TIMEOUT_MS ?? 1000);

export interface Points {
  user: string;
  totalPoints: number;
}

const bonusCall = withBreaker(
  'bonus',
  (user: string, bonus: number, cid: string, deadline?: number) =>
    call<Points>('bonus', `${URL}/bonus`, cid, {
      method: 'POST',
      body: { user, bonus },
      timeoutMs: BONUS_TIMEOUT_MS,
      deadline,
    }),
);

@Injectable()
export class FidelityService {
  bonus(user: string, bonus: number, cid: string, deadline?: number) {
    return bonusCall(user, bonus, cid, deadline);
  }
}
