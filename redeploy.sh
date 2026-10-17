#!/usr/bin/env bash
#
# Redespliega y deja todo apuntando a los contratos nuevos.
#
# El ciclo de STYX es de un solo uso: `Lottery` es inmutable una vez abierta una
# venta, por el invariante 7, y `Enrollment` no vuelve de `Closed` a `Created`.
# Eso es correcto para produccion y un dolor para ensayar, porque cada intento
# exige un despliegue nuevo. Este script reduce ese ciclo a un comando.
#
# Uso:
#   export RPC="https://testnet-rpc.monad.xyz"
#   export STYX_RESOLVER="0x..."
#   ./redeploy.sh
#
# Pide la clave privada por pantalla, asi que no queda en el historial.

set -euo pipefail

RPC="${RPC:-https://testnet-rpc.monad.xyz}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> desplegando en $RPC"
cd "$ROOT/contracts"

# La salida se guarda para extraer las direcciones, y se muestra a la vez.
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT
forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast --interactive | tee "$OUT"

echo
echo "==> escribiendo deployment.json"

extract() {
  # Toma la ultima aparicion, que es la de la seccion de logs.
  grep -oE "^  $1 +0x[0-9a-fA-F]{40}" "$OUT" | tail -1 | grep -oE '0x[0-9a-fA-F]{40}'
}

ENROLLMENT="$(extract Enrollment)"
HEARTBEAT="$(extract HeartbeatRegistry)"
CLUSTERS="$(extract ClusterRegistry)"
LOTTERY="$(extract Lottery)"
TICKETS="$(extract TicketRegistry)"

for pair in "enrollment:$ENROLLMENT" "heartbeatRegistry:$HEARTBEAT" \
            "clusterRegistry:$CLUSTERS" "lottery:$LOTTERY" "ticketRegistry:$TICKETS"; do
  if [ -z "${pair#*:}" ]; then
    echo "ERROR: no se pudo extraer la direccion de ${pair%%:*}" >&2
    exit 1
  fi
done

cat > "$ROOT/deployment.json" <<JSON
{
  "enrollment":        "$ENROLLMENT",
  "heartbeatRegistry": "$HEARTBEAT",
  "lottery":           "$LOTTERY",
  "ticketRegistry":    "$TICKETS",
  "clusterRegistry":   "$CLUSTERS"
}
JSON

echo "==> sincronizando web/.env.local"
cd "$ROOT/web" && npm run --silent sync-deployment

echo
echo "==> comprobando en la cadena"
cd "$ROOT"
SLASHER="$(cast call "$ENROLLMENT" 'slasher()(address)' --rpc-url "$RPC")"
PHASE="$(cast call "$ENROLLMENT" 'phase()(uint8)' --rpc-url "$RPC")"

if [ "${SLASHER,,}" != "${CLUSTERS,,}" ]; then
  echo "ERROR: slasher mal conectado ($SLASHER != $CLUSTERS)" >&2
  exit 1
fi
if [ "$PHASE" != "0" ]; then
  echo "ERROR: Enrollment deberia estar en fase 0 y esta en $PHASE" >&2
  exit 1
fi

echo "  slasher conectado a ClusterRegistry   ok"
echo "  Enrollment en fase 0 (Created)        ok"
echo
echo "listo. Si usas Vercel, actualiza alli las cinco NEXT_PUBLIC_*_ADDRESS"
echo "y redespliega, porque se incrustan en el build."
echo
echo "Siguiente:  cd swarm && npm run swarm -- demo --no-swarm"
