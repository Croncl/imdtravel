import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  // Logger padrão do Nest desligado: só sai log JSON (ver common/log.ts).
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(process.env.PORT ?? 8080);
}
await bootstrap();
