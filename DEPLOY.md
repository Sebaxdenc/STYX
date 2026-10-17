# Despliegue y ensayo de la demo

Runbook para dejar STYX corriendo en la testnet de Monad y ejecutar la demo de 90
segundos. Pensado para seguirlo con prisa, así que los pasos van en orden y con
los comandos exactos.

---

## ¿Hace falta Alchemy? Sí

Los endpoints públicos están **limitados a 15-25 peticiones por segundo y
compartidos con todo el mundo**. Haz la cuenta de lo que pide la demo:

```
40 wallets del enjambre esperando su recibo, cada una consultando ~1 vez/s
+ el frontend de cada humano suscrito a bloques
+ el exportador leyendo bloques
= muy por encima de 25 rps
```

El síntoma de agotar el límite es el peor posible para un escenario:
**transacciones y lecturas rechazadas de forma aparentemente aleatoria**. Parece
que tu código falla cuando lo que falla es el RPC.

Coge una clave gratis de **Alchemy** o **QuickNode**. Formato de Alchemy para
Monad:

```
https://monad-testnet.g.alchemy.com/v2/TU_CLAVE
wss://monad-testnet.g.alchemy.com/v2/TU_CLAVE
```

No necesitas nada más: ni base de datos, ni servidor, ni servicio de pinning. El
arte de las entradas es SVG generado en la cadena y el detector corre en local.

---

## 1. Requisitos

```bash
# Comprueba que tienes el toolchain
forge --version        # Foundry
node -v                # 20 o superior
python3 -V             # 3.11 o superior
```

Si falta Foundry: `curl -L https://foundry.paradigm.xyz | bash && foundryup`

### Cuentas y fondos

Necesitas **dos** wallets separadas:

| Wallet | Para qué | Fondos aproximados |
|---|---|---|
| **Deployer** | Desplegar y orquestar la demo | ~1 MON |
| **Funder del enjambre** | Fondear las wallets de los bots | 0,2 MON x nº de bots |

Con 40 bots el funder necesita **8 MON**. Si el faucet no da para tanto, baja el
tamaño: `--size 15` son 3 MON y la demo funciona igual.

Faucet: `https://faucet.monad.xyz`

> Mantén las dos wallets separadas. Si el deployer se queda sin fondos a mitad
> del ensayo no puedes orquestar nada, y el enjambre consume mucho más.

---

## 2. Preparar el entorno

```bash
git clone https://github.com/Sebaxdenc/STYX.git
cd STYX

# Variables. Ponlas en un fichero que NO se commitea.
cat > .env.local <<'EOF'
export RPC="https://monad-testnet.g.alchemy.com/v2/TU_CLAVE"
export MONAD_RPC="$RPC"
export PK="0x...clave privada del deployer..."
export SWARM_FUNDER_MNEMONIC="doce palabras del funder del enjambre"
export STYX_RESOLVER="0x...direccion que resuelve apelaciones..."
EOF
source .env.local
```

`STYX_RESOLVER` **no debe ser el deployer**. Es el único componente de confianza
del sistema y está declarado como limitación 7 en `ARCHITECTURE.md`; para la
demo basta otra wallet vuestra, pero que sea distinta.

```bash
# Contratos
cd contracts && forge build && forge test && cd ..

# Detector
cd detector && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
./.venv/bin/python -m pytest -q && cd ..

# Enjambre
cd swarm && npm install && npx tsc --noEmit && cd ..
```

Si los tests pasan, el repo está sano. **Hazlo la noche antes, no media hora
antes.**

---

## 3. Desplegar

```bash
cd contracts
forge script script/Deploy.s.sol \
  --rpc-url $RPC \
  --private-key $PK \
  --broadcast
```

Imprime las seis direcciones. Pásalas a `deployment.json` en la raíz del repo:

```bash
cd ..
cat > deployment.json <<'JSON'
{
  "enrollment":        "0x...",
  "heartbeatRegistry": "0x...",
  "lottery":           "0x...",
  "ticketRegistry":    "0x..."
}
JSON
```

Guarda también las que no van en ese fichero, que las necesitarás a mano:

```bash
export ENROLLMENT=0x...
export HEARTBEATS=0x...
export LOTTERY=0x...
export TICKETS=0x...
export CLUSTERS=0x...
```

Verifica que el despliegue quedó bien conectado:

```bash
# El slasher debe ser ClusterRegistry, nadie mas puede penalizar bonos
cast call $ENROLLMENT "slasher()(address)" --rpc-url $RPC
# Parametros cargados desde protocol-params.json
cast call $HEARTBEATS "challengeCount()(uint8)" --rpc-url $RPC   # 5
cast call $LOTTERY    "inventory()(uint256)"    --rpc-url $RPC   # 10
```

---

## 4. Antes del pitch: prefondear el enjambre

**Este paso es obligatorio y va antes de subir al escenario.**

```bash
cd swarm
npm run swarm -- prefund --size 40
```

El fondeo son 40 transacciones secuenciales desde una sola cuenta: tarda del
orden de un minuto y **no cabe dentro de los 25 segundos de enrolamiento**. Una
vez prefondeadas, `attack` las salta y arranca al instante.

---

## 5. La demo, paso a paso

Ten tres terminales abiertas y las variables cargadas en las tres.

### T-0 · Abrir enrolamiento

```bash
# Terminal 1
cast send $ENROLLMENT "openEnrollment()" --private-key $PK --rpc-url $RPC
export START_BLOCK=$(cast block-number --rpc-url $RPC)   # guardalo, lo pide el exportador
```

Ahora se enrolan **los humanos** (vosotros y quien escanee el QR) y el enjambre:

```bash
# Terminal 2
cd swarm && npm run swarm -- attack --size 40
```

El script se enrola y se queda esperando la ventana de cualificación.

### T+25s · Cerrar enrolamiento y abrir cualificación

```bash
# Terminal 1
cast send $ENROLLMENT "closeEnrollment()"      --private-key $PK --rpc-url $RPC
cast send $HEARTBEATS "openQualification()"    --private-key $PK --rpc-url $RPC
```

El enjambre detecta la apertura y responde a los 5 retos automáticamente.
Vosotros respondéis desde el frontend, un toque por reto.

### T+70s · Sorteo

```bash
# Terminal 1
cast send $LOTTERY "requestSeed()"  --private-key $PK --rpc-url $RPC
sleep 3                                    # SEED_DELAY_BLOCKS = 4 bloques
cast send $LOTTERY "finalizeSeed()" --private-key $PK --rpc-url $RPC
```

`finalizeSeed` abre la primera ronda. Los humanos reclaman desde el frontend y
el enjambre reclama solo. Las entradas se acuñan **provisionales** y ya se ven en
las wallets.

### T+85s · Detectar y revocar

```bash
# Terminal 3
cd swarm && npm run swarm -- export --from $START_BLOCK

cd ../detector
./.venv/bin/python -m styx_detector detect \
    --input data/heartbeats.json --out data/report.json
```

El informe trae la raíz Merkle y **las pruebas de cada wallet marcada**.
Compromételo y revoca:

```bash
cd ..
export ROOT=$(python3 -c "import json;print(json.load(open('detector/data/report.json'))['merkle_root'])")

cast send $CLUSTERS "commitFinding(bytes32,string,string)" \
  $ROOT "ipfs://ruleset" "ipfs://dataset" --private-key $PK --rpc-url $RPC

# Marcar y revocar cada wallet del cluster
python3 - <<'PY' > revoke.sh
import json, os
r = json.load(open('detector/data/report.json'))
for w, e in r['proofs'].items():
    proof = '[' + ','.join(e['proof']) + ']'
    print(f'cast send $CLUSTERS "markFlagged(address,uint256,bytes32[])" {w} {e["clusterId"]} "{proof}" --private-key $PK --rpc-url $RPC')
    print(f'cast send $TICKETS "revoke(address)" {w} --private-key $PK --rpc-url $RPC')
PY
bash revoke.sh
```

En pantalla: las entradas del enjambre pasan a **REVOCADA**, su arte se
desatura y se tacha. Las vuestras siguen vivas.

---

## 6. Qué decir mientras corre

Lo que el jurado tiene que entender en esos 90 segundos:

1. **No hay carrera.** El enrolamiento dura lo que dura; llegar primero no sirve.
2. **El enjambre también gana entradas.** Eso **no es un fallo de la demo, es la
   tesis**: en tiempo real hay segundos de datos y no se detecta nada.
3. **En retrospectiva está el patrón completo**, y por eso la entrada es
   provisional: es lo que convierte el análisis en una consecuencia ejecutable.
4. **No detectamos bots, detectamos coordinación.** Y la coordinación es mucho
   más difícil de disimular, porque el adversario tiene que ser creíble cuarenta
   veces y además creíble en conjunto.

Si alguien pregunta por el límite, ensáyalo en lugar de esquivarlo:

```bash
npm run swarm -- attack --size 40 --careful    # este ESCAPA, a proposito
```

---

## 7. Cuando algo falle

| Síntoma | Causa | Qué hacer |
|---|---|---|
| Transacciones rechazadas al azar | Rate limit del RPC público | Usa el RPC dedicado. Es la causa más probable de todo |
| `-32614: eth_getLogs is limited to a 100 range` | Rango de logs mayor de 100 bloques | El exportador ya lo trocea. Si sale, es código nuevo |
| Bots sin gas a mitad del ataque | Fondeo escaso | `--fund 0.3`. El reserve balance de Monad limita las ráfagas según el saldo |
| `EnrollmentWindowOver` en el enjambre | No prefondeaste | Paso 4. El fondeo no cabe en la ventana |
| `SeedExpired` | Pasaron 200 bloques desde `requestSeed` | `reRequestSeed()` y vuelve a `finalizeSeed()` |
| `ChallengeUnverifiable` | La sub-ventana aún no empezó | Espera. El reto deriva de un bloque que todavía no existe |
| El detector no marca nada | `minClusterSize` mayor que el enjambre | Está en 5. Con `--size 40` sobra |
| `revoke` revierte con `DisputeWindowOver` | Pasaron los 20 s | Sube `dispute.windowSeconds` para el ensayo |

### Reiniciar el ensayo

Los contratos no se reinician: `Lottery` es inmutable una vez abierta una venta,
a propósito. Para otra pasada, **vuelve a desplegar** (paso 3) y actualiza
`deployment.json`. Es rápido y deja el ensayo limpio.

---

## 8. Lo que no hay que hacer

- **No despliegues a mainnet.** Nada de esto está auditado.
- **No pongas fondos reales en las wallets del enjambre**: se derivan de una
  mnemónica de prueba pública y fija para que la demo sea reproducible.
- **No commitees `.env.local` ni `deployment.json`.** Ya están en `.gitignore`.
- **No presentes `DemoIdentityVerifier` como verificación de identidad real.**
  Está etiquetado en el código como no sonoro y no privado, y existe para que el
  flujo corra de punta a punta.
