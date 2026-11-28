import { Injectable } from '@nestjs/common';
import { AirlinesHubService } from '../clients/airlineshub.service.js';
import { ExchangeService } from '../clients/exchange.service.js';
import { FidelityService } from '../clients/fidelity.service.js';
import { SalesService } from '../sales/sales.service.js';
import { log } from '../common/log.js';

// Prazo total da compra (P1 exige ≤ 5000ms); a folga cobre o processamento local.
const BUY_DEADLINE_MS = Number(process.env.BUY_DEADLINE_MS ?? 4500);

@Injectable()
export class TicketsService {
  constructor(
    private readonly airlinesHub: AirlinesHubService,
    private readonly exchange: ExchangeService,
    private readonly fidelity: FidelityService,
    private readonly sales: SalesService,
  ) {}

  async buy(flight: string, day: string, user: string, cid: string) {
    const start = Date.now();
    // Cada chamada só pode usar o que resta deste prazo.
    const deadline = start + BUY_DEADLINE_MS;

    // 1. Consulta voo e preço
    const flightData = await this.airlinesHub.getFlight(flight, day, cid, deadline);

    // 2. Consulta taxa de câmbio
    const rateData = await this.exchange.convert(cid, deadline);

    // 3. Vende o assento
    const sellData = await this.airlinesHub.sell(flight, day, cid, deadline);

    // 4. Credita bônus de fidelidade
    const valueUSD = flightData.priceUSD;
    const bonus = Math.floor(valueUSD);
    await this.fidelity.bonus(user, bonus, cid, deadline);

    // Calcula valor em BRL
    const valueBRL = Math.round(valueUSD * rateData.rate * 100) / 100;

    // Regista a venda localmente
    this.sales.save({
      correlationId: cid,
      transactionId: sellData.transactionId,
      flight,
      day,
      user,
      valueUSD,
      valueBRL,
      rate: rateData.rate,
      ts: new Date().toISOString(),
    });

    log('buy.ok', cid, Date.now() - start, { flight, day, user });

    return {
      transactionId: sellData.transactionId,
      flight,
      day,
      user,
      valueUSD,
      valueBRL,
      rate: rateData.rate,
      rateAsOf: rateData.asOf,
      bonus,
    };
  }
}
