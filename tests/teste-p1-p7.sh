#!/usr/bin/env bash
#
# teste-p1-p7.sh — demonstra P1 (prazo total) e P7 (falha rápida e volta sozinha)
# com as falhas injetadas ligadas.
#
# Uso:  ./tests/teste-p1-p7.sh
#       ./tests/teste-p1-p7.sh | tee tests/evidencia-p1-p7.txt
#
# Parte A — P1: nenhuma compra responde depois de 5000ms
#   A1. AirlinesHub pausado (docker compose pause): aceita a conexão e não responde.
#   A2. Cada falha isolada (tempo, omissão, resposta, crash) e as quatro juntas.
#   Só o tempo é verificado, não o status: o status muda com as outras estratégias
#   (P4, P5, P6), mas o prazo tem de valer sempre.
#
# Parte B — P7: com o /flight em falha contínua
#   B1. As compras depois de o breaker abrir respondem bem antes do prazo (< 2500ms).
#   B2. No máximo CB_VOLUME_THRESHOLD compras chegam ao AirlinesHub (contadas no log
#       dele pelo X-Correlation-Id): o IMDTravel deixa de o sobrecarregar.
#   B3. Desligada a falha (sem reiniciar o IMDTravel), depois de CB_RESET_TIMEOUT_MS
#       a compra volta a dar 201 e o breaker fecha sozinho.
#
# Cada cenário reinicia o IMDTravel para começar com os breakers fechados.
# No fim, todas as falhas são desligadas.
#
# Requer: docker compose, curl, jq. O sistema já construído (docker compose build).

set -u
cd "$(dirname "$0")/.."

IMDTRAVEL="${IMDTRAVEL:-http://localhost:${IMDTRAVEL_HOST_PORT:-8080}}"
PRAZO_MS=5000
BEM_ANTES_MS=2500
CB_VOLUME_THRESHOLD="${CB_VOLUME_THRESHOLD:-5}"
CB_RESET_TIMEOUT_MS="${CB_RESET_TIMEOUT_MS:-10000}"
VOO="IMD300"
DIA="2026-12-06"

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

desligar_falhas() {
    docker compose up -d --wait --no-build >/dev/null 2>&1
    docker compose unpause airlineshub >/dev/null 2>&1 || true
}
trap 'desligar_falhas; rm -rf "$TMP"' EXIT

esperar_imdtravel() {
    for _ in $(seq 1 60); do
        curl -fs "$IMDTRAVEL/health" >/dev/null 2>&1 && return 0
        sleep 1
    done
    echo "o IMDTravel não ficou saudável" >&2; exit 1
}

# subir_com "FAULT_X_P=1 FAULT_X_TTL_SEC=15 ..." — recria as dependências com só
# essas falhas ligadas e reinicia o IMDTravel (breakers fechados, estoque cheio).
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
}

# compra <cid> — imprime "status ms" e guarda o corpo em $TMP/<cid>.json
compra() {
    local out
    out="$(curl -s -o "$TMP/$1.json" -w '%{http_code} %{time_total}' --max-time 60 \
        -X POST "$IMDTRAVEL/buyTicket" \
        -H 'Content-Type: application/json' -H "X-Correlation-Id: $1" \
        -d "{\"flight\":\"$VOO\",\"day\":\"$DIA\",\"user\":\"$EXEC-p17\"}")"
    # LC_ALL=C: o curl escreve "1.011"; num locale pt o awk leria só o "1".
    LC_ALL=C awk '{ printf "%s %d\n", $1, $2 * 1000 }' <<< "$out"
}

resumo_corpo() {
    jq -c 'if .error then {error, dependency, reason} else {transactionId, degraded} end' \
        "$TMP/$1.json" 2>/dev/null || head -c 200 "$TMP/$1.json"
}

# cenario_prazo <nome> <n compras> — confere P1 em cada compra
cenario_prazo() {
    local nome="$1" n="$2" i cid status ms
    for i in $(seq 1 "$n"); do
        cid="$EXEC-$nome-$i"
        read -r status ms <<< "$(compra "$cid")"
        printf '  compra %d: HTTP %s em %5dms  %s\n' "$i" "$status" "$ms" "$(resumo_corpo "$cid")"
        confere "$nome #$i respondeu antes de ${PRAZO_MS}ms" \
            "$([ "$status" != 000 ] && [ "$ms" -lt "$PRAZO_MS" ] && echo 1 || echo 0)" \
            "HTTP $status em ${ms}ms"
    done
}

# ------------------------------------------------------------------ A. P1

secao "A1. P1 com o AirlinesHub pausado"
subir_com ""
docker compose pause airlineshub >/dev/null
cenario_prazo pausado 2
docker compose unpause airlineshub >/dev/null

secao "A2. P1 sob cada falha isolada"
for f in "tempo FAULT_FLIGHT_P=1 FAULT_FLIGHT_TTL_SEC=15" \
         "omissao FAULT_SELL_P=1 FAULT_SELL_TTL_SEC=15" \
         "resposta FAULT_CONVERT_P=1 FAULT_CONVERT_TTL_SEC=0" \
         "crash FAULT_BONUS_P=1 FAULT_BONUS_TTL_SEC=15"; do
    read -r nome vars <<< "$f"
    echo "  -- $nome ($vars)"
    subir_com "$vars"
    cenario_prazo "$nome" 3
done

secao "A3. P1 com as quatro falhas juntas"
subir_com "FAULT_FLIGHT_P=1 FAULT_FLIGHT_TTL_SEC=15 FAULT_SELL_P=1 FAULT_SELL_TTL_SEC=15 \
FAULT_CONVERT_P=1 FAULT_CONVERT_TTL_SEC=0 FAULT_BONUS_P=1 FAULT_BONUS_TTL_SEC=15"
cenario_prazo todas 3

# ------------------------------------------------------------------ B. P7

secao "B. P7 com o /flight em falha contínua (Tempo, p=1, ttlSec=15)"
FALHA_FLIGHT="FAULT_FLIGHT_P=1 FAULT_FLIGHT_TTL_SEC=15"
subir_com "$FALHA_FLIGHT"
LIMITE_LOG="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
LENTAS=0
for i in $(seq 1 10); do
    cid="$EXEC-p7-$i"
    read -r status ms <<< "$(compra "$cid")"
    printf '  compra %2d: HTTP %s em %5dms  %s\n' "$i" "$status" "$ms" "$(resumo_corpo "$cid")"
    confere "p7 #$i respondeu antes de ${PRAZO_MS}ms" \
        "$([ "$status" != 000 ] && [ "$ms" -lt "$PRAZO_MS" ] && echo 1 || echo 0)" "${ms}ms"
    if [ "$i" -gt "$CB_VOLUME_THRESHOLD" ] && [ "$ms" -ge "$BEM_ANTES_MS" ]; then
        LENTAS=$((LENTAS + 1))
    fi
done

confere "B1. com o breaker aberto, as compras $((CB_VOLUME_THRESHOLD + 1))–10 responderam em < ${BEM_ANTES_MS}ms" \
    "$([ "$LENTAS" = 0 ] && echo 1 || echo 0)" "$LENTAS compras lentas"

CHEGARAM="$(docker compose logs airlineshub --no-log-prefix --since "$LIMITE_LOG" 2>/dev/null \
    | grep '"falha.aplicada"' | grep -o "$EXEC-p7-[0-9]*" | sort -u | wc -l | tr -d ' ')"
echo "  compras que chegaram ao /flight do AirlinesHub: $CHEGARAM de 10"
confere "B2. no máximo $CB_VOLUME_THRESHOLD das 10 compras chegaram ao AirlinesHub" \
    "$([ "$CHEGARAM" -le "$CB_VOLUME_THRESHOLD" ] && echo 1 || echo 0)" "$CHEGARAM chegaram"
confere "B2. o log do IMDTravel registou cb.open do flight" \
    "$(docker compose logs imdtravel --no-log-prefix --since "$LIMITE_LOG" \
        | grep -q '"event":"cb.open".*"dependency":"flight"' && echo 1 || echo 0)" "sem cb.open"

echo "  -- desliga a falha (só o AirlinesHub; o IMDTravel continua com o breaker aberto)"
docker compose up -d --wait --no-build airlineshub >/dev/null 2>&1
ESPERA=$(( CB_RESET_TIMEOUT_MS / 1000 + 1 ))
echo "  -- espera ${ESPERA}s (CB_RESET_TIMEOUT_MS)"
sleep "$ESPERA"
read -r status ms <<< "$(compra "$EXEC-p7-volta")"
printf '  compra de volta: HTTP %s em %dms  %s\n' "$status" "$ms" "$(resumo_corpo "$EXEC-p7-volta")"
confere "B3. a compra voltou a dar 201 sem intervenção" \
    "$([ "$status" = 201 ] && echo 1 || echo 0)" "HTTP $status"
confere "B3. o breaker do flight fechou sozinho (cb.close no log)" \
    "$(docker compose logs imdtravel --no-log-prefix --since "$LIMITE_LOG" \
        | grep -q '"event":"cb.close".*"dependency":"flight"' && echo 1 || echo 0)" "sem cb.close"

# ------------------------------------------------------------------ resumo

printf '\n== Resumo: %s, %s\n' "$(verde "$PASSOU passaram")" \
    "$([ "$FALHOU" = 0 ] && echo "0 falharam" || vermelho "$FALHOU falharam")"
[ "$FALHOU" = 0 ]
