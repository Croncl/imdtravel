import { describe, expect, it } from 'vitest';
import { isValidPrice, isValidRate } from './validate.js';

describe('isValidRate (P2)', () => {
  it.each([5.0, 5.5, 5.4321, 6.0])('aceita %s', (rate) => {
    expect(isValidRate(rate)).toBe(true);
  });

  // As variantes da falha Resposta: zero, negativo, absurdo, não numérico.
  it.each([
    0,
    -5.5,
    5.5e3,
    5.5e9,
    4.99,
    6.01,
    '5,50',
    '5.50',
    'NaN',
    'abc',
    '',
    NaN,
    Infinity,
    -Infinity,
    null,
    undefined,
    {},
  ])('rejeita %s', (rate) => {
    expect(isValidRate(rate)).toBe(false);
  });
});

describe('isValidPrice (P2)', () => {
  it('aceita preço positivo', () => {
    expect(isValidPrice(350.5)).toBe(true);
  });

  it.each([0, -1, NaN, Infinity, '350.5', null, undefined])('rejeita %s', (p) => {
    expect(isValidPrice(p)).toBe(false);
  });
});
