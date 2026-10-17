import {
  createPublicClient,
  createWalletClient,
  encodePacked,
  http,
  keccak256,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import {mnemonicToAccount, type HDAccount} from 'viem/accounts';

import {enrollmentAbi, heartbeatAbi, lotteryAbi, ticketAbi} from './abi.js';
import {
  loadDeployment,
  loadFunderAccount,
  loadParams,
  monadTestnet,
  subWindowBlocks,
  type Deployment,
  type ProtocolParams,
} from './config.js';

/**
 * Adversary simulator for the demo.
 *
 * It is deliberately a REALISTIC bot operator, not a strawman. Every wallet is
 * funded from one address, runs the same client with the same gas settings, sends
 * byte-identical calldata and reacts as fast as the chain allows. Those are not
 * mistakes planted to make detection easy: they are what sharing infrastructure
 * actually looks like, and they are exactly the signals that unmasked the
 * PaperPhone cluster of 75.000 IPs described in README.md.
 *
 * `--jitter` lets the operator fight back by randomising response timing, which
 * is the cheapest real countermeasure. The detector then falls back from the
 * cohesion path to the multi-signal path, which is the behaviour documented in
 * ARCHITECTURE.md section 3.
 *
 * `--careful` additionally randomises gas and funds each wallet separately. That
 * configuration ESCAPES detection, and it is included on purpose so the honest
 * limit of the system can be demonstrated rather than hidden.
 */
export interface SwarmOptions {
  readonly size: number;
  readonly jitterBlocks: number;
  readonly careful: boolean;
  readonly fundWei: bigint;
  readonly deploymentPath?: string;
}

const SWARM_MNEMONIC =
  'test test test test test test test test test test test junk';

/** Shared gas settings. One script, one configuration, one fingerprint. */
const SWARM_GAS_PRICE = 55_000_000_000n;
const SWARM_GAS_LIMIT = 120_000n;
const NATIVE_TRANSFER_GAS = 21_000n;

/**
 * Monad's reserve balance makes under-funding bite twice.
 *
 * At consensus time an account's budget for the gas of ALL its in-flight
 * transactions is `min(10 MON, balance)`, so a thin balance limits bursts and
 * not just the total spend. And each wallet here runs roughly eight
 * transactions: enrol, five heartbeats, claim entitlement, claim ticket. At
 * 55 gwei and a 120k limit that is about 0.0066 MON each, plus the bond.
 *
 *     8 x 0.0066 + bond  =~ 0.06 MON of hard floor
 *
 * 0.05 MON, the first default used here, therefore ran out mid-run. Funding with
 * room is the documented practice.
 */
export const DEFAULT_FUND_MON = '0.2';

/**
 * Funds the swarm wallets and stops.
 *
 * Kept as its own step because funding is sequential, one transaction per wallet
 * from a single funder, and forty of them do not fit inside the 25 second
 * enrolment window of the demo. Run this before the pitch; `attack` then skips
 * any wallet that already has a balance and starts immediately.
 */
export async function prefundSwarm(options: SwarmOptions): Promise<void> {
  const params = loadParams();
  const chain = monadTestnet(params);
  const publicClient = createPublicClient({chain, transport: http()}) as PublicClient;
  const funder = loadFunderAccount();
  const funderClient = createWalletClient({account: funder, chain, transport: http()});

  const bots = Array.from({length: options.size}, (_, i) =>
    mnemonicToAccount(SWARM_MNEMONIC, {addressIndex: i + 1}),
  );

  log(`prefondeo de ${bots.length} wallets desde ${funder.address}`);
  await fund(funderClient, publicClient, bots, options);

  let total = 0n;
  for (const bot of bots) total += await publicClient.getBalance({address: bot.address});
  log(`saldo total del enjambre: ${total} wei`);
}

export async function runSwarm(options: SwarmOptions): Promise<void> {
  const params = loadParams();
  const chain = monadTestnet(params);
  const deployment = loadDeployment(options.deploymentPath);

  const publicClient = createPublicClient({chain, transport: http()}) as PublicClient;
  const funder = loadFunderAccount();
  const funderClient = createWalletClient({account: funder, chain, transport: http()});

  const bots = Array.from({length: options.size}, (_, i) =>
    mnemonicToAccount(SWARM_MNEMONIC, {addressIndex: i + 1}),
  );

  log(`enjambre de ${bots.length} wallets`);
  log(`financiador ${funder.address}`);
  log(options.careful
    ? 'modo CUIDADOSO: huellas aleatorizadas. Este modo ESCAPA a la deteccion, a proposito.'
    : 'modo normal: financiador, gas y calldata compartidos');

  // 1. Funding. In normal mode a single address funds every wallet, which is the
  //    funding-lineage signal. In careful mode the operator would use a separate
  //    route per wallet; here it is simulated by varying the amount so the
  //    pattern stops being uniform.
  await fund(funderClient, publicClient, bots, options);

  // 2. Enrolment. No race: the window is open and arriving early gains nothing.
  await enroll(publicClient, chain, bots, deployment, params, options);

  // 3. Qualification. The whole swarm answers each challenge in the same block.
  await qualify(publicClient, chain, bots, deployment, params, options);

  // 4. Collect whatever the draw assigned.
  await collect(publicClient, chain, bots, deployment, params);
}

// --------------------------------------------------------------------- funding

async function fund(
  funderClient: ReturnType<typeof createWalletClient>,
  publicClient: PublicClient,
  bots: readonly HDAccount[],
  options: SwarmOptions,
): Promise<void> {
  log('fondeando...');
  const gasPrice = maxBigInt(SWARM_GAS_PRICE, await publicClient.getGasPrice());
  if (gasPrice !== SWARM_GAS_PRICE) {
    log(`gas del prefondeo ajustado a ${gasPrice / 1_000_000_000n} gwei`);
  }
  for (const [index, bot] of bots.entries()) {
    const balance = await publicClient.getBalance({address: bot.address});
    if (balance >= options.fundWei) continue;

    const value = options.careful
      ? options.fundWei + BigInt(index) * parseEther('0.0001')
      : options.fundWei;

    const hash = await funderClient.sendTransaction({
      to: bot.address,
      value,
      // Monad can reject eth_estimateGas with a reserve-balance violation even
      // when a plain native transfer is valid. Native transfers have a fixed
      // gas cost, so bypass estimation and submit the measured limit directly.
      gas: NATIVE_TRANSFER_GAS,
      gasPrice,
      chain: null,
      account: funderClient.account ?? null,
    });
    await publicClient.waitForTransactionReceipt({hash});
  }
  log('fondeo completo');
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

// ------------------------------------------------------------------ enrolment

async function enroll(
  publicClient: PublicClient,
  chain: ReturnType<typeof monadTestnet>,
  bots: readonly HDAccount[],
  deployment: Deployment,
  params: ProtocolParams,
  options: SwarmOptions,
): Promise<void> {
  const bond = BigInt(params.enrollment.bondWei);
  log(`enrolando con un bono de ${bond} wei cada una`);

  const results = await Promise.allSettled(
    bots.map(async (bot) => {
      const already = await publicClient.readContract({
        address: deployment.enrollment,
        abi: enrollmentAbi,
        functionName: 'isEnrolled',
        args: [bot.address],
      });
      if (already) return;

      const client = createWalletClient({account: bot, chain, transport: http()});
      const hash = await client.writeContract({
        address: deployment.enrollment,
        abi: enrollmentAbi,
        functionName: 'enroll',
        value: bond,
        ...gasFor(options),
      });
      await publicClient.waitForTransactionReceipt({hash});
    }),
  );

  report('enrolamiento', results);
}

// -------------------------------------------------------------- qualification

async function qualify(
  publicClient: PublicClient,
  chain: ReturnType<typeof monadTestnet>,
  bots: readonly HDAccount[],
  deployment: Deployment,
  params: ProtocolParams,
  options: SwarmOptions,
): Promise<void> {
  // The orchestrator launches the swarm right after enrolment opens, so the
  // qualification window does not exist yet. Waiting here instead of failing is
  // what lets the whole demo run from a single command.
  const windowStart = await waitForQualification(publicClient, deployment);

  const cohort = await publicClient.readContract({
    address: deployment.heartbeatRegistry,
    abi: heartbeatAbi,
    functionName: 'cohortOf',
    args: [bots[0]?.address ?? ('0x' as Address)],
  });

  const sub = BigInt(subWindowBlocks(params));
  const span = sub - BigInt(params.qualification.responseWindowBlocks);

  for (let round = 0; round < params.qualification.challengeCount; round++) {
    const subStart = windowStart + BigInt(round) * sub;

    // The challenge block is computed locally from the sub-window's block hash,
    // exactly as the contract does. One read per round instead of polling every
    // 300 ms block.
    await waitForBlock(publicClient, subStart + 1n);
    const block = await publicClient.getBlock({blockNumber: subStart});
    const offset =
      BigInt(keccak256(encodePacked(['bytes32', 'uint16'], [block.hash, cohort]))) % span;
    const challengeBlock = subStart + 1n + offset;

    const jitter = options.jitterBlocks > 0
      ? BigInt(Math.floor(Math.random() * (options.jitterBlocks + 1)))
      : 0n;

    await waitForBlock(publicClient, challengeBlock + 1n + jitter);
    log(`ronda ${round}: reto en el bloque ${challengeBlock}, respondiendo`);

    // Every wallet fires at once. One scheduler, one clock.
    const results = await Promise.allSettled(
      bots.map(async (bot) => {
        const client = createWalletClient({account: bot, chain, transport: http()});
        const hash = await client.writeContract({
          address: deployment.heartbeatRegistry,
          abi: heartbeatAbi,
          functionName: 'respond',
          args: [round],
          ...gasFor(options),
        });
        await publicClient.waitForTransactionReceipt({hash});
      }),
    );
    report(`ronda ${round}`, results);
  }
}

// -------------------------------------------------------------- collect spoils

async function collect(
  publicClient: PublicClient,
  chain: ReturnType<typeof monadTestnet>,
  bots: readonly HDAccount[],
  deployment: Deployment,
  params: ProtocolParams,
): Promise<void> {
  const open = await waitForLotteryRound(publicClient, deployment);
  if (!open) {
    log('no se abrio ninguna ronda de sorteo, nada que reclamar');
    return;
  }

  const round = await publicClient.readContract({
    address: deployment.lottery,
    abi: lotteryAbi,
    functionName: 'currentRound',
  });

  let won = 0;
  for (const bot of bots) {
    const selected = await publicClient.readContract({
      address: deployment.lottery,
      abi: lotteryAbi,
      functionName: 'isSelected',
      args: [bot.address, round],
    });
    if (!selected) continue;

    const client = createWalletClient({account: bot, chain, transport: http()});
    try {
      const entitlement = await client.writeContract({
        address: deployment.lottery,
        abi: lotteryAbi,
        functionName: 'claimEntitlement',
      });
      await publicClient.waitForTransactionReceipt({hash: entitlement});

      // The nullifier is a per-wallet commitment. A real adversary cannot do
      // this at scale: it would need one genuine document per wallet.
      const nullifier = keccak256(encodePacked(['address'], [bot.address])) as Hex;
      const ticket = await client.writeContract({
        address: deployment.ticketRegistry,
        abi: ticketAbi,
        functionName: 'claimTicket',
        args: [nullifier],
        value: BigInt(params.sale.priceWei),
      });
      await publicClient.waitForTransactionReceipt({hash: ticket});
      won += 1;
    } catch (error) {
      log(`  ${bot.address} no pudo reclamar: ${describe(error)}`);
    }
  }

  log(`el enjambre consiguio ${won} entradas provisionales`);
  log('si el detector lo agrupa, seran REVOCADAS dentro de la ventana de impugnacion');
}

// ----------------------------------------------------------------- utilities

function gasFor(options: SwarmOptions): {gasPrice: bigint; gas: bigint} {
  if (!options.careful) {
    // Identical for every wallet: the shared-gas fingerprint.
    return {gasPrice: SWARM_GAS_PRICE, gas: SWARM_GAS_LIMIT};
  }
  const jitterGwei = BigInt(40 + Math.floor(Math.random() * 30)) * 1_000_000_000n;
  return {gasPrice: jitterGwei, gas: SWARM_GAS_LIMIT + BigInt(Math.floor(Math.random() * 20_000))};
}

/** Polls until the qualification window opens, up to a sane ceiling. */
async function waitForQualification(
  client: PublicClient,
  deployment: Deployment,
  timeoutMs = 180_000,
): Promise<bigint> {
  const deadline = Date.now() + timeoutMs;
  let announced = false;

  for (;;) {
    const start = await client.readContract({
      address: deployment.heartbeatRegistry,
      abi: heartbeatAbi,
      functionName: 'windowStartBlock',
    });
    if (start !== 0n) return start;

    if (!announced) {
      log('esperando que se abra la ventana de cualificacion...');
      announced = true;
    }
    if (Date.now() > deadline) {
      throw new Error('la ventana de cualificacion no se abrio a tiempo');
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

/** Polls until a lottery round is open. Returns false if none appears. */
async function waitForLotteryRound(
  client: PublicClient,
  deployment: Deployment,
  timeoutMs = 120_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let announced = false;

  for (;;) {
    const open = await client.readContract({
      address: deployment.lottery,
      abi: lotteryAbi,
      functionName: 'isRoundOpen',
    });
    if (open) return true;
    if (Date.now() > deadline) return false;

    if (!announced) {
      log('esperando que se abra una ronda de sorteo...');
      announced = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

async function waitForBlock(client: PublicClient, target: bigint): Promise<void> {
  for (;;) {
    const current = await client.getBlockNumber();
    if (current >= target) return;
    // Half a block at 300 ms, so the swarm reacts as fast as the chain allows.
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

function report(label: string, results: readonly PromiseSettledResult<unknown>[]): void {
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - ok;
  log(`${label}: ${ok} ok, ${failed} fallidas`);
  if (failed > 0) {
    const first = results.find((r) => r.status === 'rejected');
    if (first && first.status === 'rejected') log(`  primer error: ${describe(first.reason)}`);
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message.split('\n')[0] ?? error.message;
  return String(error);
}

function log(message: string): void {
  process.stdout.write(`[enjambre] ${message}\n`);
}
