/**
 * Typed access to the protocol parameters.
 *
 * `protocol-params.json` at the repository root is the single source of truth
 * (see AGENTS.md, design invariant 0). Never restate these values as literals
 * in components: import them from here so a parameter change propagates.
 *
 * The file currently carries a hackathon demo profile with every duration
 * compressed, so no copy in the interface may assume a unit. A window is 25
 * seconds here and 48 hours in production; rendering it as "horas" would be
 * wrong in one of those cases. Use `formatDuration`.
 */
import rawParams from "../../../protocol-params.json";

interface NetworkParams {
  readonly chainId: number;
  readonly rpc: string;
}

interface ProtocolParams {
  /** Present only on compressed demo profiles. */
  readonly _profile?: string;
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
  readonly sale: {
    readonly inventory: number;
    readonly priceWei: string;
  };
  readonly lottery: {
    readonly participationCap: number;
    readonly roundLengthBlocks: number;
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

/**
 * True when the loaded parameters are a compressed demo profile.
 *
 * Surfaced in the interface rather than hidden. The project's claims rest on
 * being accurate about what it does, and presenting a 25-second enrolment window
 * as if it were the production design would undercut exactly that.
 */
export function isDemoProfile(): boolean {
  return params._profile !== undefined || params.version.includes("demo");
}

const WEI_PER_MON = 10n ** 18n;

/** Blocks expressed as seconds, using the canonical block time. */
export function blocksToSeconds(blocks: number): number {
  return (blocks * params.network.blockTimeMs) / 1000;
}

export function weiToMon(wei: string): number {
  return Number(BigInt(wei)) / Number(WEI_PER_MON);
}
