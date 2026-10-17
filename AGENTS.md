# AGENTS.md

Convenciones y restricciones vinculantes para personas y agentes de código que
trabajen en este repositorio.

Lee [README.md](./README.md) para el problema y
[ARCHITECTURE.md](./ARCHITECTURE.md) para el diseño antes de escribir código.
Este archivo es el reglamento operativo, no un resumen de los otros dos.

---

## El proyecto en un párrafo

STYX reparte entradas de eventos de alta demanda mediante una ventana de
cualificación en la cadena seguida de un sorteo verificable, e identifica
enjambres de bots coordinados analizando datos de temporización de transacciones
que la cadena registra de forma nativa. Corre sobre Monad porque los bloques de
300 ms aportan la resolución temporal de la que depende la detección. El
proyecto no afirma detectar bots: detecta coordinación.

---

## Idioma

- **Documentación en español.** Los tres archivos `.md` de la raíz y cualquier
  documento nuevo.
- **Código en inglés.** Identificadores, nombres de funciones, comentarios,
  mensajes de error y nombres de ficheros. Mezclar idiomas dentro del código
  produce bases de código peores.
- **Mensajes de commit:** prefijo en inglés (`feat:`, `fix:`), descripción en
  español.

Solo el nombre del proyecto tiene temática griega. Los contratos y módulos
llevan **nombres descriptivos en inglés**; no reintroduzcas nombres mitológicos
para los componentes.

---

## Stack y estructura

```
contracts/    Solidity, Foundry
indexer/      TypeScript, viem        eventos onchain a matriz de features
detector/     Python                  clustering y estadistica
web/          TypeScript, Next.js     demo y visualizacion del enjambre
```

Python se usa en el detector porque el clustering y el trabajo estadístico
dependen de `networkx`, `scikit-learn` y `scipy`. No lo reimplementes en
TypeScript para reducir el número de lenguajes.

### Contratos

| Contrato | Responsabilidad |
|---|---|
| `Enrollment` | Enrolamiento, bono reembolsable, penalización parcial por abandono |
| `HeartbeatRegistry` | Emisión de retos, verificación de latidos, `participationScore` |
| `Lottery` | Reparto aleatorio verificable con ponderación topada. Inmutable una vez abierta una venta |
| `TicketRegistry` | Emisión de entradas, redención ligada a identidad, canal oficial de devolución |
| `ClusterRegistry` | Compromisos de clúster, juego de impugnación, slashing de bonos |

---

## Comandos

```
# contratos
cd contracts && forge build
cd contracts && forge test -vvv
cd contracts && forge test --gas-report      # obligatorio antes de tocar cifras de capacidad
cd contracts && forge fmt

# indexer
cd indexer && npm install && npm run build && npm test

# detector
cd detector && pip install -r requirements.txt && pytest

# web
cd web && npm install && npm run build
```

No arranques procesos de larga duración como `npm run dev`, modos watch, ni un
nodo local en primer plano. Usa flags de ejecución única.

---

## Configuración de red

Valores canónicos. No hardcodees nada que no esté en esta tabla sin consultar
antes `https://docs.monad.xyz/ai/current-facts`.

| Red | Chain ID | RPC | Explorador |
|---|---|---|---|
| Monad Mainnet | 143 | `https://rpc.monad.xyz` | MonadVision, Monadscan |
| Monad Testnet | 10143 | `https://testnet-rpc.monad.xyz` | MonadVision, Monadscan |

Moneda nativa `MON`. Faucet de testnet `https://faucet.monad.xyz`.

Cifras de rendimiento usadas en la documentación: bloque de 300 ms, finalidad
especulativa de 300 ms, finalidad de 600 ms, límite de 150M gas por bloque, 500M
gas/s, límite de 30M gas por transacción, 10.000+ TPS de capacidad de diseño.

Nunca despliegues a mainnet desde automatización. Solo testnet, salvo que una
persona lo pida explícitamente.

---

## Invariantes de diseño

No son preferencias de estilo. Violar una es una regresión de diseño, y un pull
request que lo haga debe rechazarse aunque los tests pasen.

**1. Nunca datos personales en la cadena ni en IPFS. Jamás.**
Solo compromisos, nullifiers y direcciones pseudónimas. Sin direcciones IP, sin
huellas de dispositivo, sin datos documentales. Cifrar no lo hace aceptable: un
contrato no puede leer texto cifrado, y una clave colocada en la cadena está
publicada.

**2. Prefiere señales relativas a umbrales absolutos.**
Toda la lógica de detección es pública, así que un umbral fijo es una
especificación de cómo evadirla. Una señal nueva debe comparar al participante
contra la población, no contra una constante. Si no puedes expresarla así,
justifica la excepción en el pull request. Ver la ley de diseño central en
ARCHITECTURE.md sección 1.

**3. La detección modula el peso. Nunca excluye en silencio.**
Todo hallazgo de clúster debe reducir el peso en el sorteo y abrir una
impugnación, con vía de apelación y tasas de exclusión publicadas. Ningún camino
de código puede denegar participación basándose solo en un score automatizado.

**4. Ningún slot de almacenamiento caliente en caminos de alta frecuencia.**
Un único contador compartido incrementado por cada latido serializa el bloque
entero bajo ejecución paralela optimista. Prefiere emitir eventos y derivar los
totales fuera de la cadena. Si un contador es inevitable, fragméntalo y suma en
lectura.

**5. La vía sin permisos siempre existe.**
Participar nunca debe requerir pasar por una interfaz, relayer o atestador que
el proyecto controle. Las vías atestadas pueden ofrecer mejores condiciones; no
pueden ser obligatorias.

**6. Ningún tercero de confianza en el camino crítico.**
Donde se necesiten datos externos de verdad, usa atestaciones firmadas
`k`-de-`n` que comprometan un hash. Un relayer puede censurar pero nunca debe
poder falsificar, y el autoenvío debe seguir disponible.

**7. `Lottery` es inmutable una vez abierta una venta.**
Sin proxy, sin ruta de actualización, sin función de administración que pueda
influir en un sorteo. Las funciones privilegiadas en otros contratos van detrás
de un timelock.

**8. Asume que el adversario ha leído este repositorio.**
La seguridad no debe depender de que ningún detalle sea secreto. Si un mecanismo
solo funciona mientras no está documentado, no funciona.

**9. No amplíes las afirmaciones OWASP.**
El mapeo de ARCHITECTURE.md sección 6 es deliberadamente estrecho. No añadas
categorías a la documentación, al material de presentación ni a los textos de la
interfaz sin una justificación técnica concreta ligada a un control específico.

**10. No debilites las secciones de honestidad.**
Las secciones de limitaciones y de enfoques descartados existen para evitar
redescubrir callejones sin salida y para mantener las afirmaciones defendibles.
Amplíalas; no las recortes.

---

## Convenciones de código

### Solidity

- Usa la versión de Solidity fijada en `foundry.toml`. No la dejes flotar.
- Errores personalizados, no cadenas de revert.
- Primero comprobaciones, después efectos, después interacciones. Guardas de
  reentrada en los caminos de reclamo, reembolso y slashing.
- Valida toda entrada: índice de ronda, plazo, fase, firma, llamante.
- Máquina de estados de fases explícita. Sin transiciones implícitas guiadas solo
  por timestamps.
- EIP-712 para todo payload firmado, con separador de dominio que incluya chain
  ID y dirección del contrato. Nonces o anclaje a bloque en cualquier cosa
  reproducible.
- Nunca uses `block.timestamp` donde la unidad correcta sea el número de bloque.
  La latencia de los latidos se mide en bloques.
- `immutable` y `constant` siempre que sea posible; el coste de almacenamiento
  importa a este volumen de transacciones.
- Emite un evento por cada cambio de estado que necesiten el indexer o el
  detector. El esquema de eventos es una interfaz pública: cambiarlo es un cambio
  rompedor.

### TypeScript

- Modo estricto. Sin `any`. `viem` para acceso a la cadena, no `ethers`.
- El indexer debe ser determinista y reanudable: dado el mismo rango de bloques
  produce la misma matriz de features.

### Python

- Type hints en funciones públicas. `ruff` para linting, `black` para formato.
- El detector debe ser reproducible: semillas aleatorias fijas, versiones de
  dependencias pinneadas y fichero de ruleset versionado. Un tercero debe poder
  reejecutarlo sobre el dataset publicado y obtener la asignación de clúster
  idéntica. Es un requisito de correctitud, no un detalle, porque la
  reproducibilidad es lo que verifica el juego de impugnación.
- No uses componentes conexas para agrupar. Con millones de aristas espurias el
  grafo se fusiona por percolación. Usa Louvain o clustering espectral. Ver
  ARCHITECTURE.md sección 3.

---

## Requisitos de testing

- Todo contrato necesita tests unitarios del camino feliz, de cada condición de
  revert y del comportamiento en los límites de fase.
- Fuzzea el reparto: para cualquier conjunto de participantes y cualquier
  aleatoriedad, verifica `entradas_emitidas <= inventario` y como máximo una
  asignación por identidad cualificada.
- **Testea al adversario explícitamente.** Una suite que solo demuestra que los
  participantes honestos tienen éxito está incompleta. Incluye una simulación de
  enjambre y verifica que el detector lo agrupa, incluida una variante con
  jitter.
- Ejecuta `forge test --gas-report` y actualiza ARCHITECTURE.md sección 4 cuando
  cambie el coste de gas del latido. Las cifras de capacidad de ahí son
  estimaciones marcadas para sustituir por valores medidos.

---

## No construir

Descartados con razonamiento en ARCHITECTURE.md sección 7. No reintroduzcas:

Recogida de IP o geolocalización. Huella de dispositivo o navegador. Telemetría
de clics, ratón o teclado. Puzzles de cliente por hash o memory-hard como
defensa anti-bot. Inferencia de machine learning dentro de un contrato.
Cualquier score secreto de riesgo o peligrosidad. Umbrales temporales absolutos
como reglas. Sala de espera virtual como mecanismo de asignación. Almacenamiento
de datos personales de ningún tipo, en ningún sitio.

Un puzzle de cliente es aceptable en exactamente un lugar: limitación de tasa en
el edge para mantener disponibles el proxy RPC y el frontend durante un pico de
demanda, etiquetado como limitador de tasa y nunca presentado como defensa
anti-bot.

---

## Afirmaciones factuales

La credibilidad de este proyecto depende de que sus números sean correctos.

- Cifras de red y rendimiento de Monad: verifica contra
  `https://docs.monad.xyz/ai/current-facts`, que explícitamente prevalece sobre
  entradas de blog antiguas y sobre la memoria del modelo.
- Nombres y numeración de categorías OWASP: el Top 10 web es la edición **2025**
  y el Smart Contract Top 10 es la edición **2026**. Los nombres de categoría
  cambiaron entre ediciones; compruébalo antes de citar.
- Cifras de gas y capacidad: mide con `forge test --gas-report`. No propagues una
  estimación como si fuera una medición.
- Cita una fuente para toda afirmación externa, y parafrasea en lugar de citar
  literalmente.

Si no puedes verificar un número, escribe que no está verificado en lugar de
presentar un valor plausible.

---

## Skill de frontend

`.kiro/steering/ui-ux-pro-max/` contiene la skill UI UX Pro Max (licencia MIT),
con datasets de diseño para Next.js, React, shadcn, Tailwind y otros stacks. Está
versionada en el repositorio para que todo el equipo trabaje con la misma guía
sin pasos de instalación.

Se regenera con:

```
npx ui-ux-pro-max-cli init --ai kiro
```

Son unos 170 ficheros y 4,5 MB de datos de terceros. No edites su contenido a
mano: se sobrescribe al regenerar. Si prefieres no versionarla, añade
`.kiro/steering/ui-ux-pro-max/` al `.gitignore` y documenta el comando como paso
de instalación obligatorio.

---

## Commits y pull requests

- Prefijos de commit convencionales: `feat:`, `fix:`, `docs:`, `test:`,
  `refactor:`, `chore:`. Ámbito por paquete, por ejemplo
  `feat(contracts): ...`.
- Modo imperativo, presente, sin punto final.
- Nunca commitees a `main`. Crea una rama y abre un pull request.
- Un pull request que toque lógica de detección debe indicar qué invariante de
  diseño rige el cambio y, si añade una señal nueva, si es relativa o absoluta y
  por qué.
- Nunca commitees secretos, claves privadas ni ficheros `.env`. Las claves de
  despliegue vienen del entorno.
- Sin emojis en código, comentarios, documentación ni mensajes de commit.
