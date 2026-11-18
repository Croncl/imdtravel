import { Injectable } from '@nestjs/common';
import { call } from '../utils/http-client.js';

const URL = process.env.FIDELITY_URL ?? 'http://localhost:8083';

export interface Points {
  user: string;
  totalPoints: number;
}

@Injectable()
export class FidelityService {
  bonus(user: string, bonus: number, cid: string) {
    return call<Points>('bonus', `${URL}/bonus`, cid, 'POST', { user, bonus });
  }
}
