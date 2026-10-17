import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineChain, type Address} from 'viem';

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
    readonly challengeCount: number;
    readonly windowBlocks: number;
    readonly responseWindowBlocks: number;
    readonly cohortCount: number;
    readonly minResponsesToQualify: number;
  };
  readonly sale: {readonly priceWei: string};
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
}

/** Addresses of the deployed contracts, written by the deploy step. */
export function loadDeployment(path?: string): Deployment {
  const target = path ?? join(repoRoot, 'deployment.json');
  try {
    return JSON.parse(readFileSync(target, 'utf8')) as Deployment;
  } catch {
    throw new Error(
      `no se pudo leer ${target}. Despliega primero y guarda las direcciones:\n` +
        `  {"enrollment":"0x..","heartbeatRegistry":"0x..","lottery":"0x..","ticketRegistry":"0x.."}`,
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

export const subWindowBlocks = (p: ProtocolParams): number =>
  p.qualification.windowBlocks / p.qualification.challengeCount;
