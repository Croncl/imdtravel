import { Injectable } from '@nestjs/common';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SALES_DIR = process.env.SALES_DIR ?? './data';
const SALES_FILE = join(SALES_DIR, 'sales.jsonl');

export interface Sale {
  correlationId: string;
  transactionId: string;
  flight: string;
  day: string;
  user: string;
  valueUSD: number;
  valueBRL: number;
  rate: number;
  ts: string;
}

// Registro local de vendas: um JSON por linha num arquivo do volume.
@Injectable()
export class SalesService {
  constructor() {
    mkdirSync(SALES_DIR, { recursive: true });
  }

  save(sale: Sale) {
    appendFileSync(SALES_FILE, JSON.stringify(sale) + '\n');
  }

  findAll(): Sale[] {
    if (!existsSync(SALES_FILE)) return [];
    return readFileSync(SALES_FILE, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Sale);
  }
}
