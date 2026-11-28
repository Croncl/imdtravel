# IMDTravel — Tolerância a Falhas

Projeto da disciplina DIM0534 - Tópicos Especiais em Engenharia de Software IV (DIMAp/UFRN).

Sistema de venda de passagens aéreas. Parte 1: versão BASELINE (tag `BASELINE`), sem tolerância a falhas. Parte 2: tolerância a falhas no IMDTravel (abaixo).

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
  - `utils/` — client HTTP com axios (timeout com cancelamento, sem retry), circuit breaker e validação dos valores recebidos
  - `common/` — log JSON por linha (`ts, svc, cid, event, ms`) e middleware de `X-Correlation-Id`
- **AirlinesHub, Exchange, Fidelity**: imagens prontas `gibeonufrn/imdtravel-*:baseline`.

A versão da tag BASELINE foi escrita como se tudo sempre funcionasse: nenhum try/catch, validação, fallback, cache ou retry. As estratégias da Parte 2 estão descritas abaixo.

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
| **P2** — Nenhum valor inválido | Hanmer: **Complete Parameter Checking** (taxa tem de ser número finito em [`RATE_MIN`, `RATE_MAX`]; preço número finito > 0) + **Error Containment Barrier** (o client rejeita; o orquestrador barra de novo antes do `/sell`, de `/sales` e da resposta). Taxa inválida conta como erro no Circuit Breaker | [`utils/validate.ts`](imd-travel/src/utils/validate.ts), [`clients/exchange.service.ts`](imd-travel/src/clients/exchange.service.ts), `getFlight` em [`clients/airlineshub.service.ts`](imd-travel/src/clients/airlineshub.service.ts), barreira em [`tickets/tickets.service.ts`](imd-travel/src/tickets/tickets.service.ts) | [`tests/teste-p2-p4.sh`](tests/teste-p2-p4.sh) A1–A2 → [`tests/evidencia-p2-p4.txt`](tests/evidencia-p2-p4.txt); [`validate.spec.ts`](imd-travel/src/utils/validate.spec.ts), [`tickets.service.spec.ts`](imd-travel/src/tickets/tickets.service.spec.ts) |
| **P3** — ≤ 1 assento por compra | Hanmer: **Limit Retries** com limite **zero** para o `POST /sell`, que não é idempotente (semântica *at-most-once*): uma única chamada, nenhum retry no client, no breaker ou no orquestrador, e nenhuma "nova tentativa para descobrir". Circuito aberto não envia nada | `sell` em [`clients/airlineshub.service.ts`](imd-travel/src/clients/airlineshub.service.ts) e [`tickets/tickets.service.ts`](imd-travel/src/tickets/tickets.service.ts) | [`tests/teste-p2-p4.sh`](tests/teste-p2-p4.sh) B1–B2 (`/sell` por `cid` no log do AirlinesHub ≤ 1; assentos consumidos = `/sell` recebidos); [`tickets.service.spec.ts`](imd-travel/src/tickets/tickets.service.spec.ts) |
| **P4** — Resposta honesta | Hanmer: **Fault Correlation** (pelo sintoma — recusa, timeout, conexão cortada — decide se o `/sell` pode ter chegado ao AirlinesHub: campo `sent` do `DependencyError`) + **Marked Data** (a resposta leva `degraded`/`degradations`) | [`utils/http-client.ts`](imd-travel/src/utils/http-client.ts) (`sent`), [`utils/circuit-breaker.ts`](imd-travel/src/utils/circuit-breaker.ts), [`tickets/tickets.service.ts`](imd-travel/src/tickets/tickets.service.ts), [`tickets/tickets.controller.ts`](imd-travel/src/tickets/tickets.controller.ts) | [`tests/teste-p2-p4.sh`](tests/teste-p2-p4.sh) C1–C3 e B1; [`http-client.spec.ts`](imd-travel/src/utils/http-client.spec.ts), [`tickets.service.spec.ts`](imd-travel/src/tickets/tickets.service.spec.ts) |
| **P5** — Fidelity não essencial | *a fazer (Tiago)* | | |
| **P6** — Compra sob Tempo e Resposta | *a fazer (Matheus)* | | |
| **P7** — Falha rápida e volta sozinha | **Circuit Breaker** (opossum), um por endpoint: `flight`, `convert`, `sell`, `bonus` (Nygard, *Release It!*). Hanmer: *Leaky Bucket Counter* (conta erros numa janela para separar falha persistente de transitória) | [`utils/circuit-breaker.ts`](imd-travel/src/utils/circuit-breaker.ts), `clients/*.service.ts` | [`tests/teste-p1-p7.sh`](tests/teste-p1-p7.sh) parte B → [`tests/evidencia-p1-p7.txt`](tests/evidencia-p1-p7.txt) |

## Estratégias

### Timeout e prazo total (P1)
- Cada chamada a uma dependência tem um limite próprio. Ao estourar, o `AbortController` **cancela o pedido HTTP** (a conexão é fechada, não fica pendurada na dependência).
- O limite por chamada sozinho não garante P1: as 4 chamadas são sequenciais. Por isso a compra tem um **prazo total** (`BUY_DEADLINE_MS`), e cada chamada usa no máximo `min(limite próprio, tempo que resta do prazo)`.
- Falha técnica de dependência (timeout, conexão recusada, 5xx, circuito aberto) responde **503** com `{ error, dependency, reason }`; `reason` é `timeout`, `unavailable`, `circuit-open` ou `invalid-response` (P2). 404 e 409 continuam sendo respostas de negócio. Exceção: falha no `/sell` depois de enviado, ou no `/bonus`, não vira 503 (ver P4).

### Circuit Breaker (P7)
- **Fechado**: as chamadas passam. Os erros são contados numa janela móvel de `CB_ROLLING_WINDOW_MS`.
- **Aberto**: com pelo menos `CB_VOLUME_THRESHOLD` chamadas na janela e `CB_ERROR_THRESHOLD_PCT`% delas com erro, o breaker abre: a compra falha na hora (~1 ms), **sem chamar a dependência**.
- **Meio-aberto**: depois de `CB_RESET_TIMEOUT_MS`, deixa passar uma chamada de teste. Se der certo, fecha; se falhar, volta a abrir.
- 404/409 não contam como erro. O timeout do próprio opossum fica desligado: o do `http-client` já cancela o pedido de verdade.
- Eventos no log: `cb.open`, `cb.halfOpen`, `cb.close` (campo `dependency`).

### Validação dos valores recebidos (P2)
- O Exchange, sob a falha Resposta, devolve 200 com `rate` zero, negativo, absurdo ou não numérico. A BASELINE gravava essas vendas (`valueBRL` nulo, zero, negativo ou na casa dos bilhões).
- O client do Exchange aceita a taxa só se for `number`, finita e dentro de [`RATE_MIN`, `RATE_MAX`]. Fora disso: evento `rate.rejected` e `DependencyError` com `reason: "invalid-response"`, que responde **503**.
- A validação fica **dentro** do Circuit Breaker: corrupção persistente abre o circuito do `convert` como um timeout abriria (P7).
- O `/convert` vem antes do `/sell`: uma taxa rejeitada nunca custa um assento.
- O preço do `/flight` passa pela mesma checagem (número finito > 0), e o orquestrador confere de novo `rate` e `valueBRL` antes do `/sell`, de `/sales` e da resposta.

### Uma única chamada ao `/sell` (P3)
- O `POST /sell` não é idempotente, e sob Omissão o AirlinesHub vende e não responde. Reenviar venderia um segundo assento.
- O `/sell` é chamado em um único ponto do `TicketsService`. Nenhum caminho de erro o chama de novo, e não há retry no axios nem no opossum.
- Não há reconciliação: a venda omitida não aparece no `/sales` do AirlinesHub, então o resultado fica "desconhecido" (P4).

### Resposta honesta (P4)
O `DependencyError` informa `sent`: se o pedido **pode** ter chegado à dependência.

| Situação | `sent` |
|---|---|
| Prazo esgotado antes de enviar, conexão recusada, DNS, circuito aberto | `false` (com certeza não chegou) |
| Timeout depois de enviar, conexão cortada (`socket hang up`), resposta 5xx | `true` (pode ter chegado) |

Com isso, o resultado do `/sell` vira o status da compra:

| Status | Quando | `degradations` |
|---|---|---|
| **201** | Venda confirmada pelo AirlinesHub | `[]` ou `["bonus-deferred"]` |
| **200** | `/sell` enviado sem resposta (`sent: true`): não se sabe se o assento foi vendido | `["sell-unconfirmed"]` |
| **503** | Falha antes do `/sell`, ou `/sell` não enviado (`sent: false`): nada foi vendido | — (corpo `{ error, dependency, reason }`) |
| **404 / 409** | Voo ou dia inexistente / esgotado | — |

- Compra **200**: `transactionId: null`, `bonus: null`, sem chamada ao `/bonus` (não se sabe se é devido) e **fora de `/sales`**, que só guarda venda confirmada. Fica o evento `sell.unconfirmed` no log (cid, voo, dia, usuário, motivo), para auditoria.
- Falha do `/bonus` depois da venda confirmada não derruba a compra: **201** com `bonus-deferred` e evento `bonus.failed`. A fila de reenvio do bônus é o P5.
- Toda resposta de compra traz os campos da Parte 1 mais `degraded` (boolean) e `degradations` (lista).

**Valores de `degradations`:**

| Valor | Significado |
|---|---|
| `sell-unconfirmed` | O `/sell` foi enviado e não respondeu: o assento pode ou não ter sido vendido |
| `bonus-deferred` | Venda confirmada, mas o bônus não foi creditado nesta requisição |

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
| `RATE_MIN` | 5.0 | Limite inferior garantido pelo contrato do Exchange (`EXCHANGE_MIN`); P2 exige rejeitar taxa abaixo de 5,0. |
| `RATE_MAX` | 6.0 | Limite superior garantido pelo contrato do Exchange (`EXCHANGE_MAX`); P2 exige rejeitar taxa acima de 6,0. |

Os limites do pior caso somam 1000 + 1000 + 2000 = 4000 ms até o `/sell`, abaixo do prazo de 4500 ms; o prazo total corta o que passar disso.

## Como rodar os testes da Parte 2
```
docker compose up -d --build --wait
./testes.sh                     # regressão da Parte 1, sem falhas (40/40)
./tests/teste-p1-p7.sh          # P1 e P7 com as falhas ligadas; desliga tudo no fim
./tests/teste-p2-p4.sh          # P2, P3 e P4 com as falhas ligadas; desliga tudo no fim
(cd imd-travel && pnpm test)    # testes unitários (vitest)
```
