# Enjambre: simulador de adversario y exportador

Dos herramientas para la demo:

- **`attack`** levanta N wallets que atacan la venta como lo haría un operador de
  bots real.
- **`export`** lee la cadena y escribe el dataset que consume el detector,
  cerrando el ciclo sin necesidad de un indexer completo.

Y un tercero que los coordina:

- **`demo`** ejecuta la demo completa de punta a punta con un solo comando, y
  **`check`** verifica que todo esté listo antes de subir al escenario.

El runbook completo está en [DEPLOY.md](../DEPLOY.md).

## Uso

```
npm install

# Direcciones de los contratos desplegados, en la raiz del repo
cat > ../deployment.json <<'JSON'
{
  "enrollment": "0x...",
  "heartbeatRegistry": "0x...",
  "lottery": "0x...",
  "ticketRegistry": "0x...",
  "clusterRegistry": "0x..."
}
JSON

export SWARM_FUNDER_MNEMONIC="..."    # wallet con MON de testnet
export PK="0x..."                     # deployer, para orquestar

# Antes del pitch
npm run swarm -- prefund --size 40
npm run swarm -- check --size 40

# La demo entera
npm run swarm -- demo --size 40

# O solo el ataque, si orquestas a mano
npm run swarm -- attack --size 40

# Variantes
npm run swarm -- attack --size 40 --jitter 6     # retardo aleatorio
npm run swarm -- attack --size 40 --careful      # ESCAPA a la deteccion

# Exportar para el detector
npm run swarm -- export --from 12345
cd ../detector && ./.venv/bin/python -m styx_detector detect \
    --input data/heartbeats.json --out data/report.json
```

## Por qué el adversario simulado es realista

No es un hombre de paja. Las señales que lo delatan no son errores plantados
para que la detección sea fácil: **son lo que compartir infraestructura
realmente produce**, y son exactamente las que desenmascararon al clúster
PaperPhone de 75.000 IPs que cita el README principal.

| Señal | Por qué un operador real la produce |
|---|---|
| Un solo financiador | Fondear 40 wallets desde una cuenta es lo cómodo y lo barato |
| `gasPrice` y `gasLimit` idénticos | Un script, una configuración |
| Calldata byte a byte igual | La misma llamada desde el mismo cliente |
| Latencias correlacionadas | Un solo planificador, un solo reloj |

## Los tres modos, y lo que demuestra cada uno

| Modo | Qué hace el adversario | Qué hace el detector |
|---|---|---|
| normal | Comparte financiador, gas y calldata; responde lo más rápido posible | Ruta `cohesive`: correlación alta, sospecha alta |
| `--jitter N` | Añade retardo aleatorio para descorrelacionar | Cae a la ruta `multi_signal`: la temporización deja de servir, el lote sigue visible, y la sospecha **baja** |
| `--careful` | Aleatoriza también gas, calldata y el fondeo | **Escapa.** Está incluido a propósito |

El modo `--careful` existe para que el límite honesto del sistema se pueda
**demostrar en vivo** en lugar de quedar como una nota al pie. Esa evasión no es
gratuita: exige infraestructura independiente por identidad y una ruta de fondeo
distinta por wallet. La afirmación del proyecto es que cazamos al adversario
económicamente racional, no a uno ilimitado.

## Detalle que evita horas de depuración

El enjambre **no hace polling** de `challengeBlockOf` en cada bloque: a 300 ms
serían más de tres llamadas por segundo y por wallet. Calcula el bloque del reto
localmente, igual que lo hace el contrato:

```
subWindowStart = windowStartBlock + round * subWindowBlocks
h              = blockhash(subWindowStart)          // una lectura por ronda
span           = subWindowBlocks - responseWindowBlocks
challengeBlock = subWindowStart + 1 + (keccak256(h, cohort) % span)
```

Esa igualdad entre TypeScript y Solidity está verificada: `keccak256` de
`encodePacked(['bytes32','uint16'])` en viem coincide con `cast keccak` de
Foundry sobre la misma entrada. **Si divergen, el enjambre responde en el bloque
equivocado y la demo falla en silencio**, así que compruébalo si tocas esa
fórmula.

El mismo cálculo lo necesita el frontend. Está en el prompt del frontend.

## El exportador

Reconstruye el dataset desde datos públicos de la cadena:

- **Latidos**: eventos `Heartbeat` del `HeartbeatRegistry`
- **Gas y calldata**: de la transacción, no del evento
- **Linaje de fondeo**: escaneando transferencias nativas hacia los
  participantes, porque JSON-RPC no tiene índice para eso

Nada de direcciones IP, huellas de dispositivo ni datos personales de ningún
tipo, por el invariante 1.

El escaneo de bloques es barato a escala de demo (unos cientos de bloques). Un
indexer de producción seguiría las transferencias de forma continua en lugar de
escanear a posteriori.

## Variables de entorno

| Variable | Obligatoria | Para qué |
|---|---|---|
| `SWARM_FUNDER_MNEMONIC` | sí, para `attack` | Wallet que fondea el enjambre |
| `MONAD_RPC` | no | Sobreescribe el RPC de `protocol-params.json` |

Las wallets del enjambre se derivan de una mnemónica de prueba pública y fija, de
modo que la demo es reproducible. **No pongas fondos reales en ellas.**
