import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  InternalServerErrorException,
  Post,
} from '@nestjs/common';
import { TicketsService } from './tickets.service.js';

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
  ) {
    const { flight, day, user } = body ?? {};

    if (!flight || !day || !user) {
      throw new HttpException({ error: 'invalid-request' }, 400);
    }

    try {
      return await this.ticketsService.buy(flight, day, user, cid);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new InternalServerErrorException({
        error: 'dependência indisponível',
        detail: (err as Error).message,
      });
    }
  }
}
