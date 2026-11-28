import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  InternalServerErrorException,
  Post,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { TicketsService } from './tickets.service.js';
import { DependencyError } from '../utils/http-client.js';

interface BuyTicketDto {
  flight?: string;
  day?: string;
  user?: string;
}

@Controller()
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post('buyTicket')
  @HttpCode(201)
  async buyTicket(
    @Body() body: BuyTicketDto,
    @Headers('x-correlation-id') cid: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { flight, day, user } = body ?? {};

    if (!flight || !day || !user) {
      throw new HttpException({ error: 'invalid-request' }, 400);
    }

    try {
      const result = await this.ticketsService.buy(flight, day, user, cid);
      // P4 — 201 só com a venda confirmada pelo AirlinesHub; 200 quando não se
      // sabe se a venda aconteceu (degradations traz "sell-unconfirmed").
      res.status(result.confirmed ? 201 : 200);
      return result.body;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Timeout, conexão recusada, 5xx ou circuito aberto: falha rápida com 503.
      if (err instanceof DependencyError) {
        throw new ServiceUnavailableException({
          error: 'dependência indisponível',
          dependency: err.dependency,
          reason: err.reason,
          detail: err.message,
        });
      }
      throw new InternalServerErrorException({
        error: 'dependência indisponível',
        detail: (err as Error).message,
      });
    }
  }
}
