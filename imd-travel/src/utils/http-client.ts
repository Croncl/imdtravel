import { HttpException } from '@nestjs/common';
import axios from 'axios';
import { log } from '../common/log.js';

// Client HTTP do projeto. Sem timeout configurado (padrão do axios), sem retry.
// validateStatus devolve toda resposta, e o status é verificado abaixo.
const http = axios.create({
  headers: { 'Content-Type': 'application/json' },
  validateStatus: () => true,
});

export async function call<T>(
  name: string,
  url: string,
  cid: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
): Promise<T> {
  const start = Date.now();
  const res = await http.request<T>({
    url,
    method,
    data: body,
    headers: { 'X-Correlation-Id': cid },
  });
  log(`call.${name}`, cid, Date.now() - start, { status: res.status });

  // 404 (voo/dia inexistente) e 409 (sold-out) são respostas de negócio: repassa ao cliente.
  if (res.status === 404 || res.status === 409) {
    throw new HttpException(res.data as object, res.status);
  }
  // Qualquer outra falha de dependência vira 500.
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${name} respondeu ${res.status}`);
  }
  return res.data;
}
