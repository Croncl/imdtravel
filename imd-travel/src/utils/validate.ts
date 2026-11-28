// Checagem completa dos valores que vêm das dependências (P2).
// Nada que falhe aqui pode chegar a /sales nem à resposta ao cliente.

// Faixa da taxa garantida pelo contrato do Exchange (EXCHANGE_MIN/EXCHANGE_MAX).
export const RATE_MIN = Number(process.env.RATE_MIN ?? 5.0);
export const RATE_MAX = Number(process.env.RATE_MAX ?? 6.0);

// Taxa válida: número de verdade (não string), finito e dentro da faixa.
// Rejeita zero, negativo, absurdo (×10^k) e "5,50" / "NaN" / "abc" / "".
export function isValidRate(x: unknown, min = RATE_MIN, max = RATE_MAX): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
}

// Preço válido: número finito e positivo.
export function isValidPrice(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0;
}
