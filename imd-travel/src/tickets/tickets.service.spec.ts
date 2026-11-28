import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TicketsService } from './tickets.service.js';
import { DependencyError } from '../utils/http-client.js';
import type { AirlinesHubService } from '../clients/airlineshub.service.js';
import type { ExchangeService } from '../clients/exchange.service.js';
import type { FidelityService } from '../clients/fidelity.service.js';
import type { SalesService } from '../sales/sales.service.js';

// O log escreve no stdout; nos testes, silencia.
vi.mock('../common/log.js', () => ({ log: vi.fn() }));

const FLIGHT = { flight: 'IMD100', day: '2026-12-01', priceUSD: 350.5, seatsAvailable: 20 };
const RATE = { rate: 5.5, asOf: '2026-11-28T00:00:00Z' };
const SOLD = { transactionId: 'tx-1', seatsRemaining: 19 };

function setup() {
  const airlinesHub = {
    getFlight: vi.fn().mockResolvedValue(FLIGHT),
    sell: vi.fn().mockResolvedValue(SOLD),
  };
  const exchange = { convert: vi.fn().mockResolvedValue(RATE) };
  const fidelity = { bonus: vi.fn().mockResolvedValue({ user: 'ana', totalPoints: 350 }) };
  const sales = { save: vi.fn() };
  const service = new TicketsService(
    airlinesHub as unknown as AirlinesHubService,
    exchange as unknown as ExchangeService,
    fidelity as unknown as FidelityService,
    sales as unknown as SalesService,
  );
  return { service, airlinesHub, exchange, fidelity, sales };
}

const buy = (s: TicketsService) => s.buy('IMD100', '2026-12-01', 'ana', 'cid-1');

describe('TicketsService', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('caminho feliz: confirmado, sem degradação, grava em /sales', async () => {
    const r = await buy(t.service);
    expect(r.confirmed).toBe(true);
    expect(r.body).toMatchObject({
      transactionId: 'tx-1',
      valueBRL: 1927.75,
      bonus: 350,
      degraded: false,
      degradations: [],
    });
    expect(t.sales.save).toHaveBeenCalledOnce();
  });

  describe('P2 — nenhum valor inválido', () => {
    it('taxa rejeitada pelo client: não vende, não grava', async () => {
      t.exchange.convert.mockRejectedValue(
        new DependencyError('convert', 'invalid-response', 'taxa inválida'),
      );
      await expect(buy(t.service)).rejects.toBeInstanceOf(DependencyError);
      expect(t.airlinesHub.sell).not.toHaveBeenCalled();
      expect(t.sales.save).not.toHaveBeenCalled();
    });

    it.each([0, -5.5, 5.5e6, 'abc', NaN])(
      'barreira do orquestrador barra rate=%s mesmo se o client deixar passar',
      async (rate) => {
        t.exchange.convert.mockResolvedValue({ rate, asOf: RATE.asOf });
        await expect(buy(t.service)).rejects.toMatchObject({ reason: 'invalid-response' });
        expect(t.airlinesHub.sell).not.toHaveBeenCalled();
        expect(t.sales.save).not.toHaveBeenCalled();
      },
    );
  });

  describe('P3 + P4 — /sell', () => {
    it('sem resposta (sent=true): 200 incerto, sell 1 vez, sem bônus, fora de /sales', async () => {
      t.airlinesHub.sell.mockRejectedValue(
        new DependencyError('sell', 'timeout', 'sell excedeu 2000ms', true),
      );
      const r = await buy(t.service);
      expect(r.confirmed).toBe(false);
      expect(r.body).toMatchObject({
        transactionId: null,
        bonus: null,
        degraded: true,
        degradations: ['sell-unconfirmed'],
      });
      expect(t.airlinesHub.sell).toHaveBeenCalledOnce();
      expect(t.fidelity.bonus).not.toHaveBeenCalled();
      expect(t.sales.save).not.toHaveBeenCalled();
    });

    it('socket hang up (sent=true) também é incerto', async () => {
      t.airlinesHub.sell.mockRejectedValue(
        new DependencyError('sell', 'unavailable', 'sell: socket hang up', true),
      );
      const r = await buy(t.service);
      expect(r.confirmed).toBe(false);
      expect(t.airlinesHub.sell).toHaveBeenCalledOnce();
    });

    it.each([
      ['circuito aberto', new DependencyError('sell', 'circuit-open', 'aberto', false)],
      ['conexão recusada', new DependencyError('sell', 'unavailable', 'ECONNREFUSED', false)],
      ['prazo esgotado', new DependencyError('sell', 'timeout', 'prazo', false)],
      ['409 esgotado', new HttpException({ error: 'sold-out' }, 409)],
    ])('%s: não vendeu com certeza, relança, sell 1 vez', async (_, err) => {
      t.airlinesHub.sell.mockRejectedValue(err);
      await expect(buy(t.service)).rejects.toBe(err);
      expect(t.airlinesHub.sell).toHaveBeenCalledOnce();
      expect(t.fidelity.bonus).not.toHaveBeenCalled();
      expect(t.sales.save).not.toHaveBeenCalled();
    });
  });

  describe('P4 — bônus depois da venda confirmada', () => {
    it('Fidelity fora do ar: 201 com bonus-deferred, venda gravada', async () => {
      t.fidelity.bonus.mockRejectedValue(
        new DependencyError('bonus', 'unavailable', 'ECONNREFUSED', false),
      );
      const r = await buy(t.service);
      expect(r.confirmed).toBe(true);
      expect(r.body).toMatchObject({
        transactionId: 'tx-1',
        degraded: true,
        degradations: ['bonus-deferred'],
      });
      expect(t.sales.save).toHaveBeenCalledOnce();
    });
  });
});
