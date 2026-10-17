/**
 * Typed access to the protocol parameters.
 *
 * `protocol-params.json` at the repository root is the single source of truth
 * (see AGENTS.md, design invariant 0). Never restate these values as literals
 * in components: import them from here so a parameter change propagates.
 */
import rawParams from "../../../protocol-params.json";

interface NetworkParams {
  readonly chainId: number;
  readonly rpc: string;
}

interface ProtocolParams {
  readonly version: string;
  readonly network: {
    readonly mainnet: NetworkParams;
    readonly testnet: NetworkParams;
    readonly blockTimeMs: number;
    readonly finalityMs: number;
    readonly blockGasLimit: number;
  };
  readonly enrollment: {
    readonly windowSeconds: number;
    readonly bondWei: string;
    readonly abandonmentForfeitBps: number;
  };
  readonly qualification: {
    readonly windowSeconds: number;
    readonly windowBlocks: number;
    readonly challengeCount: number;
    readonly meanChallengeIntervalBlocks: number;
    readonly responseWindowBlocks: number;
    readonly minResponsesToQualify: number;
    readonly interactionMode: string;
    readonly cohortCount: number;
  };
  readonly lottery: {
    readonly participationCap: number;
    readonly immutableOnceOpen: boolean;
  };
  readonly dispute: {
    readonly windowSeconds: number;
    readonly challengerBondWei: string;
    readonly transfersLockedDuringWindow: boolean;
    readonly revocationRefundsFullPrice: boolean;
  };
  readonly detection: {
    readonly correlationThreshold: number;
    readonly minClusterSize: number;
    readonly clusteringAlgorithm: string;
    readonly requireSignalConjunction: boolean;
    readonly randomSeed: number;
  };
}

export const params: ProtocolParams = rawParams as ProtocolParams;

const WEI_PER_MON = 10n ** 18n;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

/** Whole-token amount of a wei-denominated string. Bonds are whole MON today. */
export function weiToMon(wei: string): number {
  return Number(BigInt(wei) / WEI_PER_MON);
}

/** Blocks expressed as seconds, using the canonical block time. */
export function blocksToSeconds(blocks: number): number {
  return (blocks * params.network.blockTimeMs) / 1000;
}

export function secondsToHours(seconds: number): number {
  return seconds / SECONDS_PER_HOUR;
}

export function secondsToMinutes(seconds: number): number {
  return seconds / SECONDS_PER_MINUTE;
}
