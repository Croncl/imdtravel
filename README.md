# IMDTravel — Tolerância a Falhas

Projeto da disciplina DIM0534 - Tópicos Especiais em Engenharia de Software IV (DIMAp/UFRN).

Parte 1: versão BASELINE do sistema de venda de passagens aéreas, sem tolerância a falhas.

## Equipe
- Cristovão Lacerda Cronje
- Matheus Gabriel Souto de Lira Freitas

## Linguagem e framework
- **IMDTravel**: TypeScript + [NestJS 12](https://nestjs.com) (Node.js 24), em [`imd-travel/`](imd-travel/), no padrão controller + service:
  - `tickets/` — `POST /buyTicket` (orquestra as 4 chamadas em ordem)
  - `sales/` — `GET /sales` (registro local em `/data/sales.jsonl`, volume `sales-data`)
  - `health/` — `GET /health` (verifica se o diretório de vendas é gravável)
  - `clients/` — chamadas ao AirlinesHub, Exchange e Fidelity
  - `utils/http-client.ts` — client HTTP com axios, **sem timeout configurado** (padrão do axios: 0, sem limite), sem retry
  - `common/` — log JSON por linha (`ts, svc, cid, event, ms`) e middleware de `X-Correlation-Id`
- **AirlinesHub, Exchange, Fidelity**: imagens prontas `gibeonufrn/imdtravel-*:baseline`.

Versão BASELINE escrita como se tudo sempre funcionasse: nenhum try/catch, validação, fallback, cache ou retry.

## Como rodar
```
docker compose up -d --build --wait
curl -H 'Content-Type: application/json' -d '{"flight":"IMD100","day":"2026-12-01","user":"ana"}' http://localhost:8080/buyTicket
./testes.sh --com-falhas
```

## Catálogo de voos
3 voos × 7 dias (`2026-12-01` a `2026-12-07`), 20 assentos por par. Preço = base + 12,25 × dia.

| Voo | Preço em 2026-12-01 | Preço em 2026-12-07 |
|---|---|---|
| IMD100 | US$ 350,50 | US$ 424,00 |
| IMD200 | US$ 420,50 | US$ 494,00 |
| IMD300 | US$ 510,50 | US$ 584,00 |

Taxa de câmbio inicial 5,50, variação de até ±0,3% a cada 10 s, entre 5,00 e 6,00.

## Testes realizados
- Unitário: `cd imd-travel && pnpm test` (ordem das 4 chamadas, cálculo de BRL e bônus).
- Funcional: `./testes.sh --com-falhas` — saída em [`tests/testes-com-falhas.txt`](tests/testes-com-falhas.txt), logs em [`tests/docker-compose-logs.txt`](tests/docker-compose-logs.txt).
