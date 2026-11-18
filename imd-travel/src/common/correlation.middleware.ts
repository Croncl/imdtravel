import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { log } from './log.js';

export const CID_HEADER = 'x-correlation-id';

// Aproveita o X-Correlation-Id do cliente ou gera um novo, devolve na resposta
// e registra cada requisição recebida ao terminar.
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const cid = req.header(CID_HEADER) || randomUUID();
    req.headers[CID_HEADER] = cid;
    res.setHeader('X-Correlation-Id', cid);

    const start = Date.now();
    res.on('finish', () => {
      log('http.request', cid, Date.now() - start, {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
      });
    });
    next();
  }
}
