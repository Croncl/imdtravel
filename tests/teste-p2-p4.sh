#!/usr/bin/env bash
#
# teste-p2-p4.sh — demonstra P2 (nenhum valor inválido), P3 (no máximo um
# assento por compra) e P4 (resposta honesta) com as falhas injetadas ligadas.
#
# Uso:  ./tests/teste-p2-p4.sh
#       ./tests/teste-p2-p4.sh | tee tests/evidencia-p2-p4.txt
#
# P2 — Resposta (/convert com rate errado)
#   A1. p=1: nenhuma compra 201, todas 503 do convert; nenhuma linha em /sales;
#       nenhum /sell chegou ao AirlinesHub (taxa rejeitada nunca custa assento).
#   A2. p=0.5: toda venda gravada tem rate em [5, 6] e valueBRL = valueUSD × rate.
# P3 — Omissão (/sell vende e não responde), sozinha e com as 4 falhas juntas
#   B. Cada cid chega ao /sell no máximo 1 vez; assentos consumidos = /sell recebidos.
# P4 — status e degradations
#   C1. Normal: 201, degraded=false.
#   C2. Omissão: 200 + sell-unconfirmed, transactionId=null, fora de /sales;
#       depois do breaker do sell abrir, 503 circuit-open (nada enviado).
#   C3. Crash do Fidelity: 201 + bonus-deferred, venda gravada em /sales.
# Em todos: resposta antes de 5000ms (P1).
#
# Cada cenário recria as dependências (estoque cheio) e reinicia o IMDTravel.
# No fim, todas as falhas são desligadas.
#
# Requer: docker compose, curl, jq. O sistema já construído (docker compose build).

set -u
cd "$(dirname "$0")/.."

IMDTRAVEL="${IMDTRAVEL:-http://localhost:${IMDTRAVEL_HOST_PORT:-8080}}"
PRAZO_MS=5000
VOO="IMD200"
DIA="2026-12-05"

for dep in docker curl jq; do
    command -v "$dep" >/dev/null 2>&1 || { echo "falta o comando: $dep" >&2; exit 2; }
done

# Nenhuma falha herdada do terminal: só as de cada cenário.
for v in $(env | grep -o '^FAULT_[A-Z_]*'); do unset "$v"; done

TMP="$(mktemp -d)"
EXEC="$(date +%s)"
PASSOU=0
FALHOU=0

verde()    { printf '\033[32m%s\033[0m' "$1"; }
vermelho() { printf '\033[31m%s\033[0m' "$1"; }
secao()    { printf '\n== %s\n' "$1"; }

# confere "descrição" "condição verdadeira?" (0/1) "detalhe se falhar"
confere() {
    if [ "$2" = 1 ]; then
        PASSOU=$((PASSOU + 1)); printf '  %s %s\n' "$(verde ok)" "$1"
    else
        FALHOU=$((FALHOU + 1)); printf '  %s %s — %s\n' "$(vermelho FALHOU)" "$1" "$3"
    fi
}
sim() { if "$@"; then echo 1; else echo 0; fi; }

desligar_falhas() {
    docker compose up -d --wait --no-build >/dev/null 2>&1
}
trap 'desligar_falhas; rm -rf "$TMP"' EXIT

esperar_imdtravel() {
    for _ in $(seq 1 60); do
        curl -fs "$IMDTRAVEL/health" >/dev/null 2>&1 && return 0
        sleep 1
    done
    echo "o IMDTravel não ficou saudável" >&2; exit 1
}

# subir_com "FAULT_X_P=1 ..." — recria as dependências com só essas falhas
# ligadas e reinicia o IMDTravel (breakers fechados, estoque cheio).
subir_com() {
    # shellcheck disable=SC2086
    if ! env $1 docker compose up -d --wait --no-build --force-recreate \
            airlineshub exchange fidelity >"$TMP/up.log" 2>&1; then
        # O Crash derruba o Fidelity: o --wait pode acusar unhealthy. Só falha se não subiu.
        docker compose ps --status running fidelity | grep -q fidelity \
            || { cat "$TMP/up.log" >&2; exit 1; }
    fi
    docker compose restart imdtravel >/dev/null 2>&1
    esperar_imdtravel
    LIMITE_LOG="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

assentos() {
    docker compose exec -T airlineshub curl -s "http://localhost:8080/flight?flight=$VOO&day=$DIA" \
        < /dev/null | jq -r '.seatsAvailable'
}

# compra <cid> — imprime "status ms" e guarda o corpo em $TMP/<cid>.json
compra() {
    local out
    out="$(curl -s -o "$TMP/$1.json" -w '%{http_code} %{time_total}' --max-time 60 \
        -X POST "$IMDTRAVEL/buyTicket" \
        -H 'Content-Type: application/json' -H "X-Correlation-Id: $1" \
        -d "{\"flight\":\"$VOO\",\"day\":\"$DIA\",\"user\":\"$EXEC-p24\"}")"
    LC_ALL=C awk '{ printf "%s %d\n", $1, $2 * 1000 }' <<< "$out"
}

resumo_corpo() {
    jq -c 'if .error then {dependency, reason}
           else {transactionId, rate, valueBRL, degradations} end' \
        "$TMP/$1.json" 2>/dev/null || head -c 200 "$TMP/$1.json"
}

# compras <prefixo> <n> — faz n compras; status em $TMP/<prefixo>.status ("cid status ms")
compras() {
    local pre="$1" n="$2" i cid status ms
    : > "$TMP/$pre.status"
    for i in $(seq 1 "$n"); do
        cid="$EXEC-$pre-$i"
        read -r status ms <<< "$(compra "$cid")"
        printf '  compra %2d: HTTP %s em %5dms  %s\n' "$i" "$status" "$ms" "$(resumo_corpo "$cid")"
        echo "$cid $status $ms" >> "$TMP/$pre.status"
    done
    confere "P1: todas as compras de $pre responderam antes de ${PRAZO_MS}ms" \
        "$(awk -v p="$PRAZO_MS" '$2 == "000" || $3 >= p { r = 1 } END { print r ? 0 : 1 }' \
            "$TMP/$pre.status")" "alguma passou do prazo"
}

conta_status() { awk -v s="$2" '$2 == s' "$TMP/$1.status" | wc -l | tr -d ' '; }

# linhas de /sales com os cids de um prefixo desta execução
vendas_de() {
    curl -s "$IMDTRAVEL/sales" | jq --arg p "$EXEC-$1-" \
        '[.[] | select(.correlationId | startswith($p))]'
}

# quantas vezes cada cid do prefixo chegou ao POST /sell do AirlinesHub (máximo)
max_sell_por_cid() {
    docker compose logs airlineshub --no-log-prefix --since "$LIMITE_LOG" 2>/dev/null \
        | grep '"event":"requisicao.recebida"' | grep '"path":"/sell"' \
        | grep -o "\"cid\":\"$EXEC-$1-[0-9]*\"" | sort | uniq -c \
        | awk 'BEGIN { m = 0 } $1 > m { m = $1 } END { print m }'
}

total_sell() {
    docker compose logs airlineshub --no-log-prefix --since "$LIMITE_LOG" 2>/dev/null \
        | grep '"event":"requisicao.recebida"' | grep '"path":"/sell"' \
        | grep -c "\"cid\":\"$EXEC-$1-"
}

log_imdtravel_tem() {
    docker compose logs imdtravel --no-log-prefix --since "$LIMITE_LOG" 2>/dev/null \
        | grep -q "$1"
}

# ------------------------------------------------------------------ P2

secao "A1. P2 — /convert sempre errado (FAULT_CONVERT_P=1 FAULT_CONVERT_TTL_SEC=0)"
subir_com "FAULT_CONVERT_P=1 FAULT_CONVERT_TTL_SEC=0"
compras p2a 8
confere "nenhuma compra deu 201 com taxa errada" "$(sim [ "$(conta_status p2a 201)" = 0 ])" \
    "$(conta_status p2a 201) compras 201"
confere "todas responderam 503 do convert (invalid-response ou circuit-open)" \
    "$(sim [ "$(jq -s '[.[] | select(.dependency == "convert")] | length' \
        "$TMP"/"$EXEC"-p2a-*.json)" = 8 ])" "nem todas foram 503 do convert"
confere "nenhuma linha em /sales" "$(sim [ "$(vendas_de p2a | jq length)" = 0 ])" \
    "$(vendas_de p2a | jq length) linhas"
confere "nenhum POST /sell chegou ao AirlinesHub (nenhum assento gasto)" \
    "$(sim [ "$(total_sell p2a)" = 0 ])" "$(total_sell p2a) /sell"
confere "log do IMDTravel registrou rate.rejected" \
    "$(sim log_imdtravel_tem '"event":"rate.rejected"')" "sem rate.rejected"

secao "A2. P2 — /convert errado em metade das vezes (FAULT_CONVERT_P=0.5)"
subir_com "FAULT_CONVERT_P=0.5 FAULT_CONVERT_TTL_SEC=0"
compras p2b 10
vendas_de p2b > "$TMP/p2b-vendas.json"
echo "  vendas gravadas: $(jq length "$TMP/p2b-vendas.json") de 10 compras"
confere "toda venda gravada tem rate numérico em [5.0, 6.0]" \
    "$(jq '[.[] | select((.rate | type) != "number" or .rate < 5 or .rate > 6)] | length == 0' \
        "$TMP/p2b-vendas.json" | sed 's/true/1/;s/false/0/')" "venda com taxa fora da faixa"
confere "todo valueBRL = valueUSD × rate (±0,01)" \
    "$(jq '[.[] | select(((.valueUSD * .rate) - .valueBRL) | fabs > 0.01)] | length == 0' \
        "$TMP/p2b-vendas.json" | sed 's/true/1/;s/false/0/')" "valueBRL inconsistente"
confere "toda compra 201 devolveu rate válido ao cliente" \
    "$(awk '$2 == "201" { print $1 }' "$TMP/p2b.status" | while read -r c; do
        jq '.rate' "$TMP/$c.json"; done \
        | awk 'BEGIN { ok = 1 } $1 < 5 || $1 > 6 { ok = 0 } END { print ok }')" \
    "rate inválido numa resposta 201"

# ------------------------------------------------------------------ P3 + P4

secao "B1/C2. P3 + P4 — Omissão no /sell (FAULT_SELL_P=1 FAULT_SELL_TTL_SEC=15)"
subir_com "FAULT_SELL_P=1 FAULT_SELL_TTL_SEC=15"
ANTES="$(assentos)"
compras p3 7
DEPOIS="$(assentos)"
SELLS="$(total_sell p3)"
echo "  assentos: $ANTES → $DEPOIS (consumidos: $((ANTES - DEPOIS))); POST /sell recebidos: $SELLS"
confere "P3: cada cid chegou ao /sell no máximo 1 vez" \
    "$(sim [ "$(max_sell_por_cid p3)" -le 1 ])" "algum cid chegou $(max_sell_por_cid p3) vezes"
confere "P3: assentos consumidos = /sell recebidos ≤ compras" \
    "$([ "$((ANTES - DEPOIS))" = "$SELLS" ] && [ "$SELLS" -le 7 ] && echo 1 || echo 0)" \
    "consumidos $((ANTES - DEPOIS)), /sell $SELLS"
confere "P4: nenhuma compra deu 201 (nenhuma venda foi confirmada)" \
    "$(sim [ "$(conta_status p3 201)" = 0 ])" "$(conta_status p3 201) compras 201"
N200="$(conta_status p3 200)"
OK200="$(awk '$2 == "200" { print $1 }' "$TMP/p3.status" | while read -r c; do
    jq -c 'select(.degraded == true and (.degradations | index("sell-unconfirmed"))
        and .transactionId == null)' "$TMP/$c.json"; done | wc -l | tr -d ' ')"
confere "P4: as compras sem resposta deram 200 com sell-unconfirmed e transactionId=null" \
    "$([ "$N200" -ge 1 ] && [ "$OK200" = "$N200" ] && echo 1 || echo 0)" \
    "$N200 compras 200, $OK200 com o corpo certo"
confere "P4: depois do breaker abrir, 503 circuit-open (nada enviado)" \
    "$(sim [ "$(jq -s '[.[] | select(.reason == "circuit-open")] | length' \
        "$TMP"/"$EXEC"-p3-*.json)" -ge 1 ])" "nenhum circuit-open"
confere "P4: compras incertas fora de /sales" "$(sim [ "$(vendas_de p3 | jq length)" = 0 ])" \
    "$(vendas_de p3 | jq length) linhas"
confere "P4: log registrou sell.unconfirmed" \
    "$(sim log_imdtravel_tem '"event":"sell.unconfirmed"')" "sem sell.unconfirmed"

secao "B2. P3 — as quatro falhas juntas"
subir_com "FAULT_FLIGHT_P=0.3 FAULT_FLIGHT_TTL_SEC=3 FAULT_SELL_P=0.5 FAULT_SELL_TTL_SEC=3 \
FAULT_CONVERT_P=0.3 FAULT_CONVERT_TTL_SEC=0 FAULT_BONUS_P=0.3 FAULT_BONUS_TTL_SEC=5"
ANTES="$(assentos)"
compras p3j 10
DEPOIS="$(assentos)"
SELLS="$(total_sell p3j)"
N201="$(conta_status p3j 201)"
echo "  assentos consumidos: $((ANTES - DEPOIS)); POST /sell recebidos: $SELLS; compras 201: $N201"
confere "P3: cada cid chegou ao /sell no máximo 1 vez" \
    "$(sim [ "$(max_sell_por_cid p3j)" -le 1 ])" "algum cid chegou $(max_sell_por_cid p3j) vezes"
confere "P3: assentos consumidos ≤ compras" "$(sim [ "$((ANTES - DEPOIS))" -le 10 ])" \
    "$((ANTES - DEPOIS)) assentos para 10 compras"
confere "P4: linhas em /sales = compras 201 (só venda confirmada é gravada)" \
    "$(sim [ "$(vendas_de p3j | jq length)" = "$N201" ])" \
    "$(vendas_de p3j | jq length) linhas para $N201 compras 201"

secao "C1. P4 — sem falha"
subir_com ""
compras p4n 2
confere "201 com degraded=false e degradations=[]" \
    "$([ "$(conta_status p4n 201)" = 2 ] && [ "$(jq -s '[.[] | select(.degraded == false
        and .degradations == [])] | length' "$TMP"/"$EXEC"-p4n-*.json)" = 2 ] && echo 1 || echo 0)" \
    "status ou corpo inesperado"

secao "C3. P4 — Crash do Fidelity (FAULT_BONUS_P=1 FAULT_BONUS_TTL_SEC=15)"
subir_com "FAULT_BONUS_P=1 FAULT_BONUS_TTL_SEC=15"
compras p4c 3
confere "todas 201: a venda foi confirmada, o Fidelity não derruba a compra" \
    "$(sim [ "$(conta_status p4c 201)" = 3 ])" "$(conta_status p4c 201) de 3"
confere "todas com degradations=[\"bonus-deferred\"]" \
    "$(sim [ "$(jq -s '[.[] | select(.degradations == ["bonus-deferred"])] | length' \
        "$TMP"/"$EXEC"-p4c-*.json)" = 3 ])" "corpo sem bonus-deferred"
confere "as 3 vendas estão em /sales" "$(sim [ "$(vendas_de p4c | jq length)" = 3 ])" \
    "$(vendas_de p4c | jq length) linhas"

# ------------------------------------------------------------------ resumo

printf '\n== Resumo: %s, %s\n' "$(verde "$PASSOU passaram")" \
    "$([ "$FALHOU" = 0 ] && echo "0 falharam" || vermelho "$FALHOU falharam")"
[ "$FALHOU" = 0 ]
