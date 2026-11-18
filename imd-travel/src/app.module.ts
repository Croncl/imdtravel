import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CorrelationMiddleware } from './common/correlation.middleware.js';
import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';
import { TicketsController } from './tickets/tickets.controller.js';
import { TicketsService } from './tickets/tickets.service.js';
import { SalesController } from './sales/sales.controller.js';
import { SalesService } from './sales/sales.service.js';
import { AirlinesHubService } from './clients/airlineshub.service.js';
import { ExchangeService } from './clients/exchange.service.js';
import { FidelityService } from './clients/fidelity.service.js';

@Module({
  controllers: [HealthController, TicketsController, SalesController],
  providers: [
    HealthService,
    TicketsService,
    SalesService,
    AirlinesHubService,
    ExchangeService,
    FidelityService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
