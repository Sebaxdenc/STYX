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

Parámetros canónicos en `protocol-params.json`. Valores vigentes:

| Parámetro | Valor | Motivo |
|---|---|---|
| Duración de la ventana | 5 minutos (1.000 bloques) | Presencia exigible sin ser abusiva |
| Número de retos | 10 | Lo que importa estadísticamente es el número de muestras, no la duración |
| Intervalo medio entre retos | ~30 s (100 bloques), aleatorizado | Impredecible: impide programar un cron y dormir el resto |
| Ventana de respuesta | ~10 s (33 bloques) | Ancha a propósito, ver abajo |
| Respuestas mínimas para cualificar | 6 de 10 | Tolera fallos de red y notificaciones perdidas |
| Interacción | un toque, no un puzzle | La interacción humana es obligatoria |

```
En el bloque N:   reto = keccak256(blockhash(N), eventId, ronda)
Plazo de respuesta: bloque N + 33   (~10 s)
```

El reto deriva del hash de un bloque reciente, por lo que no se puede
precomputar. Una respuesta es una transacción firmada y entregada a tiempo. Cada
respuesta válida incrementa el `participationScore`.

El participante conoce la ventana (de 19:00 a 19:05) pero **no los instantes
exactos de los retos dentro de ella**. Si fueran horas fijas, el script del
adversario programaría un cron para esos momentos y dormiría el resto, a coste
cero. Al ser impredecibles, su infraestructura debe estar provisionada y atenta
durante los cinco minutos completos.

**Por qué la ventana de respuesta es ancha.** Una ventana de 3 segundos
**censuraría** a los humanos que tardan más, perdiendo la cola de la
distribución, que es precisamente la señal que se quiere medir. Diez segundos
capturan la distribución humana completa. Una ventana estrecha solo tenía
sentido para el argumento anti-granja de CAPTCHA, que se degradó al pasar la
tesis del proyecto al análisis de coordinación.

**Por qué un toque y no un puzzle.** La interacción humana es un requisito, no
una preferencia de experiencia de usuario: si el cliente responde
automáticamente, la latencia mide el portátil y la conexión del usuario en lugar
de su reacción, y la señal de varianza desaparece. Pero el esfuerzo debe ser
nulo: una notificación y un toque, sin nada que resolver. Ver sección 7.

**Cohortes.** A escala de demo (~200 participantes) `cohortCount` es **1**, y eso
es mejor en los dos ejes: 200 respuestas en 10 segundos son 20 TPS, así que
repartir la carga no hace falta, y con una sola cohorte **todos reciben el mismo
bloque de reto**, sus latencias son directamente comparables y la señal de
correlación sale más limpia.

A escala de producción los participantes se reparten en 20 cohortes asignadas por
hash de dirección, de modo que el adversario no puede elegir ni concentrarse en una. Los
retos están sincronizados dentro de cada cohorte y desfasados entre cohortes, lo
que suaviza la carga de la red y preserva la señal de correlación, que requiere
que los miembros comparados actúen simultáneamente. La correlación se calcula
dentro de cada cohorte. Un enjambre de 10.000 wallets queda repartido a unas 500
por cohorte, y 500 wallets mutuamente correlacionadas sigue siendo una señal
abrumadora.

El latido es deliberadamente barato de verificar: una firma ECDSA y una
comparación de número de bloque. Los puzzles de cliente costosos se evaluaron y
se descartaron, ver sección 7.

Esta fase produce las series temporales por wallet que analiza la sección 3.
**Ese es su propósito principal.** El coste que impone es secundario y modesto.

### Etapas de propiedad y línea de tiempo

Pregunta frecuente: ¿en qué momento exacto una entrada es de alguien? La
propiedad es **escalonada**, y la etapa provisional es deliberada.

```
LUNES 12:00      Se abre el enrolamiento (48 h, sin carrera)
MIERCOLES 12:00  Se cierra. 110.000 enrolados para 10.000 entradas
JUEVES 19:00     Se abre la ventana de cualificacion
                   19:00:17  reto 1   -> responder antes de 19:00:27
                   19:00:54  reto 2
                   19:01:31  reto 3   (10 retos, instantes impredecibles)
                      ...
JUEVES 19:05     Se cierra. El sorteo corre en segundos
JUEVES 19:05     -> ventana de impugnacion (48 h) + reclamo en paralelo
SABADO 19:05     Las entradas pasan a definitivas
15 DE MARZO      Puerta del recinto: redencion
```

| Etapa | Momento | Qué se posee |
|---|---|---|
| 1. Enrolado | Lunes | Nada. Solo un bono depositado |
| 2. Cualificado | Jueves 19:05 | Nada. Un `participationScore` |
| 3. Seleccionado | Jueves 19:05 | Un **derecho a reclamar**, no una entrada |
| 4. Reclamado | Al pagar | El NFT, pero **provisional** |
| 5. Definitivo | Al cerrar la impugnación | La entrada, firme |
| 6. Redimido | En la puerta | Acceso consumido |

**Línea de tiempo de la demo.** El pitch dura tres minutos y la demo ocupa uno o
dos, así que los mismos pasos corren comprimidos. Los valores están en
`protocol-params.json` y hay un test, `test_demoFitsInsideThePitch`, que falla si
alguien sube una ventana y rompe el encaje.

```
0:00-0:25  Enrolamiento abierto. El equipo entra, y el publico que
           escanee el QR tambien. 25 s, sin carrera: llegar primero
           no da ventaja igual que en produccion.
0:25-1:10  Cualificacion: 5 retos, uno cada ~9 s, 6 s para responder
           cada uno. Un toque por reto.
1:10-1:22  Semilla, sorteo y reclamo. El enjambre tambien gana
           entradas: a estas alturas nada lo ha filtrado todavia.
1:22-1:42  El detector corre (30 ms), se compromete el hallazgo, y las
           entradas del enjambre se REVOCAN en pantalla. Las de las
           personas pasan a definitivas.
```

Que el enjambre gane primero y sea revocado después **no es un defecto de la
demo, es la tesis**: en tiempo real hay segundos de datos y no se detecta nada;
en retrospectiva está el patrón completo. La etapa provisional es lo que
convierte ese análisis en una consecuencia ejecutable.

El salto crítico es de 3 a 5. En el sorteo el contrato **no acuña nada**:
registra que esas direcciones tienen derecho a una entrada. El NFT emitido en la
etapa 4 es provisional mientras la ventana de impugnación esté abierta, con las
transferencias bloqueadas.

**Esto es lo que hace ejecutable el análisis retrospectivo.** En tiempo real hay
segundos de datos y no se detecta nada; en retrospectiva está el patrón completo.
Si la propiedad fuese definitiva en el instante del sorteo, el hallazgo de un
clúster sería un informe sin consecuencias. Al ser provisional, las entradas del
enjambre se revocan, su bono sufre slashing y esas entradas pasan a un segundo
sorteo entre quienes no ganaron.

La revocación aquí funciona de verdad, a diferencia de una devolución de cargo:
la entrada es un derecho que se valida en la puerta, así que si el contrato la
invalidó antes del evento, simplemente no sirve. Una revocación errónea reembolsa
el precio íntegro y mantiene abierta la vía de apelación.

Coste honesto: la provisionalidad es mala experiencia de usuario. El dial es la
duración de la ventana de impugnación, que intercambia comodidad por calidad de
detección. El mensaje al usuario debe ser explícito: "Has obtenido una entrada.
Queda confirmada en 48 horas."

### Fase 3: Reparto (`Lottery`)

**Por qué un umbral por participante y no una selección de ganadores.** El
diseño obvio, ordenar a los participantes por un rango aleatorio y tomar los
primeros `inventario`, **no se puede ejecutar en la cadena**: iterar sobre cien
mil participantes no cabe en ningún bloque. Calcular el conjunto fuera y
comprometer una raíz funcionaría, pero demostrar igualdad de conjuntos en una
impugnación es difícil, y cualquier recurso de "gana quien reclame primero"
reintroduce exactamente la carrera de latencia que el proyecto existe para
eliminar.

Así que el resultado de cada participante es **independiente** y queda fijado por
la semilla:

```
peso = min(participationScore, TOPE) x multiplicador_de_cluster
u    = keccak256(semilla, ronda, participante)
gana = u < limite(peso)
```

Reclamar es **recoger, no competir**. Ser rápido no aporta nada, ser lento no
quita nada, y cualquiera puede recomputar el resultado de cualquier participante
a partir de datos públicos.

El tope es deliberado: la participación debe contar, pero el sorteo no debe
convertirse en una subasta que gane quien comande más máquinas.

**Por qué varias rondas.** Al ser sorteos independientes, el número de ganadores
es una variable binomial y una sola ronda no puede acertar el inventario exacto.
Cada ronda apunta a una fracción conservadora de lo que queda (90 por ciento) y
la siguiente absorbe el faltante. **La sub-asignación es la dirección segura**:
solo implica otra ronda. La sobre-asignación no lo es, así que además está
bloqueada por un tope duro.

La tasa de cada ronda se **deriva del estado de la cadena** mediante código
inmutable. No hay ninguna entrada de administración en el sorteo, por el
invariante 7, y la tasa usada en cada ronda se guarda para que cualquier ronda
pasada siga siendo recomputable.

La semilla se ancla al hash de un bloque futuro, con `requestSeed` llamable por
cualquiera, de modo que nadie puede conocerla mientras decide si participar.

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

**Revocación.** Mientras la ventana de impugnación está abierta, la entrada es
provisional y **cualquiera** puede revocar la de un titular marcado en un
hallazgo comprometido, por el mismo motivo que marcar es permissionless: la
aplicación no debe depender de que el operador se moleste. El precio se reembolsa
íntegro, porque una revocación pone precio a la coordinación en lugar de
confiscar dinero, y la apelación sigue abierta.

Al revocar se **libera el nullifier**, de modo que una persona honesta mal
atrapada en un clúster pueda reemitir su entrada tras ganar la apelación. Y una
entrada marcada **no se puede convertir en definitiva**: hay que levantar el
hallazgo primero, que es lo que mantiene la exclusión no silenciosa.

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
varianza nula a lo largo de diez rondas es por sí misma anómala.

### Las cuatro rutas de detección

Esta estructura no es un diseño previo: cada ruta se añadió porque al medir la
anterior aparecio un punto ciego concreto.

| Ruta | Qué captura | Punto ciego que cubre |
|---|---|---|
| `identical` | Latencia constante e idéntica | La varianza cero hace **indefinida** la correlación de Pearson. Sin esta ruta el enjambre más obvio de todos pasa desapercibido |
| `cohesive` | Grupos con señal exacta compartida cuyas desviaciones comparten un factor latente | La correlación por pares se desmorona con jitter |
| `multi_signal` | Grupos que comparten tres o más señales exactas | Con jitter alto la temporización deja de servir, pero el lote sigue visible |
| `correlated` | Grafo de correlación por pares con comunidades Louvain | Enjambres apretados con coincidencia de señales solo parcial |

### El jitter rompe la correlación por pares, y la cohesión de grupo lo arregla

Este fue el hallazgo al implementar. Si el adversario añade jitter, la
correlación entre dos de sus wallets cae a

```
var_compartida / (var_compartida + var_jitter)
```

que con jitter moderado baja de 0,6 y se escapa de cualquier umbral útil. Bajar
el umbral no es opción: dispararía los falsos positivos. **La correlación por
pares sola no aguanta el jitter**, y afirmar lo contrario sería falso.

La solución es dejar de mirar pares y mirar el grupo. Si `n` wallets comparten un
factor latente, el perfil medio del grupo estima ese factor con el ruido reducido
en `sqrt(n)`, y la correlación de cada miembro contra el perfil sube a

```
sqrt(var_compartida / (var_compartida + var_jitter))
```

Lo decisivo no es ese valor sino la separación frente al caso independiente: un
grupo de wallets independientes da una cohesión de aproximadamente `1/sqrt(n)`,
es decir 0,1 para cien miembros. El perfil se construye dejando fuera al propio
miembro, porque si no correlacionaría con un perfil que lo contiene.

**El orden de las operaciones es deliberado.** Primero se parte la población por
señales de coincidencia exacta, que es `O(N)`, y solo después se mide la
cohesión. Eso satisface el invariante 12 por construcción y protege el falso
positivo que de verdad importa: los usuarios honestos tras un mismo RPC público
sí comparten factor latente, pero no comparten financiador ni parámetros de gas,
así que nunca llegan a formar grupo candidato.

### Resultados medidos

Escenario: 75 por ciento honestos independientes, 15 por ciento enjambre, 10 por
ciento honestos compartiendo RPC, diez rondas.

| Jitter | Recall | Falsos positivos | Ruta | Sospecha |
|---|---|---|---|---|
| 0 | 100% | 0 | `cohesive` | 4,62 |
| 3 | 100% | 0 | `cohesive` | 3,03 |
| 6 | 100% | 0 | `multi_signal` | 1,93 |
| 10 | 100% | 0 | `multi_signal` | 1,26 |
| 20 | 100% | 0 | `multi_signal` | 0,64 |

La sospecha **se degrada a propósito** al mejorar la evasión: el detector reporta
menos confianza en lugar de fingir certeza.

| Wallets | Latidos | Tiempo | Memoria pico |
|---|---|---|---|
| 10.000 | 93.311 | 12 s | 14 MB |
| 50.000 | 466.078 | 99 s | 78 MB |
| 100.000 | 932.303 | 293 s | 157 MB |

La ruta `correlated` usa una matriz densa `O(N^2)`: medido, 10.000 wallets
consumían 5,8 GB y 46 s, y 100.000 habrían necesitado unos 580 GB. Por encima de
`max_dense_wallets` se omite con un aviso y el trabajo lo hacen `cohesive` y
`multi_signal`, que son `O(N*R)`. Cinco minutos para cien mil wallets es holgado
dentro de una ventana de impugnación de 48 horas.

### El límite honesto, verificado por un test

Un adversario que aleatoriza **la temporización y las huellas**, con financiador,
gas y calldata distintos por wallet, **no es detectable** con datos onchain. Hay
un test que lo comprueba, `test_careful_adversary_escapes_and_this_is_documented`,
para que el límite sea explícito y falsable en lugar de una nota al pie.

Esa evasión no es gratuita: exige infraestructura independiente por identidad y
fondear cada wallet por una ruta distinta. La afirmación del proyecto es que
cazamos al adversario económicamente racional, no a uno ilimitado.

### Pipeline

```
HeartbeatRegistry emite eventos     (wallet, ronda, bloque, posición)
          |
indexer construye la matriz          una fila por wallet
          |
detector aplica las cuatro rutas     identical, cohesive, multi_signal, correlated
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

**Valores medidos** con `forge test --gas-report` sobre la implementación actual,
no estimaciones.

| Función | Ejecución (mediana) | Coste total de transacción |
|---|---|---|
| `HeartbeatRegistry.respond` | 35.127 | **~56.000** (+21.000 de base) |
| `HeartbeatRegistry.respond` (peor caso) | 58.117 | ~79.000 |
| `Enrollment.enroll` | ~45.000 | ~66.000 |

```
Por bloque:   150M / 56k            = ~2.680 latidos
Por segundo:  2.680 / 0,3 s         = ~8.900 latidos/s
```

La medición es **peor que la estimación inicial de 45.000** y eso cambia una
conclusión: lo que parecía un margen ajustado pasa a ser inviable sin cohortes.

**El riesgo aquí es el pico, no la media.** Si los 100.000 participantes
responden al mismo reto en la misma ventana, el pico es:

```
Sin cohortes, ventana de respuesta de 10 s:
              100.000 / 10 s        = 10.000 TPS de pico
Gas:          10.000 x 56k          = 560M gas/s   = 112% de la capacidad
```

**No cabe.** Con el coste real medido, 100.000 participantes respondiendo al
mismo reto exceden la capacidad de la red en un 12 por ciento. Visto de otra
forma: una ventana de respuesta de 10 segundos son 33 bloques, que a 2.680
latidos por bloque dan hueco para ~88.000 respuestas, por debajo de los 100.000
necesarios.

Y con una ventana de 3 segundos en lugar de 10 serían ~33.000 TPS, **más del
triple de la capacidad**. Por eso las cohortes **no son una optimización
opcional: son un requisito** para el caso de cien mil participantes.

Con 20 cohortes desfasadas la carga se reparte y pasa a ser un flujo continuo en
lugar de ráfagas:

```
Total:        100.000 x 10 respuestas = 1.000.000 tx en 300 s
Sostenido:    1.000.000 / 300         = ~3.300 TPS
Gas:          3.300 x 56k             = ~187M gas/s  = ~37% de la capacidad
Pico por cohorte: 5.000 / 10 s        = 500 TPS
```

Con la **vía agregada**, en la que los participantes firman atestaciones EIP-712
y relayers sin permisos envían lotes verificados en la cadena (estimación: esta
vía todavía no está implementada):

```
Por latido, agregado (ecrecover 3k + almacenamiento 5k + calldata, base amortizada):
              ~9.600 gas
Gas:          3.300 x 9.600         = ~32M gas/s    = ~6% de la capacidad
```

Un relayer puede censurar pero no falsificar, y la vía de autoenvío directo
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

**La implementación actual no necesita contador.** La ventana se divide en
sub-ventanas y cae exactamente un reto por cohorte en cada una, así que el número
de retos es determinista y los `participationScore` son comparables entre
cohortes sin ningún estado compartido. `respond` no es `payable` y escribe solo
en el bitmap del propio llamante: una escritura, a un slot de su propiedad
exclusiva.

**Excepción consciente y documentada.** `Enrollment.enroll` sí usa dos patrones
que serializan: es `payable`, por lo que acredita el balance del contrato, e
incrementa un contador global. Es aceptable **solo ahí**, porque el enrolamiento
es un camino de baja frecuencia por diseño: la ventana de 48 horas existe
precisamente para que no se forme carrera, lo que deja a cien mil participantes
por debajo de 1 TPS, y unos 28 TPS incluso si todos se enrolasen en la última
hora. El invariante 4 apunta a los caminos de alta frecuencia, y el de alta
frecuencia es `respond`, que corre hasta un millón de veces por venta.

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
| Reto automático en segundo plano, sin interacción humana | Se evaluó y se descartó. Si el cliente responde solo, la latencia mide el portátil y la conexión del usuario en lugar de su reacción, y **la señal de varianza desaparece**: los clientes honestos responden rápido y regular, igual que un bot. Solo sobreviviría la señal de correlación. Introduce además un falso positivo grave: usuarios honestos que comparten un mismo RPC público comparten sus picos de carga y correlacionan entre sí, produciendo un clúster falso. La interacción humana es un requisito del mecanismo, no una preferencia de experiencia de usuario. Lo que se elimina es el **esfuerzo**, no la presencia: un toque, nunca un puzzle. |
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
3. Un adversario que aleatoriza la temporización **y** las huellas, con
   financiador, gas y calldata distintos por wallet, no es detectable con datos
   onchain. No es una conjetura: hay un test que lo verifica,
   `test_careful_adversary_escapes_and_this_is_documented` en
   `detector/tests/test_detection.py`. Cazamos al adversario económicamente
   racional, no a uno ilimitado. La evasión le cuesta infraestructura
   independiente por identidad y una ruta de fondeo distinta por wallet.
4. La detección es una carrera armamentística que requiere operación continua. En
   el caso de CrowdSec el operador empezó a rotar direcciones en cuanto se
   aplicaron los bloqueos.
5. El nivel de identidad excluye a participantes sin documento o dispositivo
   adecuado, razón por la cual el nivel de bono debe permanecer siempre
   disponible y la vía sin permisos no se puede eliminar.
6. Una persona puede entregar documento y clave y simplemente no asistir. Es
   imposible de prevenir y es el mismo riesgo residual que tienen hoy las
   entradas en papel con control de identidad.
7. **`ClusterRegistry.resolver` es el único componente de confianza del sistema
   y choca con el invariante 6.** Adjudicar una afirmación estadística necesita
   un árbitro; es la razón por la que existen protocolos como Kleros. La
   mitigación actual es parcial: el rol es inmutable, no puede comprometer
   hallazgos él mismo, sus decisiones son públicas y están respaldadas por bonos,
   y marcar wallets y pedir penalizaciones es permissionless. En producción debe
   sustituirse por un protocolo de arbitraje descentralizado. Se declara aquí en
   lugar de esconderse.
8. La escala de demo (~200 participantes, una cohorte) no ejercita el camino de
   cohortes ni la vía agregada de relayers. Las cifras de capacidad de la sección
   4 son el argumento de diseño para producción, no una medición de la demo.

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
