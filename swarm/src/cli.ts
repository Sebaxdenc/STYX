import {parseEther} from 'viem';

import {exportDataset} from './export.js';
import {DEFAULT_FUND_MON, prefundSwarm, runSwarm} from './swarm.js';

const USAGE = `
STYX swarm: simulador de adversario y exportador de datasets.

  npm run swarm -- prefund [--size N] [--fund MON]
      Fondea las wallets y para. HAZLO ANTES DEL PITCH: el fondeo es
      secuencial y 40 transacciones no caben en los 25 s de enrolamiento.

  npm run swarm -- attack [opciones]
      --size N          wallets del enjambre (por defecto 40)
      --jitter N        bloques de retardo aleatorio (por defecto 0)
      --careful         aleatoriza tambien las huellas. ESCAPA a la deteccion,
                        incluido a proposito para demostrar el limite honesto
      --fund MON        fondeo por wallet (por defecto 0.2). No lo bajes:
                        el reserve balance de Monad limita las rafagas segun
                        el saldo, y cada wallet hace ~8 transacciones

  npm run swarm -- export --from BLOQUE [--out fichero]
      Lee la cadena y escribe el dataset que consume el detector

Entorno:
  SWARM_FUNDER_MNEMONIC   obligatorio para attack
  MONAD_RPC               opcional, sobreescribe el RPC de protocol-params.json

Las direcciones de los contratos se leen de deployment.json en la raiz del repo.
`;

function flag(args: readonly string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function value(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);

  if (command === 'attack') {
    await runSwarm({
      size: Number(value(args, 'size') ?? 40),
      jitterBlocks: Number(value(args, 'jitter') ?? 0),
      careful: flag(args, 'careful'),
      fundWei: parseEther(value(args, 'fund') ?? DEFAULT_FUND_MON),
      deploymentPath: value(args, 'deployment'),
    });
    return 0;
  }

  if (command === 'prefund') {
    await prefundSwarm({
      size: Number(value(args, 'size') ?? 40),
      jitterBlocks: 0,
      careful: flag(args, 'careful'),
      fundWei: parseEther(value(args, 'fund') ?? DEFAULT_FUND_MON),
      deploymentPath: value(args, 'deployment'),
    });
    return 0;
  }

  if (command === 'export') {
    const from = value(args, 'from');
    if (from === undefined) {
      process.stderr.write('falta --from BLOQUE\n');
      return 1;
    }
    await exportDataset({
      fromBlock: BigInt(from),
      out: value(args, 'out') ?? '../detector/data/heartbeats.json',
      deploymentPath: value(args, 'deployment'),
    });
    return 0;
  }

  process.stdout.write(USAGE);
  return command === undefined ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
