# Arquitectura

Documento de diseño de STYX. Cubre el modelo de amenaza, el mecanismo de
asignación, el pipeline de detección de coordinación y las decisiones de
ingeniería específicas de Monad.

Lee primero [README.md](./README.md) para el planteamiento del problema.

---

## 1. Modelo de amenaza

### Capacidades del adversario

Asumimos un adversario bien financiado y técnicamente competente, capaz de:

- Crear un número ilimitado de wallets a coste despreciable.
- Desplegar contratos inteligentes, incluidas wallets que agrupan varias
  acciones atómicamente en una sola transacción.
- Alquilar cómputo y memoria en la nube a demanda, sin límite práctico.
- Enrutar tráfico por redes de proxies residenciales, derrotando la reputación
  de IP.
- Falsificar huellas de navegador y dispositivo con navegadores antidetección
  comerciales.
- Comprar resolución humana de CAPTCHA a aproximadamente un dólar por mil.
- Enviar transacciones directamente a cualquier RPC público o a su propio nodo,
  evitando cualquier interfaz que nosotros controlemos.
- **Leer todo nuestro código, incluida la lógica de detección**, porque es
  pública.
- Añadir jitter aleatorio a su temporización para frustrar análisis ingenuos.

### Contra qué defendemos

Acaparamiento coordinado de inventario por un único operador que controla muchas
identidades. Es el ataque económicamente significativo y el que produce el
fallo de mercado observado.

### Contra qué no defendemos, explícitamente

- Un participante automatizado sofisticado que actúe de forma independiente. No
  es distinguible de una persona, y afirmar lo contrario sería falso.
- Humanos pagados por conseguir entradas. Un bot económico derrota toda prueba
  de humanidad, incluido un control físico de identidad en la puerta.
- Un adversario que acepte una cuota proporcional. El capital compra
  participación proporcional; no compra el inventario completo.

### Ley de diseño central

> **Las señales absolutas se pueden satisfacer localmente. Las relativas, no.**

Como el contrato es público, cualquier regla con un umbral fijo es una
especificación de cómo evadirla. Una regla del tipo "el intervalo entre dos
acciones debe superar cinco segundos" se derrota con una línea de código, a
coste cero.

Una señal relativa compara al participante contra la población. El adversario no
puede verificar localmente si la está superando, porque superarla depende del
comportamiento de cien mil participantes que no controla. Por eso el pipeline de
detección se construye sobre correlación entre wallets y comparación de
distribuciones, en lugar de umbrales por wallet, y por eso **publicar el
algoritmo completo no lo rompe**.

Toda señal nueva que se añada a este sistema debe justificarse contra esta ley.

---

## 2. Mecanismo de asignación

Cuatro fases. Cada una retira un recurso distinto al adversario: capital,
concurrencia, velocidad y liquidez.

### Fase 1: Enrolamiento (`Enrollment`)

Ventana abierta de horas o días. El participante deposita un bono reembolsable y
queda enrolado. Llegar temprano no confiere ninguna ventaja, lo que elimina por
construcción el pico de demanda en el instante de apertura.

El bono no es un filtro de bots. Su función es **acotar el número de identidades
que el adversario puede sostener**, que es lo que evita que el sorteo de la
Fase 3 sea trivialmente atacable por sybil. Para un participante honesto el bono
se devuelve, así que el coste real es liquidez temporal. Para el adversario es
capital multiplicado por su número de identidades.

Se aplica una penalización parcial a las identidades que se cualifican y después
se abandonan, lo que impide enrolarse a escala y desaparecer.

### Fase 2: Ventana de cualificación (`HeartbeatRegistry`)

Una ventana de unos veinte minutos que contiene entre seis y diez retos emitidos
en momentos impredecibles.

```
En el bloque N:   reto = keccak256(blockhash(N), eventId, ronda)
Plazo de respuesta: bloque N + k   (k elegido para una ventana de pocos segundos)
```

El reto deriva del hash de un bloque reciente, por lo que no se puede
precomputar. Una respuesta es una transacción firmada y entregada a tiempo. Cada
respuesta válida incrementa el `participationScore` del participante.

El latido es deliberadamente barato de verificar: una firma ECDSA y una
comparación de número de bloque. Los puzzles de cliente costosos se evaluaron y
se descartaron, ver sección 7.

Esta fase produce las series temporales por wallet que analiza la sección 3. **Ese
es su propósito principal.** El coste que impone es secundario y modesto.

### Fase 3: Reparto (`Lottery`)

Al cerrar la ventana de cualificación, los ganadores se seleccionan entre todos
los participantes cualificados usando aleatoriedad verificable, ponderada por
`participationScore` con tope:

```
peso = min(participationScore, TOPE)
```

El tope es deliberado. La participación debe contar, pero el sorteo no debe
convertirse en una subasta que gane quien comande más máquinas.

Aquí no hay carreras de transacciones. La selección ocurre dentro del contrato,
así que la latencia no confiere ventaja, no hay orden que explotar y no hay nada
que front-runear.

`Lottery` es inmutable una vez abierta una venta.

### Fase 4: Emisión y canal oficial (`TicketRegistry`)

Las entradas se emiten como NFT ligados a la identidad que se cualificó.

**La restricción de transferencia por sí sola es insuficiente y no dependemos de
ella.** Un operador puede vender la wallet en lugar del token: la clave privada
cambia de manos, el token nunca se mueve y la restricción nunca se dispara. Con
cuentas vinculadas a token (ERC-6551) o una multifirma, esa venta es atómica y
sin confianza. EIP-7702 permite además que un EOA delegue su ejecución a código
de contrato manteniendo su dirección.

Por tanto el control correcto está en la **redención**, no en la transferencia:

```
Modelo al portador (roto):  entra quien tenga la llave
Modelo de derecho (usado):  entra quien pruebe la identidad ligada
```

La admisión exige una prueba fresca ligada a la identidad fijada en la emisión,
sobre un reto emitido en la puerta, lo que además impide reutilizar pruebas. Una
vez la redención está ligada a identidad, **la transferibilidad de la wallet pasa
a ser irrelevante** en lugar de ser el agujero del diseño.

Medidas de apoyo:

- Exigir custodia EOA en el reclamo y en la redención (`code.length == 0`, sin
  designador de delegación). Se comprueba en la redención, no solo al acuñar,
  porque la delegación se puede añadir después. Esto elimina la vía de venta
  atómica de cuenta y obliga al traspaso de claves a pelo, que conlleva riesgo
  de contraparte en ambos sentidos.
- Ofrecer un canal oficial de devolución estrictamente mejor que una venta en
  mercado gris: instantáneo, garantizado, sin riesgo de contraparte, y con lista
  de espera que reasigna automáticamente. El mercado gris se derrota por calidad
  de producto, no solo por prohibición.

Política opcional por evento, a elección del organizador:

- Nivel de identidad: prueba de unicidad documental mediante un nullifier de
  conocimiento cero. Solo se almacena el nullifier; ningún dato del documento
  sale del dispositivo del usuario y no se escribe ningún dato personal en la
  cadena. Un adversario no puede presentar diez mil documentos reales.
- Transferencia nominativa: una entrada puede cederse a una persona concreta,
  que entonces liga su propia identidad, con un límite de veces. Permite regalar
  evitando que se forme un mercado.

---

## 3. Detección de coordinación

El componente central. Analiza datos que la cadena registra de forma nativa. Sin
direcciones IP, sin huellas TLS, sin huellas de dispositivo, sin telemetría de
edge, sin datos personales.

### Por qué los datos onchain bastan aquí

Participar exige transacciones, y las transacciones quedan registradas
permanentemente con número de bloque y posición dentro del bloque. A diferencia
de una aplicación web, no existe ninguna vía por la que el adversario participe
sin producir el registro.

### Cómo funciona, con números

**Paso 1. La latencia.** Cuando `HeartbeatRegistry` emite un reto en el bloque N,
cada wallet responde en algún bloque posterior:

```
latencia = bloque_respuesta − bloque_reto        (1 bloque = 300 ms)
```

**Paso 2. El vector por wallet.** Con varias rondas, cada wallet no tiene un
número sino una serie temporal:

| | R1 | R2 | R3 | R4 | R5 | R6 |
|---|---|---|---|---|---|---|
| Alice (humana) | 7 | 4 | 12 | 6 | 5 | 9 |
| Bruno (humano) | 5 | 8 | 6 | 15 | 4 | 7 |
| Bot_1 | 2 | 5 | 2 | 3 | 8 | 2 |
| Bot_2 | 2 | 5 | 3 | 3 | 8 | 2 |

**Paso 3. La señal.** En la ronda 5 los dos bots se van a 8 bloques a la vez,
porque la máquina que los orquesta tuvo un pico de carga o el RPC fue lento un
instante. Una causa compartida produce una desviación compartida. Los humanos,
en cambio, tienen sus picos en rondas distintas: causas independientes,
desviaciones independientes.

> El operador no puede esconder que comparte infraestructura, porque la
> **infraestructura compartida produce ruido compartido**.

**Paso 4. Qué mide la correlación.** Y aquí está el punto contraintuitivo: la
correlación **no mide "son rápidos", mide "se mueven juntos"**. El cálculo resta
primero la media de cada wallet, así que el nivel absoluto desaparece:

```
Alice:  media 7,17  →  desviaciones:  −0,2  −3,2  +4,8  −1,2  −2,2  +1,8
Bruno:  media 7,50  →  desviaciones:  −2,5  +0,5  −1,5  +7,5  −3,5  −0,5
                                       signos descoordinados

Bot_1:  media 3,67  →  desviaciones:  −1,7  +1,3  −1,7  −0,7  +4,3  −1,7
Bot_2:  media 3,83  →  desviaciones:  −1,8  +1,2  −0,8  −0,8  +4,2  −1,8
                                       signo idéntico en las seis rondas
```

Correlación de Pearson resultante:

| Par | r |
|---|---|
| Alice ↔ Bruno | −0,18 (ruido, sin relación) |
| Bot_1 ↔ Bot_2 | +0,99 (prácticamente el mismo patrón) |

Que se reste la media es lo que hace la métrica difícil de burlar: **un bot lento
no se salva y un humano rápido no se condena**. Solo se penaliza moverse en
sincronía con otros, que es exactamente lo que no se puede hacer sin
coordinación real.

**Paso 5. Del par al grafo.** Nodo igual a wallet, arista entre i y j si
`r(i,j)` supera un umbral. Los humanos quedan como puntos sueltos casi sin
aristas; las wallets del adversario quedan todas conectadas con todas.

### La trampa estadística: comparaciones múltiples

Con 100.000 wallets hay unos 5.000 millones de pares. Aunque la probabilidad de
que dos series independientes correlacionen por encima del umbral por azar sea
del uno por ciento, eso son decenas de millones de aristas espurias.

Por eso la señal **no es "este par correlaciona"**, sino **un grupo grande donde
todos correlacionan con todos**. Las aristas por azar se distribuyen al azar y no
forman grupos densos; el enjambre forma un cuasi-clique, y la probabilidad de
que diez mil wallets formen un clique por casualidad es esencialmente cero.

**Implicación directa:** no usar componentes conexas. Con decenas de millones de
aristas espurias, el grafo entero se fusiona en un único componente gigante por
percolación y no se detecta nada. Hay que usar **detección de comunidades por
densidad** (Louvain) o **clustering espectral sobre la matriz de correlación**.

**Segunda implicación, útil y gratuita:** más rondas mejoran la separación
drásticamente, porque la probabilidad de correlación espuria cae al aumentar la
longitud de la serie. Emitir más retos no cuesta nada.

### Matriz de features

| Feature | Señal | Relativa |
|---|---|---|
| Vector de latencias por ronda | Temporización de respuesta | sí |
| Media, desviación típica y asimetría | Varianza humana frente a regularidad de máquina | sí |
| Correlación de latencias entre pares | Planificador compartido, la señal del reloj único | sí |
| Tasa de coincidencia en el mismo bloque | Wallets actuando en el mismo tick | sí |
| Linaje de fondeo | Dirección financiadora común | sí |
| Coincidencia exacta de `gasPrice` y `gasLimit` | Valores por defecto de la misma librería | sí |
| Hash de calldata y peculiaridades de codificación ABI | Implementación de cliente compartida | sí |
| Patrón de progresión de nonces | Aprovisionamiento por lotes | sí |
| Intervalo fondeo a enrolamiento | Secuencia de aprovisionamiento automatizado | sí |
| Intervalo publicación a reclamo | Reacción al resultado | sí |

Separación esperada:

| | Latencia media | Varianza | Correlación entre wallets |
|---|---|---|---|
| Participantes independientes | 4 a 8 bloques | alta | baja |
| Enjambre coordinado | 1 a 2 bloques | casi nula | alta |

Nota técnica: una wallet con varianza cero hace indefinida la correlación de
Pearson. Esos casos se marcan directamente por el test de varianza, ya que una
varianza nula a lo largo de ocho rondas es por sí misma anómala.

### Robustez frente al jitter

Un adversario que añada jitter aleatorio por wallet reduce la correlación por
pares. Dos respuestas:

- Si el jitter se genera en infraestructura compartida, la **distribución** sigue
  siendo común entre wallets aunque las series individuales se descorrelacionen.
  Un test de Kolmogorov-Smirnov de dos muestras compara distribuciones en lugar
  de secuencias.
- La entropía de la población detecta ambos modos de fallo. Una población real
  sigue una distribución de cola larga. Un enjambre es o demasiado uniforme o
  uniformemente aleatorio, y la aleatoriedad uniforme es en sí misma anómala
  porque las poblaciones reales no son uniformes.

Añadir jitter también obliga al adversario a alejarse de su tiempo de respuesta
óptimo.

### Pipeline

```
HeartbeatRegistry emite eventos     (wallet, ronda, bloque, posición)
          |
indexer construye la matriz          una fila por wallet
          |
detector calcula similitud y agrupa  Louvain o espectral
          |
ClusterRegistry publica el commit    raíz Merkle + CID del ruleset
          |
ventana de impugnación               cualquiera recomputa y refuta
```

El modelo corre fuera de la cadena y el resultado se publica dentro con una
ventana de impugnación optimista. Es el patrón opML. Ejecutar inferencia dentro
de un contrato no es viable y no se intenta, ver sección 7.

### Por qué aprendizaje no supervisado y no una red neuronal

| | Red neuronal | Clustering no supervisado |
|---|---|---|
| Datos etiquetados | los necesita, y no existen | no los necesita |
| Explicable | no | sí: "estas wallets correlacionan a 0,97" |
| Reproducible por un tercero | difícil | trivial |

La explicabilidad no es opcional: el juego de impugnación exige poder demostrar
**por qué** una wallet entró en un clúster, y que un tercero recompute el
resultado. Una red neuronal rompería esa propiedad, que es precisamente la que
diferencia este sistema del scoring opaco que sustituye.

### Política de aplicación

No negociable:

- Un hallazgo de clúster **reduce el peso en el sorteo y abre una
  impugnación**. Nunca excluye en silencio.
- La vía de apelación es obligatoria y las tasas de exclusión se publican.
- El ruleset y el dataset se publican, se fijan por CID y se comprometen en la
  cadena antes de abrir la venta, de modo que cualquier tercero pueda reproducir
  el resultado.
- Cualquiera puede impugnar una asignación de clúster, o impugnar una wallet,
  depositando un bono y publicando evidencia. El lado perdedor sufre slashing.
  La detección es un mercado con incentivos, no una política privada.

Un score automatizado que deniega acceso conlleva obligaciones bajo el artículo
22 del GDPR, incluidas intervención humana, explicación e impugnación. El diseño
de impugnación y apelación es cómo se cumplen esas obligaciones, y es también lo
que distingue este sistema del scoring opaco al que sustituye.

---

## 4. Diseño específico de Monad

Cifras canónicas, de la documentación de Monad:

| Métrica | Valor |
|---|---|
| Tiempo de bloque | 300 ms |
| Finalidad especulativa | 300 ms, un slot |
| Finalidad | 600 ms, dos slots |
| Caudal | 10.000+ TPS de capacidad de diseño |
| Límite de gas por bloque | 150M gas |
| Caudal de gas | 500M gas/s |
| Límite de gas por transacción | 30M gas |

### Resolución temporal para análisis forense

El pipeline de detección mide latencia de respuesta. El tiempo de bloque fija la
resolución de esa medida.

| Cadena | Bloque | Humano a 2 s frente a script a 50 ms |
|---|---|---|
| Bloques de 12 segundos | 12 s | Mismo bloque, indistinguibles |
| Monad | 300 ms | Unas 40 veces más fino, distinguibles |

En una cadena lenta este análisis no es más débil: es imposible, porque la señal
se pierde en el redondeo del bloque. Es la razón principal por la que el proyecto
apunta a Monad.

### Capacidad

Estimaciones, a sustituir por valores medidos con `forge test --gas-report`.

Asumiendo que un latido directo cuesta unos 45.000 gas (21.000 de base,
calldata, una escritura de almacenamiento, un evento y la verificación):

```
Por bloque:   150M / 45k            = ~3.300 latidos
Por segundo:  3.300 / 0,3 s         = ~11.000 latidos/s

Carga, 100k participantes a un latido cada 12 s:
              100.000 / 12          = ~8.300 latidos/s
Gas:          8.300 x 45k           = ~375M gas/s   = ~75% de la capacidad
```

El 75 por ciento del caudal de gas de la red es viable pero poco considerado y no
deja margen, así que **la vía predeterminada es agregada**. Los participantes
firman atestaciones EIP-712 y relayers sin permisos envían lotes, con las firmas
verificadas en la cadena:

```
Por latido, agregado (ecrecover 3k + almacenamiento 5k + calldata, base amortizada):
              ~9.600 gas
Gas:          8.300 x 9.600         = ~80M gas/s    = ~16% de la capacidad
```

Un relayer puede censurar pero no puede falsificar, y la vía de autoenvío directo
permanece siempre disponible como salvaguarda frente a la censura.

### Ejecución paralela y disposición del estado

Los latidos escriben únicamente en el slot del participante que los envía, lo que
hace las escrituras disjuntas e ideales para la ejecución paralela optimista.

**Un contador global ingenuo destruye esto.** Si cada latido ejecuta
`totalHeartbeats++`, todas las transacciones tocan el mismo slot, todas entran en
conflicto con todas, y el motor recae en reejecución serie. El caudal se desploma
de miles de transacciones por segundo a cientos.

Reglas para cualquier camino de alta frecuencia:

1. Preferido: **no mantener ningún contador global durante la ventana de
   cualificación.** Emitir eventos y derivar los totales fuera de la cadena, o
   calcularlos en el momento del reparto. El número de enrolados ya se conoce al
   cerrar el enrolamiento.
2. Si un contador es inevitable, fragmentarlo y sumar en lectura dentro de una
   función `view`:

```solidity
uint256[256] private totalHeartbeats;
totalHeartbeats[uint8(uint160(msg.sender))] += 1;
```

El número de buckets es un parámetro de ajuste. Súbelo si se mide contención.

### Finalidad sin secuenciador de confianza

El producto es la credibilidad de la afirmación de equidad. Si una sola entidad
ordena las transacciones, la cola es tan justa como esa entidad. MonadBFT alcanza
finalidad determinista en dos slots de 300 ms con un conjunto de validadores
descentralizado, de modo que afirmar que un sorteo fue justo no depende de
confiar en el operador.

### Atribución honesta

| Componente | ¿Necesita Monad? |
|---|---|
| Bono reembolsable | No, cualquier cadena EVM |
| Reparto aleatorio verificable | No, cualquier cadena EVM |
| Redención ligada a identidad | No, cualquier cadena EVM |
| **Detección de coordinación por latencia** | **Sí, necesita bloques sub-segundo para la resolución** |
| **100k participantes concurrentes** | **Sí, necesita unos 10.000 TPS sostenidos** |
| **Equidad bajo ráfaga adversaria** | **Sí, requiere que no se forme subasta de gas** |

Tres de seis componentes necesitan Monad de verdad, y son los tres novedosos.
Exagerar esto daña la credibilidad.

---

## 5. Privacidad y reglas de datos

Restricciones vinculantes, no preferencias.

- **Nunca datos personales en la cadena.** Solo compromisos, nullifiers y
  direcciones pseudónimas. Las Guidelines 02/2025 del EDPB establecen que debe
  evitarse almacenar datos personales en una blockchain cuando choca con los
  principios de protección de datos, y que la imposibilidad técnica no excusa el
  incumplimiento del derecho de supresión. Un ledger inmutable y el derecho de
  supresión del artículo 17 del GDPR son incompatibles por construcción.
- **Nunca datos personales en IPFS.** El contenido fijado en IPFS es público por
  defecto y recuperable por cualquiera que tenga el CID, y los metadatos de la
  DHT son públicos. Cifrarlo no ayuda: un contrato no puede leer texto cifrado,
  y una clave colocada en la cadena es una clave publicada.
- **IPFS se usa solo para artefactos públicos de integridad:** el ruleset
  publicado, el bundle de auditoría, los conjuntos de retos, el dataset usado en
  un hallazgo de clúster y los metadatos de las entradas. Los CIDs se
  comprometen en la cadena antes de abrir una venta, de modo que el ruleset sea
  a prueba de manipulación.
- Las señales fuera de la cadena, si alguna vez se introducen, entran solo como
  atestaciones firmadas `k`-de-`n` que comprometen un hash, nunca valores en
  claro y nunca de un único proveedor.

---

## 6. Mapeo OWASP

| Categoría | Control |
|---|---|
| A09:2025 Logging y alerting | El log onchain es inmutable, público y suficiente para análisis forense, con reglas de alerta publicadas y reproducibles |
| A06:2025 Diseño inseguro | La cola opaca por orden de llegada es la vulnerabilidad; se rediseña el mecanismo en lugar de parchear el síntoma |
| A01:2025 Control de acceso roto | Elegibilidad y propiedad se evalúan en la cadena; no hay IDOR posible sobre un identificador de entrada ni endpoint de confianza que saltar |
| A08:2025 Integridad de datos | El estado de la cola es el estado de la cadena; el organizador no puede reescribir posiciones ni preasignar inventario |
| OAT-005 Scalping | Sorteo en lugar de orden de llegada, más redención ligada a identidad |
| OAT-013 Sniping | No existe el último segundo: ventana amplia y asignación aleatoria |
| OAT-019 Account Creation | Coste por identidad mediante bono |
| OAT-020 Account Aggregation | Detección de coordinación entre wallets, sección 3 |
| OAT-021 Denial of Inventory | Cuota por identidad y coste de capital |

Endurecimiento frente a OWASP Smart Contract Top 10:2026: SC01 control de acceso
con roles explícitos y timelock, SC02 invariantes de lógica de negocio
verificados, SC05 validación de entradas en cada latido, SC08 patrón
checks-effects-interactions con guardas, SC10 inicializadores protegidos y
`Lottery` inmutable.

---

## 7. Enfoques descartados

Documentados para que no se reintroduzcan.

| Enfoque | Motivo del descarte |
|---|---|
| Detección por IP | La EVM nunca ve la IP. Los proxies residenciales evaden la reputación en la gran mayoría de sesiones. Almacenar IPs en la cadena es una infracción permanente de protección de datos. |
| Huella de dispositivo | Se recoge en el cliente, por tanto es autodeclarada y falsificable. Los navegadores antidetección son un producto comercial vendido para derrotar exactamente esto. Las huellas son datos personales. |
| Telemetría de clics o ratón | Los clics no existen en la cadena. Cualquier reporte del cliente sobre interacción humana es falsificable; un contrato no puede verificar que una persona tocó una pantalla. |
| Proof of work por hash | La asimetría va en sentido contrario. Una GPU es cuatro o cinco órdenes de magnitud más rápida que un móvil de gama baja, así que una dificultad calibrada para costar tres segundos al móvil le cuesta al adversario una fracción de milisegundo. Además es regresivo, penaliza a quien tiene hardware más barato, lo que es inaceptable en un producto de equidad. |
| Puzzles memory-hard, clase Argon2 | Las funciones memory-hard son deliberadamente simétricas, así que verificar cuesta lo mismo que resolver. 256 MB no se pueden verificar en la EVM a ningún coste de gas razonable. Una construcción asimétrica tipo Equihash sí sería verificable, pero el coste que impone es de decenas de dólares frente a un premio muy grande, y el gasto de implementación no se justifica. |
| Inferencia de machine learning en la cadena | No es viable. El sobrecoste de prueba de ZKML es superlineal e inviable a tamaños de modelo útiles. Se usa en su lugar el patrón opML: inferencia fuera de la cadena con verificación optimista. |
| Score secreto de riesgo o peligrosidad | Reconstruye el portero opaco que el proyecto existe para sustituir, y entra en territorio de práctica prohibida por perfilado en contextos no relacionados. |
| Límite de compra por wallet como defensa | Las wallets son gratuitas e ilimitadas, así que un límite por wallet no es ningún límite. Se implementa porque es gratis y obliga al adversario a repartirse entre wallets, que es lo que hace posible el clustering, pero nunca se presenta como defensa. |
| Sala de espera virtual | Orden de llegada con otro nombre. La posición en la cola es el premio por el que corre el enjambre. La metáfora visual se conserva en la interfaz; el mecanismo de asignación, no. |
| Umbrales temporales absolutos, por ejemplo "registrado y comprado en menos de N bloques" | Viola la ley de diseño central. La regla es pública, así que se derrota con una línea de espera, y un contrato puede agrupar ambas acciones atómicamente en una sola transacción. Los intervalos temporales se conservan como features relativas en la matriz, nunca como reglas. |

---

## 8. Limitaciones conocidas

1. La resistencia sybil está tarificada, no resuelta. Capital suficiente compra
   una cuota proporcional.
2. La detección de coordinación es probabilística. Los falsos positivos son
   posibles, y por eso los hallazgos modulan el peso y abren una impugnación en
   lugar de excluir.
3. Un adversario sofisticado que ejecute infraestructura genuinamente
   independiente por identidad, con aleatoriedad independiente, eleva el listón
   sustancialmente. Cazamos al adversario económicamente racional, no a uno
   ilimitado.
4. La detección es una carrera armamentística que requiere operación continua. En
   el caso de CrowdSec el operador empezó a rotar direcciones en cuanto se
   aplicaron los bloqueos.
5. El nivel de identidad excluye a participantes sin documento o dispositivo
   adecuado, razón por la cual el nivel de bono debe permanecer siempre
   disponible y la vía sin permisos no se puede eliminar.
6. Una persona puede entregar documento y clave y simplemente no asistir. Es
   imposible de prevenir y es el mismo riesgo residual que tienen hoy las
   entradas en papel con control de identidad.

---

## 9. Fuera de alcance

La protección frente a denegación de servicio del frontend y del RPC es una
preocupación operativa que se resuelve en el edge con limitación de tasa
convencional, y es el único lugar donde un puzzle de cliente barato encaja
legítimamente, etiquetado como limitador de tasa y nunca como defensa anti-bot.
Las pasarelas de pago, la integración con hardware de recinto y el onboarding de
organizadores no se abordan.

## Fuentes

- [Monad: datos canónicos para agentes de IA](https://docs.monad.xyz/ai/current-facts)
- [Monad: how Monad works](https://monad.xyz/blog/how-monad-works)
- [OWASP Top 10:2025](https://owasp.org/Top10/2025/)
- [OWASP Smart Contract Top 10:2026](https://scs.owasp.org/sctop10/)
- [OWASP Automated Threats to Web Applications](https://owasp.org/www-project-automated-threats-to-web-applications/)
- [CrowdSec: un operador, 75.000 IPs, 43 países](https://www.crowdsec.net/blog/the-paperphone-cluster-one-operator-80k-ips-43-countries)
- [EDPB Guidelines 02/2025 sobre blockchain y datos personales](https://www.edpb.europa.eu/documents/guideline/guidelines-022025-on-processing-of-personal-data-through-blockchain_en)
- [IPFS: los datos fijados son públicos por defecto](https://docs.ipfs.tech/quickstart/pin/)
- [ERC-6551 token bound accounts](https://github.com/ethereum/ERCs/blob/master/ERCS/erc-6551.md)
- [EIP-7702 EOA code delegation](https://github.com/ethereum/EIPs/blob/master/EIPS/eip-7702.md)
- [Green et al., USENIX LEET: proof of work por reversión de hash frente a adversarios con GPU](http://www.usenix.org/events/leet11/tech/full_papers/Green.pdf)
- [opML: optimistic machine learning on blockchain](https://arxiv.org/pdf/2401.17555v2)
- [UI UX Pro Max, skill de frontend instalada en este repositorio](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)

El contenido de fuentes externas ha sido reformulado para cumplir con
restricciones de licencia.
