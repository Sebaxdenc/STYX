import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineChain, type Address} from 'viem';
import {
  mnemonicToAccount,
  privateKeyToAccount,
  type HDAccount,
  type PrivateKeyAccount,
} from 'viem/accounts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

/**
 * Protocol parameters come from protocol-params.json, never from literals here.
 * See invariant 0 in AGENTS.md.
 */
export interface ProtocolParams {
  readonly network: {
    readonly testnet: {readonly chainId: number; readonly rpc: string};
    readonly blockTimeMs: number;
  };
  readonly enrollment: {readonly bondWei: string; readonly windowSeconds: number};
  readonly qualification: {
    readonly windowSeconds: number;
    readonly challengeCount: number;
    readonly windowBlocks: number;
    readonly responseWindowBlocks: number;
    readonly cohortCount: number;
    readonly minResponsesToQualify: number;
  };
  readonly sale: {readonly priceWei: string};
  readonly dispute: {readonly windowSeconds: number};
}

export function loadParams(): ProtocolParams {
  const raw = readFileSync(join(repoRoot, 'protocol-params.json'), 'utf8');
  return JSON.parse(raw) as ProtocolParams;
}

export interface Deployment {
  readonly enrollment: Address;
  readonly heartbeatRegistry: Address;
  readonly lottery: Address;
  readonly ticketRegistry: Address;
  readonly clusterRegistry: Address;
}

/** Addresses of the deployed contracts, written by the deploy step. */
export function loadDeployment(path?: string): Deployment {
  const target = path ?? join(repoRoot, 'deployment.json');
  try {
    return JSON.parse(readFileSync(target, 'utf8')) as Deployment;
  } catch {
    throw new Error(
      `no se pudo leer ${target}. Despliega primero y guarda las direcciones:\n` +
        `  {"enrollment":"0x..","heartbeatRegistry":"0x..","lottery":"0x..",\n` +
        `   "ticketRegistry":"0x..","clusterRegistry":"0x.."}`,
    );
  }
}

export function monadTestnet(params: ProtocolParams) {
  return defineChain({
    id: params.network.testnet.chainId,
    name: 'Monad Testnet',
    nativeCurrency: {name: 'MON', symbol: 'MON', decimals: 18},
    rpcUrls: {default: {http: [process.env.MONAD_RPC ?? params.network.testnet.rpc]}},
  });
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`falta la variable de entorno ${name}`);
  }
  return value;
}

/**
 * Funder account, from either a private key or a mnemonic.
 *
 * A private key is accepted because that is what MetaMask hands you, and asking
 * for a seed phrase when the user already has a key invites pasting the phrase
 * of a real wallet into a shell.
 */
export function loadFunderAccount(): PrivateKeyAccount | HDAccount {
  const privateKey = process.env.SWARM_FUNDER_PRIVATE_KEY;
  if (privateKey !== undefined && privateKey.trim() !== '') {
    const trimmed = privateKey.trim();
    const prefixed = (trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`) as `0x${string}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(prefixed)) {
      throw new Error(
        'SWARM_FUNDER_PRIVATE_KEY no es una clave valida: son 64 caracteres hex. ' +
          'Si tiene 40, has pegado una direccion en lugar de una clave.',
      );
    }
    return privateKeyToAccount(prefixed);
  }

  const mnemonic = process.env.SWARM_FUNDER_MNEMONIC;
  if (mnemonic !== undefined && mnemonic.trim() !== '') {
    const words = mnemonic.trim().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
      throw new Error(
        `SWARM_FUNDER_MNEMONIC tiene ${words.length} palabras; una mnemonica son 12 o 24. ` +
          'Si pusiste el texto de ejemplo, sustituyelo por tu frase real, ' +
          'o usa SWARM_FUNDER_PRIVATE_KEY en su lugar.',
      );
    }
    return mnemonicToAccount(mnemonic.trim());
  }

  throw new Error(
    'falta la cuenta que fondea el enjambre. Define una de las dos:\n' +
      '  export SWARM_FUNDER_PRIVATE_KEY=0x...   (la de MetaMask, 64 hex)\n' +
      '  export SWARM_FUNDER_MNEMONIC="palabra1 palabra2 ... palabra12"',
  );
}

export const subWindowBlocks = (p: ProtocolParams): number =>
  p.qualification.windowBlocks / p.qualification.challengeCount;
