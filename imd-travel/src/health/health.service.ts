import { Injectable } from '@nestjs/common';
import { accessSync, constants } from 'node:fs';
import { SALES_DIR } from '../sales/sales.service.js';

@Injectable()
export class HealthService {
  check() {
    // Verifica de verdade: o diretório do registro de vendas precisa ser gravável.
    accessSync(SALES_DIR, constants.W_OK);
    return { status: 'ok', uptimeS: Math.floor(process.uptime()) };
  }
}
