# STYX

Protocolo de reparto justo de entradas para eventos de alta demanda, construido
sobre Monad.

STYX sustituye la cola opaca por orden de llegada por un proceso público y
verificable: los participantes se cualifican durante una ventana amplia, las
entradas se asignan por sorteo verificable, y los enjambres de bots coordinados
se identifican analizando datos que la cadena registra de forma nativa.

---

## El problema

Cuando salen a la venta las entradas de un evento masivo, las plataformas meten
a cien mil personas en una cola virtual y venden por orden de llegada. Esto no
es una mala implementación de una buena idea. Es una mala idea.

**El orden de llegada premia la velocidad.** Quien gana una carrera de latencia
es quien tiene el menor tiempo de ida y vuelta y más sesiones en paralelo. Un
operador de bots con infraestructura colocada junto al servidor y diez mil
wallets le gana a una persona con un navegador siempre, sin excepción. Ninguna
mejora en la ingeniería de la cola cambia esto, porque **el mecanismo en sí es
la vulnerabilidad**.

**La cola es opaca.** El usuario ve un indicador de carga y una posición
estimada. No hay forma de verificar que esa posición sea real, que el orden
fuese honesto, ni que no se asignara inventario por otra vía antes de abrir la
venta.

**El CAPTCHA no es la defensa que la industria cree.** OWASP cataloga su
elusión como una amenaza propia, OAT-009. Las granjas de resolución humana son
un servicio comercial a aproximadamente un dólar por mil resoluciones. Una
defensa basada en la dificultad del puzzle tiene lista de precios pública.

**La huella de dispositivo y de red es una carrera armamentística con producto
de consumo.** Se venden navegadores antidetección específicamente para
falsificar valores de Canvas, WebGL y User-Agent, y para aislar cada wallet como
si fuera un dispositivo distinto. Estudios sobre tráfico de proxies
residenciales han encontrado que los controles de reputación de IP se evaden en
la gran mayoría de las sesiones. Las defensas que dependen de que el cliente
diga la verdad fracasan, porque el cliente lo controla el atacante.

El resultado es el statu quo: los revendedores acaparan el inventario en los
primeros segundos y revenden con un gran múltiplo, mientras la plataforma
publica estadísticas de bots bloqueados que nadie puede verificar.

---

## La solución

STYX cambia lo que se mide. En lugar de preguntar "¿esta petición viene de un
humano?", que no tiene respuesta, plantea dos preguntas que sí se pueden
responder con evidencia.

**1. ¿Esta identidad sostuvo un coste real a lo largo del tiempo?**

La cualificación ocurre en una ventana amplia, no en una carrera. Los
participantes depositan un bono reembolsable y envían latidos firmados
periódicos en respuesta a retos derivados de hashes de bloques recientes, de
modo que las respuestas no se pueden precomputar. Las entradas se asignan entre
los cualificados mediante selección aleatoria verificable, ponderada por
participación y con tope.

Como la asignación es un sorteo y no una carrera, **ser rápido no aporta nada**.
No hay transacción que ganar, no hay orden que explotar y no hay nada que
front-runear. El bono no identifica bots: su función es **acotar cuántas
identidades puede sostener un atacante**, que es lo que evita que un sorteo sea
trivialmente atacable por sybil.

**2. ¿Estas identidades actúan de forma independiente, o están coordinadas?**

Aquí es donde el diseño se separa de todo lo demás. Un participante automatizado
individual es indistinguible de una persona. Un enjambre de diez mil no lo es,
porque la coordinación deja rastros correlacionados.

El precedente es público. En 2026 CrowdSec documentó un clúster de unas 75.000
direcciones IP repartidas en 230 bloques de red y 43 países, operado por un
único actor. Cada petición individual parecía legítima. El clúster quedó al
descubierto al comparar las peticiones entre sí: el tráfico tenía picos a horas
locales implausibles y correlacionaba estrechamente entre zonas horarias
separadas por trece horas, porque **todo el enjambre corría sobre un único
reloj**; todos los nodos reportaban un viewport idéntico incompatible con los
dispositivos que declaraban; y todos reportaban un renderizador por software que
el hardware declarado nunca usaría.

STYX aplica el mismo razonamiento a datos que la cadena ya almacena. Participar
exige transacciones, y cada transacción queda registrada permanentemente con su
bloque y su posición. Las series temporales por wallet resultantes se analizan
buscando coordinación: distribuciones de latencia de respuesta, correlación
entre wallets, coincidencia en el mismo bloque, linaje de fondeo y huellas de
codificación.

### La ventaja estructural

En una aplicación web las defensas viven en el cliente, y el atacante las evita
llamando directamente a la API. Esa es la razón de fondo por la que la
mitigación de bots convencional pierde.

En STYX no hay cliente privilegiado que evitar. El contrato **es** la API, es
público y sin permisos, y todas las defensas se aplican dentro de él.
Participar y ser observado son la misma acción.

```
Aplicación web:  participar  !=  ser observado    el atacante se desapunta
STYX:            participar  ==  ser observado    no existe cómo desapuntarse
```

---

## Cómo funciona, en orden

```
LUNES 12:00      Se abre el enrolamiento (48 h, sin carrera)
                 Depositas un bono reembolsable. Llegar primero no da ventaja.

MIERCOLES 12:00  Se cierra el enrolamiento

JUEVES 19:00     Ventana de cualificacion: 5 minutos
                 10 retos en instantes impredecibles dentro de la ventana.
                 Cada uno: llega una notificacion, pulsas. ~10 s para responder.
                 Sabes cuando estar, no cuando llegara cada reto.

JUEVES 19:05     Se cierra. El sorteo corre en segundos y ya sabes el resultado.

+48 HORAS        Ventana de impugnacion. El detector analiza las 10 rondas,
                 publica los clusters, cualquiera puede recomputar y refutar.
                 Al cerrar, tu entrada pasa a definitiva.

DIA DEL EVENTO   Puerta del recinto: pruebas la identidad ligada y entras.
```

La propiedad es escalonada: en el sorteo obtienes un **derecho**, al pagar un NFT
**provisional**, y al cerrar la impugnación la entrada **definitiva**. La etapa
provisional es deliberada: es lo que permite revocar las entradas de un enjambre
cuando el análisis retrospectivo lo encuentra. En tiempo real hay segundos de
datos y no se detecta nada; en retrospectiva está el patrón completo.

El detalle de cada fase y los parámetros vigentes están en
[ARCHITECTURE.md](./ARCHITECTURE.md) y en
[protocol-params.json](./protocol-params.json).

---

## Por qué Monad

Monad mainnet produce un bloque cada 300 ms, alcanza finalidad determinista en
600 ms y tiene una capacidad de diseño superior a 10.000 TPS.

**La resolución temporal es el argumento.** El análisis de coordinación depende
de medir cuánto tardó en responder cada wallet. En una cadena con bloques de 12
segundos, una persona que tarda dos segundos y un script que tarda cincuenta
milisegundos caen en el mismo bloque y por tanto son indistinguibles. A 300 ms
la diferencia es visible. En una cadena lenta este análisis no se degrada: es
**imposible**, porque la señal se pierde en el redondeo del bloque.

**El caudal es un requisito de equidad, no una preferencia de rendimiento.** Si
la cadena se congestiona, las comisiones se disparan y la cola se convierte en
una subasta de comisiones, que gana quien tiene más capital. Los latidos
sostenidos de cien mil participantes, más el tráfico en ráfaga del atacante,
deben absorberse sin que el mercado de gas se convierta en el filtro que decide
quién consigue entrada.

**Finalidad determinista sin secuenciador de confianza.** El producto es la
credibilidad de la afirmación de equidad. Si una sola entidad controla el orden
de las transacciones, la cola es tan justa como esa entidad y no se ha resuelto
nada.

El razonamiento detallado, incluido qué componentes necesitan Monad de verdad y
cuáles funcionarían en cualquier cadena EVM, está en
[ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Lo que afirmamos y lo que no

Declarar los límites es parte del diseño, no una advertencia legal.

**Lo que STYX afirma**

- La asignación es verificablemente aleatoria entre los participantes
  cualificados. Cualquiera puede recomputar el sorteo a partir de datos
  públicos.
- La velocidad no confiere ninguna ventaja, por construcción.
- Sostener muchas identidades tiene un coste real y lineal.
- La coordinación entre identidades es detectable, y la detección es
  reproducible por cualquier tercero porque tanto los datos como las reglas son
  públicos.

**Lo que STYX no afirma**

- No detectamos bots. Detectamos **coordinación**. Un participante automatizado
  sofisticado que actúe de forma independiente no es distinguible de una
  persona, y no pretendemos lo contrario.
- No resolvemos la resistencia sybil. Le ponemos precio. Un adversario con
  capital suficiente puede obtener una cuota proporcional.
- Una persona pagada por comprar entradas es un bot económico que ninguna prueba
  de humanidad detecta. Este límite aplica a todos los sistemas, incluido el
  control de identidad en la puerta de un recinto.
- La detección es probabilística. Un hallazgo de clúster reduce el peso en el
  sorteo y abre una impugnación, nunca una exclusión silenciosa, y la vía de
  apelación es obligatoria.

---

## Cobertura OWASP

Reclamada de forma deliberada y estrecha. El mapeo con el razonamiento completo
está en [ARCHITECTURE.md](./ARCHITECTURE.md).

**OWASP Automated Threats to Web Applications** es el catálogo que encaja
directamente con este problema: OAT-005 Scalping, OAT-013 Sniping, OAT-019
Account Creation, OAT-020 Account Aggregation, OAT-021 Denial of Inventory.

**OWASP Top 10:2025**, cuatro categorías: A09 Security Logging and Alerting
Failures, A06 Insecure Design, A01 Broken Access Control, A08 Software or Data
Integrity Failures.

**OWASP Smart Contract Top 10:2026** se usa como lista de verificación de
endurecimiento, para demostrar que mover la lógica de asignación a un contrato
no introduce vulnerabilidades nuevas.

Las categorías fuera de esta lista, como fallos de cadena de suministro o
configuración de seguridad, no las aborda esta arquitectura y no se reclaman.

---

## Estructura del repositorio

```
protocol-params.json   Parametros del protocolo (fuente unica de verdad)
contracts/             Contratos Solidity (Foundry)
indexer/               Indexador de eventos, construye la matriz de features (TypeScript)
detector/              Analisis de coordinacion y clustering (Python)
web/                   Interfaz de demo y visualizacion del enjambre (Next.js)
```

Responsabilidades de los contratos:

| Contrato | Rol |
|---|---|
| `Enrollment` | Enrolamiento y bono reembolsable |
| `HeartbeatRegistry` | Emisión de retos y registro de latidos |
| `Lottery` | Reparto aleatorio verificable |
| `TicketRegistry` | Emisión de entradas y canal oficial de devolución |
| `ClusterRegistry` | Compromisos de clúster y juego de impugnación |

## Red

| Red | Chain ID | RPC |
|---|---|---|
| Monad Mainnet | 143 | `https://rpc.monad.xyz` |
| Monad Testnet | 10143 | `https://testnet-rpc.monad.xyz` |

Moneda nativa `MON`. Faucet de testnet: `https://faucet.monad.xyz`

## Ejecución de la demo

La demo del enjambre se ejecuta desde [swarm/](./swarm/). Instala las
dependencias y configura las credenciales únicamente en el entorno local:

```bash
cd swarm
npm install

export SWARM_FUNDER_PRIVATE_KEY="0x..." # wallet de prueba con MON
export PK="0x..."                       # deployer de prueba
export SWARM_BOT_MNEMONIC="..."         # mnemónica nueva para esta demo

npm run swarm -- prefund --size 20
npm run swarm -- check --size 20
npm run swarm -- demo --size 20
```

Para generar el dataset y el informe del detector por separado:

```bash
npm run swarm -- export --from <bloque-inicial-de-la-demo>
cd ../detector
./.venv/bin/python -m styx_detector detect \
  --input data/heartbeats.json --out data/report.json
```

La interfaz web muestra el resultado individual en `/resultado` y el informe
del detector en `/enjambre`. La wallet debe estar conectada a Monad Testnet
(chain ID `10143`).

## Despliegue actual de contratos

Estas son las direcciones del despliegue vigente en Monad Testnet:

| Contrato | Dirección |
|---|---|
| `Enrollment` | `0x3046575E3D38CdF618F62bdA01506a8B74dB9e32` |
| `HeartbeatRegistry` | `0x3eD527e51c45144Cd2623f76D976c071334241a4` |
| `ClusterRegistry` | `0x3007Ff42a59CB1E3600c2B4fADDEb303A8bAA769` |
| `Lottery` | `0x380fc02fBBAF0601d5935c391cdd97cb74221d6C` |
| `TicketRegistry` | `0x0B57Da09FF40bC6FCACF846F10828539D8095E34` |
| `IdentityVerifier` | `0xE3D52B833E0e4E591cB7280472d18154a93412B9` |
| `resolver` | `0x5BD2EB6d2a922Dc72E9450f9b24c147Bd23C21A1` |

Este despliegue es **de un solo uso para una demo**. `Enrollment` cambia de
fase, los latidos y las rondas quedan registrados en la cadena, y `Lottery` es
inmutable una vez abierta. Por eso no se debe ejecutar otra demo sobre estas
mismas direcciones después de iniciar el ciclo.

Para iniciar un ciclo nuevo hay que desplegar contratos nuevos y actualizar las
direcciones de la web:

```bash
./redeploy.sh
```

El redespliegue no elimina automáticamente los informes locales del ciclo
anterior. Antes de una nueva demo, limpia los datos generados:

```bash
rm -f detector/data/report.json detector/data/heartbeats.json
```

No compartas `SWARM_BOT_MNEMONIC`, claves privadas ni archivos `.env`. Usa
únicamente cuentas de prueba sin fondos reales.

## Estado

Desarrollo temprano. Construido para una hackathon de Monad. Sin auditar. No
apto para producción.

## Documentación

- [ARCHITECTURE.md](./ARCHITECTURE.md) - diseño, modelo de amenaza, pipeline de
  detección, decisiones específicas de Monad
- [AGENTS.md](./AGENTS.md) - convenciones e invariantes de diseño para
  contribuidores y agentes de código

## Fuentes

- [Monad: datos canónicos para agentes de IA](https://docs.monad.xyz/ai/current-facts)
- [Monad: why Monad](https://docs.monad.xyz/introduction/why-monad)
- [OWASP Automated Threats to Web Applications](https://owasp.org/www-project-automated-threats-to-web-applications/)
- [OWASP Top 10:2025](https://owasp.org/Top10/2025/)
- [OWASP Smart Contract Top 10:2026](https://scs.owasp.org/sctop10/)
- [CrowdSec: un operador, 75.000 IPs, 43 países](https://www.crowdsec.net/blog/the-paperphone-cluster-one-operator-80k-ips-43-countries)
- [BleepingComputer: los proxies residenciales evadieron los controles de reputación de IP en el 78 por ciento de 4.000 millones de sesiones](https://www.bleepingcomputer.com/news/security/residential-proxies-evaded-ip-reputation-checks-in-78-percent-of-4b-sessions/)

El contenido de fuentes externas ha sido reformulado para cumplir con
restricciones de licencia.
