import { Injectable } from '@nestjs/common';
import { AirlinesHubService, SellResult } from '../clients/airlineshub.service.js';
import { ExchangeService } from '../clients/exchange.service.js';
import { FidelityService } from '../clients/fidelity.service.js';
import { SalesService } from '../sales/sales.service.js';
import { log } from '../common/log.js';
import { DependencyError } from '../utils/http-client.js';
import { isValidRate } from '../utils/validate.js';

// Prazo total da compra (P1 exige ≤ 5000ms); a folga cobre o processamento local.
const BUY_DEADLINE_MS = Number(process.env.BUY_DEADLINE_MS ?? 4500);

// Valores possíveis de `degradations` na resposta (P4, seção 5 da spec).
export type Degradation =
  | 'sell-unconfirmed' // /sell enviado sem resposta: não se sabe se o assento foi vendido
  | 'bonus-deferred'; // venda confirmada, mas o bônus não foi creditado agora

export interface BuyBody {
  transactionId: string | null;
  flight: string;
  day: string;
  user: string;
  valueUSD: number;
  valueBRL: number;
  rate: number;
  rateAsOf: string;
  bonus: number | null;
  degraded: boolean;
  degradations: Degradation[];
}

// `confirmed` decide o status HTTP no controller: 201 confirmado, 200 incerto.
export interface BuyResult {
  confirmed: boolean;
  body: BuyBody;
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly airlinesHub: AirlinesHubService,
    private readonly exchange: ExchangeService,
    private readonly fidelity: FidelityService,
    private readonly sales: SalesService,
  ) {}

  async buy(flight: string, day: string, user: string, cid: string): Promise<BuyResult> {
    const start = Date.now();
    // Cada chamada só pode usar o que resta deste prazo.
    const deadline = start + BUY_DEADLINE_MS;
    const degradations: Degradation[] = [];

    // 1. Consulta voo e preço (preço já validado no client)
    const flightData = await this.airlinesHub.getFlight(flight, day, cid, deadline);

    // 2. Consulta taxa de câmbio (taxa já validada no client — P2). Vem antes do
    //    /sell: uma taxa rejeitada nunca custa um assento.
    const rateData = await this.exchange.convert(cid, deadline);

    const valueUSD = flightData.priceUSD;
    const valueBRL = Math.round(valueUSD * rateData.rate * 100) / 100;
    // P2 — barreira de contenção: última linha de defesa antes do /sell, de
    // /sales e da resposta. Não deve disparar (os clients já validam).
    if (!isValidRate(rateData.rate) || !Number.isFinite(valueBRL) || valueBRL <= 0) {
      throw new DependencyError(
        'convert',
        'invalid-response',
        `valor inválido: rate=${String(rateData.rate)} valueBRL=${valueBRL}`,
        false,
      );
    }

    // 3. Vende o assento — UMA única chamada (P3). Nenhum caminho abaixo
    //    chama sell() de novo: o POST /sell não é idempotente.
    let sellData: SellResult | null = null;
    try {
      sellData = await this.airlinesHub.sell(flight, day, cid, deadline);
    } catch (err) {
      // P4 — o pedido pode ter chegado (timeout, conexão cortada, 5xx): o
      // AirlinesHub pode ter vendido. Não se sabe → compra incerta, 200.
      // 404/409 e falhas sem envio (recusa, circuito aberto, prazo) são
      // "não vendeu com certeza" e seguem como erro (404/409/503).
      if (!(err instanceof DependencyError) || !err.sent) throw err;
      degradations.push('sell-unconfirmed');
      log('sell.unconfirmed', cid, Date.now() - start, {
        flight,
        day,
        user,
        reason: err.reason,
        detail: err.message,
      });
    }

    const bonus = Math.floor(valueUSD);
    // Campos da Parte 1 + degraded/degradations (P4, seção 5 da spec).
    const body = (transactionId: string | null, bonusValue: number | null): BuyBody => ({
      transactionId,
      flight,
      day,
      user,
      valueUSD,
      valueBRL,
      rate: rateData.rate,
      rateAsOf: rateData.asOf,
      bonus: bonusValue,
      degraded: degradations.length > 0,
      degradations,
    });

    if (sellData === null) {
      // Venda incerta: sem bônus (não se sabe se é devido) e fora de /sales,
      // que só guarda venda confirmada. Fica o evento sell.unconfirmed no log.
      log('buy.unconfirmed', cid, Date.now() - start, { flight, day, user });
      return { confirmed: false, body: body(null, null) };
    }

    // 4. Credita bônus de fidelidade. A venda já está confirmada: uma falha do
    //    Fidelity não pode mais virar erro da compra (P4; a fila de reenvio é P5).
    try {
      await this.fidelity.bonus(user, bonus, cid, deadline);
    } catch (err) {
      degradations.push('bonus-deferred');
      log('bonus.failed', cid, Date.now() - start, {
        user,
        bonus,
        detail: (err as Error).message,
      });
    }

    // Registra a venda localmente: só venda confirmada e com valores válidos.
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

    log('buy.ok', cid, Date.now() - start, { flight, day, user, degradations });

    return { confirmed: true, body: body(sellData.transactionId, bonus) };
  }
}
