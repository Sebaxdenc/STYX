# Detector de coordinación

Analiza los latidos que `HeartbeatRegistry` registra en la cadena y busca grupos
de wallets coordinadas. No usa direcciones IP, ni huellas de dispositivo, ni
telemetría de cliente, ni datos personales de ningún tipo: todo lo que consume es
información que la cadena ya publica.

El detector **no afirma distinguir bots de personas**. Detecta **coordinación**,
que es mucho más difícil de disimular, porque el adversario tiene que resultar
creíble diez mil veces y además creíble en conjunto.

## Uso

```
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt

# Genera un dataset sintetico
./.venv/bin/python -m styx_detector simulate --out data/heartbeats.json \
    --honest 300 --swarm 100 --shared-rpc 80 --jitter 3

# Ejecuta la deteccion
./.venv/bin/python -m styx_detector detect --input data/heartbeats.json \
    --out data/report.json

# Tests
./.venv/bin/python -m pytest
```

Los umbrales se leen de `../protocol-params.json`, nunca se definen aquí.

## Las cuatro rutas de detección

Ninguna basta por sí sola, y cada una existe porque la anterior tiene un punto
ciego concreto.

| Ruta | Qué captura | Por qué existe |
|---|---|---|
| `identical` | Wallets con latencia constante e idéntica | La varianza cero hace **indefinida** la correlación de Pearson. Sin esta ruta, el enjambre más obvio de todos pasaría desapercibido |
| `cohesive` | Grupos con señal exacta compartida cuyas desviaciones comparten un factor latente | La correlación por pares se desmorona con jitter. El perfil del grupo recupera la señal |
| `multi_signal` | Grupos que comparten tres o más señales exactas | Con jitter alto la temporización deja de servir, pero el aprovisionamiento por lotes sigue visible |
| `correlated` | Grafo de correlación por pares con comunidades Louvain | Enjambres muy apretados cuya coincidencia de señales es solo parcial |

### Lo contraintuitivo de la correlación

Pearson **resta primero la media de cada wallet**, así que no mide "son rápidos",
mide "se mueven juntos". Un bot lento no se salva y un humano rápido no se
condena. Lo único que se penaliza es moverse en sincronía con otros, que es
exactamente lo que no se puede hacer sin coordinación real.

### Por qué hizo falta la ruta de cohesión

Fue un hallazgo al medir, no una idea previa. Si el adversario añade jitter, la
correlación entre dos de sus wallets cae a

```
var_compartida / (var_compartida + var_jitter)
```

que con jitter moderado baja de 0,6 y se escapa de cualquier umbral útil. Bajar
el umbral no es opción: dispararía los falsos positivos.

La solución es dejar de mirar pares y mirar el grupo. Si `n` wallets comparten un
factor latente, el perfil medio del grupo estima ese factor con el ruido reducido
en `sqrt(n)`, y la correlación de cada miembro contra el perfil sube a

```
sqrt(var_compartida / (var_compartida + var_jitter))
```

Lo importante no es ese número sino la separación: un grupo de wallets
independientes da una cohesión de aproximadamente `1/sqrt(n)`, es decir 0,1 para
cien miembros. El perfil se construye dejando fuera al propio miembro
(leave-one-out), porque si no correlacionaría con un perfil que lo contiene y la
cohesión saldría inflada.

### El orden de las operaciones es deliberado

Primero se parte la población por señales de coincidencia exacta, que es `O(N)`,
y solo después se mide la cohesión. Eso satisface el invariante 12 por
construcción y protege el falso positivo que de verdad importa: los usuarios
honestos tras un mismo RPC público **sí** comparten factor latente, porque
comparten los picos de carga de ese RPC, pero no comparten financiador ni
parámetros de gas, así que nunca llegan a formar grupo candidato.

## Resultados medidos

Escenario: 75% honestos independientes, 15% enjambre, 10% honestos compartiendo
RPC. Diez rondas.

| Jitter del enjambre | Recall | Falsos positivos | Ruta usada | Sospecha |
|---|---|---|---|---|
| 0 | 100% | 0 | `cohesive` | 4,62 |
| 3 | 100% | 0 | `cohesive` | 3,03 |
| 6 | 100% | 0 | `multi_signal` | 1,93 |
| 10 | 100% | 0 | `multi_signal` | 1,26 |
| 20 | 100% | 0 | `multi_signal` | 0,64 |

La puntuación de sospecha **se degrada a propósito** al mejorar la evasión: el
detector reporta menos confianza en lugar de fingir certeza.

### Escalado

| Wallets | Latidos | Tiempo | Memoria pico |
|---|---|---|---|
| 10.000 | 93.311 | 12 s | 14 MB |
| 50.000 | 466.078 | 99 s | 78 MB |
| 100.000 | 932.303 | 293 s | 157 MB |

La ruta `correlated` usa una matriz densa `O(N^2)` en memoria: medido, 10.000
wallets consumían 5,8 GB y 46 s, y 100.000 habrían necesitado unos 580 GB. Por
encima de `max_dense_wallets` esa ruta se omite con un aviso explícito y el
trabajo lo hacen `cohesive` y `multi_signal`, que son `O(N*R)`. No se pierde casi
nada, porque bajo el invariante 12 un clúster necesita señales exactas
compartidas de todos modos, y esos grupos ya los cubre la ruta `cohesive`.

Cinco minutos para cien mil wallets es holgado para un análisis retrospectivo que
corre dentro de una ventana de impugnación de 48 horas.

## El límite honesto

Un adversario que aleatoriza **la temporización y las huellas**, usando
financiador, gas y calldata distintos por wallet, **no es detectable** con datos
onchain. Hay un test que lo verifica
(`test_careful_adversary_escapes_and_this_is_documented`), para que el límite sea
explícito y comprobable en lugar de una nota al pie.

Esa evasión no es gratuita: exige infraestructura independiente por identidad y
fondear cada wallet por una ruta distinta. La afirmación del proyecto es que
cazamos al adversario económicamente racional, no a uno ilimitado.

## Por qué no una red neuronal

| | Red neuronal | Clustering no supervisado |
|---|---|---|
| Datos etiquetados | los necesita, y no existen | no los necesita |
| Explicable | no | sí: "estas wallets correlacionan a 0,97 y comparten financiador" |
| Reproducible por un tercero | difícil | trivial |

La explicabilidad no es opcional: el juego de impugnación exige poder demostrar
**por qué** una wallet entró en un clúster, y que un tercero recompute el
resultado. Una red neuronal rompería esa propiedad, que es justo la que
diferencia este sistema del scoring opaco al que sustituye.

## Reproducibilidad

Es un requisito de correctitud, no un detalle: la ventana de impugnación se
verifica recomputando.

- Versiones de dependencias pinneadas en `requirements.txt`.
- Semilla fija, leída de `protocol-params.json`.
- Orden determinista de wallets y rondas, independiente del orden de llegada.
- La raíz Merkle depende del conjunto de asignaciones, no del orden en que se
  descubrieron los clústeres.
- `params_digest` ata cada informe al ruleset exacto con el que se generó.

El hash de hoja usa `keccak256(abi.encodePacked(address, uint256))` con pares
ordenados, compatible con `MerkleProof` de OpenZeppelin, y hay un test con un
vector de referencia calculado con `cast keccak` de Foundry. Si esa igualdad se
rompe, el compromiso onchain deja de ser verificable.

## Estructura

```
styx_detector/
  model.py        Heartbeat, Fingerprint, Cluster, Report
  features.py     latidos a matriz de latencias + huellas
  similarity.py   correlacion de Pearson vectorizada, grupos de varianza cero, KS
  cohesion.py     factor latente compartido, la ruta que aguanta el jitter
  cluster.py      las cuatro rutas, conjuncion y puntuacion
  commitment.py   raiz Merkle keccak256 y huella del ruleset
  simulate.py     generador de escenarios para demo y tests
  params.py       carga de protocol-params.json
  pipeline.py     orquestacion
  cli.py          interfaz de linea de comandos
```
