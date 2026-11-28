# IMDTravel — Tolerância a Falhas

Projeto da disciplina DIM0534 - Tópicos Especiais em Engenharia de Software IV (DIMAp/UFRN).

Parte 1: versão BASELINE do sistema de venda de passagens aéreas, sem tolerância a falhas.

## Equipe
- Cristovão Lacerda Cronje
- Matheus Gabriel Souto de Lira Freitas
- Tiago Rodrigues dos Santos

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
- Funcional: `./testes.sh --com-falhas` — saída em [`tests/testes-com-falhas.txt`](tests/testes-com-falhas.txt), logs em [`tests/docker-compose-logs.txt`](tests/docker-compose-logs.txt).

---

# Parte 2 — Tolerância a falhas

Ponto de partida (BASELINE sob as 4 falhas injetadas): [`tests/evidencia-baseline-sob-falha.txt`](tests/evidencia-baseline-sob-falha.txt).

## Tabela de rastreabilidade

| Falha tolerada | Estratégia adotada (padrão do catálogo) | Onde está no código | Teste que demonstra |
|---|---|---|---|
| **P1** — Prazo total ≤ 5000 ms | **Timeout** com cancelamento da chamada (AbortController) e prazo total da compra (*deadline*); limites por dependência. Hanmer: *Watchdog* + *Realistic Threshold* | [`utils/http-client.ts`](imd-travel/src/utils/http-client.ts), [`tickets/tickets.service.ts`](imd-travel/src/tickets/tickets.service.ts) (deadline), `clients/*.service.ts` (limites) | [`tests/teste-p1-p7.sh`](tests/teste-p1-p7.sh) partes A1–A3 → [`tests/evidencia-p1-p7.txt`](tests/evidencia-p1-p7.txt) |
| **P2** — Nenhum valor inválido | *a fazer (Matheus)* | | |
| **P3** — ≤ 1 assento por compra | *a fazer (Matheus)* | | |
| **P4** — Resposta honesta | *a fazer (Matheus)* | | |
| **P5** — Fidelity não essencial | *a fazer (Tiago)* | | |
| **P6** — Compra sob Tempo e Resposta | *a fazer (Matheus)* | | |
| **P7** — Falha rápida e volta sozinha | **Circuit Breaker** (opossum), um por endpoint: `flight`, `convert`, `sell`, `bonus` (Nygard, *Release It!*). Hanmer: *Leaky Bucket Counter* (conta erros numa janela para separar falha persistente de transitória) | [`utils/circuit-breaker.ts`](imd-travel/src/utils/circuit-breaker.ts), `clients/*.service.ts` | [`tests/teste-p1-p7.sh`](tests/teste-p1-p7.sh) parte B → [`tests/evidencia-p1-p7.txt`](tests/evidencia-p1-p7.txt) |

## Estratégias

### Timeout e prazo total (P1)
- Cada chamada a uma dependência tem um limite próprio. Ao estourar, o `AbortController` **cancela o pedido HTTP** (a conexão é fechada, não fica pendurada na dependência).
- O limite por chamada sozinho não garante P1: as 4 chamadas são sequenciais. Por isso a compra tem um **prazo total** (`BUY_DEADLINE_MS`), e cada chamada usa no máximo `min(limite próprio, tempo que resta do prazo)`.
- Falha técnica de dependência (timeout, conexão recusada, 5xx, circuito aberto) responde **503** com `{ error, dependency, reason }`; `reason` é `timeout`, `unavailable` ou `circuit-open`. 404 e 409 continuam sendo respostas de negócio.

### Circuit Breaker (P7)
- **Fechado**: as chamadas passam. Os erros são contados numa janela móvel de `CB_ROLLING_WINDOW_MS`.
- **Aberto**: com pelo menos `CB_VOLUME_THRESHOLD` chamadas na janela e `CB_ERROR_THRESHOLD_PCT`% delas com erro, o breaker abre: a compra falha na hora (~1 ms), **sem chamar a dependência**.
- **Meio-aberto**: depois de `CB_RESET_TIMEOUT_MS`, deixa passar uma chamada de teste. Se der certo, fecha; se falhar, volta a abrir.
- 404/409 não contam como erro. O timeout do próprio opossum fica desligado: o do `http-client` já cancela o pedido de verdade.
- Eventos no log: `cb.open`, `cb.halfOpen`, `cb.close` (campo `dependency`).

## Parâmetros

Todos configuráveis por variável de ambiente, com o padrão declarado no [`docker-compose.yml`](docker-compose.yml).

| Variável | Padrão | Justificativa |
|---|---|---|
| `BUY_DEADLINE_MS` | 4500 | P1 exige ≤ 5000 ms; 500 ms de folga para o processamento local e a gravação em `/sales`. |
| `FLIGHT_TIMEOUT_MS` | 1000 | O `/flight` sadio responde em poucos ms; 1 s é folga larga e deixa prazo para as chamadas seguintes. |
| `CONVERT_TIMEOUT_MS` | 1000 | Idem para o `/convert`. |
| `SELL_TIMEOUT_MS` | 2000 | O `/sell` normal leva 300–900 ms (`SELL_MAX_MS`): mais do dobro de margem, para uma venda lenta mas normal não ser tratada como falha. |
| `BONUS_TIMEOUT_MS` | 1000 | O Crash recusa a conexão na hora; o limite cobre o Fidelity pausado (aceita a conexão e não responde). |
| `HTTP_TIMEOUT_MS` | 3500 | Limite padrão para uma chamada que não declare o seu. |
| `CB_VOLUME_THRESHOLD` | 5 | Mínimo de chamadas antes de julgar a dependência. Com 10 (valor inicial), o breaker **nunca abria**: 10 timeouts de 1 s em sequência não cabiam na janela padrão de 10 s do opossum. |
| `CB_ERROR_THRESHOLD_PCT` | 50 | Metade das chamadas com erro indica falha persistente, não um erro isolado. |
| `CB_ROLLING_WINDOW_MS` | 20000 | Precisa ser maior que o tempo de juntar as amostras no pior caso (5 × 1 s de timeout). |
| `CB_RESET_TIMEOUT_MS` | 10000 | Da ordem das janelas de falha (10–15 s). Com o breaker aberto, a dependência recebe no máximo 1 chamada de teste a cada 10 s. |

Os limites do pior caso somam 1000 + 1000 + 2000 = 4000 ms até o `/sell`, abaixo do prazo de 4500 ms; o prazo total corta o que passar disso.

## Como rodar os testes da Parte 2
```
docker compose up -d --build --wait
./testes.sh                     # regressão da Parte 1, sem falhas (40/40)
./tests/teste-p1-p7.sh          # P1 e P7 com as falhas ligadas; desliga tudo no fim
```
