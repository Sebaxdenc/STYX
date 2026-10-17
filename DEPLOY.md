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
  "ticketRegistry":    "0x...",
  "clusterRegistry":   "0x..."
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

## 5. Comprobación previa

**Esto va antes de subir al escenario, no después.**

```bash
cd swarm
npm run swarm -- check --size 40
```

Verifica, en este orden: que el RPC responde, que los cinco contratos tienen
código, que `Enrollment` sigue en fase `Created` (si no, hay que volver a
desplegar para un ensayo limpio), que el deployer tiene saldo, que **las wallets
del enjambre están prefondeadas**, que existe el venv del detector, y que el
ciclo cabe en el tiempo del pitch.

Si sale `todo listo`, estás listo. Si no, te dice exactamente qué falta.

---

## 6. La demo, con un solo comando

```bash
cd swarm
npm run swarm -- demo --size 40
```

Eso es todo. El orquestador ejecuta las cuatro fases, lanza el enjambre en el
momento correcto, corre el detector, compromete el hallazgo, revoca las entradas
del enjambre e imprime el resultado.

**Cada fase espera por estado de la cadena, no por reloj.** Lee `closesAt`,
`windowEndBlock` y `seedBlock` de los contratos y actúa cuando la condición se
cumple de verdad. Si la red tiene un hipo, la demo va **tarde en lugar de ir
mal**, que es lo que importa cuando no puedes repetir un `cast` mal escrito
delante de un jurado.

Lo que verás:

```
[T+0.0s] === FASE 1: abrir enrolamiento ===
  enrolamiento abierto. bloque inicial 71913265
  los humanos ya pueden entrar desde el frontend o el QR
[T+26.3s] === FASE 2: cerrar enrolamiento y abrir cualificacion ===
  62 participantes enrolados
  5 retos en instantes impredecibles
[T+73.1s] === FASE 3: sorteo ===
  semilla fijada desde el hash de un bloque futuro. el sorteo ya esta decidido
  reclamar es recoger, no competir: llegar tarde no quita nada
[T+94.8s] === FASE 4: deteccion y revocacion ===
  el detector agrupo 40 wallets
  hallazgo comprometido. raiz 0x...
  marcadas 40, entradas revocadas 7

=============== RESULTADO ===============
entradas emitidas          10
  conseguidas por el enjambre 7
  revocadas al enjambre       7
  en manos de personas        3
entradas vivas             3
=========================================
```

Esa última tabla es el cierre del pitch: **el enjambre se llevó 7 de 10 entradas
y acabó con cero**.

### Variantes para el Q&A

```bash
npm run swarm -- demo --size 40 --jitter 6     # el adversario descorrelaciona
npm run swarm -- demo --size 40 --careful      # este ESCAPA, a proposito
npm run swarm -- demo --no-swarm               # solo humanos, sin enjambre
```

### Si prefieres control manual

El orquestador no es obligatorio. Las fases a mano:

```bash
cast send $ENROLLMENT "openEnrollment()"    --private-key $PK --rpc-url $RPC
cast send $ENROLLMENT "closeEnrollment()"   --private-key $PK --rpc-url $RPC
cast send $HEARTBEATS "openQualification()" --private-key $PK --rpc-url $RPC
cast send $LOTTERY    "requestSeed()"       --private-key $PK --rpc-url $RPC
cast send $LOTTERY    "finalizeSeed()"      --private-key $PK --rpc-url $RPC
```

Y el enjambre por separado con `npm run swarm -- attack --size 40`. Útil para
ensayar, arriesgado en vivo.

---

## 7. Qué decir mientras corre

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

## 8. Cuando algo falle

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
| `check` dice que `Enrollment` no está en fase `Created` | Ya corriste un ensayo | Vuelve a desplegar. `Lottery` es inmutable a propósito |
| `check` dice que faltan wallets prefondeadas | Te saltaste el paso 4 | `npm run swarm -- prefund --size 40` |
| `demo` se queda esperando una fase | El orquestador espera por estado de cadena | Es lo correcto: va tarde en lugar de ir mal. Mira el bloque que imprime |

### Reiniciar el ensayo

Los contratos no se reinician: `Lottery` es inmutable una vez abierta una venta,
a propósito. Para otra pasada, **vuelve a desplegar** (paso 3) y actualiza
`deployment.json`. Es rápido y deja el ensayo limpio.

---

## 9. Lo que no hay que hacer

- **No despliegues a mainnet.** Nada de esto está auditado.
- **No pongas fondos reales en las wallets del enjambre**: se derivan de una
  mnemónica de prueba pública y fija para que la demo sea reproducible.
- **No commitees `.env.local` ni `deployment.json`.** Ya están en `.gitignore`.
- **No presentes `DemoIdentityVerifier` como verificación de identidad real.**
  Está etiquetado en el código como no sonoro y no privado, y existe para que el
  flujo corra de punta a punta.
