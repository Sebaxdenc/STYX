import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import {mnemonicToAccount, privateKeyToAccount} from 'viem/accounts';

import {
  adminAbi,
  clusterAbi,
  lotteryAdminAbi,
  qualificationAdminAbi,
  ticketAdminAbi,
} from './abi.js';
import {
  loadDeployment,
  loadParams,
  monadTestnet,
  requireEnv,
  type Deployment,
} from './config.js';
import {exportDataset} from './export.js';
import {runSwarm} from './swarm.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const detectorDir = join(repoRoot, 'detector');
const detectorPython = join(detectorDir, '.venv', 'bin', 'python');
const datasetPath = join(detectorDir, 'data', 'heartbeats.json');
const reportPath = join(detectorDir, 'data', 'report.json');

/** Same mnemonic the swarm derives from, so the summary can tell bots apart. */
const SWARM_MNEMONIC = 'test test test test test test test test test test test junk';

export interface DemoOptions {
  readonly size: number;
  readonly jitterBlocks: number;
  readonly careful: boolean;
  readonly skipSwarm: boolean;
}

interface Report {
  readonly merkle_root: Hex;
  readonly proofs: Record<string, {clusterId: number; proof: Hex[]}>;
}

/**
 * Drives the whole 90 second demo from one command.
 *
 * Every phase waits on CHAIN STATE rather than a wall clock sleep. Blocks are
 * 300 ms and a presenter cannot retry a mistyped `cast` on stage, so the runner
 * reads `closesAt`, `windowEndBlock` and `seedBlock` from the contracts and acts
 * when the condition actually holds. If the network hiccups the demo runs late
 * instead of running wrong.
 */
export async function runDemo(options: DemoOptions): Promise<void> {
  const params = loadParams();
  const chain = monadTestnet(params);
  const deployment = loadDeployment();
  const publicClient = createPublicClient({chain, transport: http()}) as PublicClient;
  const admin = privateKeyToAccount(requireEnv('PK') as Hex);
  const wallet = createWalletClient({account: admin, chain, transport: http()});

  const send = async (
    address: Address,
    abi: readonly unknown[],
    functionName: string,
    args: readonly unknown[] = [],
  ): Promise<void> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hash = await wallet.writeContract({address, abi, functionName, args} as any);
    await publicClient.waitForTransactionReceipt({hash});
  };

  const t0 = Date.now();
  const at = (): string => `T+${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const phase = (n: number, text: string): void => {
    process.stdout.write(`\n[${at()}] === FASE ${n}: ${text} ===\n`);
  };

  // ---- Fase 1: enrolamiento -------------------------------------------------
  phase(1, 'abrir enrolamiento');
  const startBlock = await publicClient.getBlockNumber();
  await send(deployment.enrollment, adminAbi, 'openEnrollment');
  log(`enrolamiento abierto. bloque inicial ${startBlock}`);
  log('los humanos ya pueden entrar desde el frontend o el QR');

  // The swarm runs alongside the rest of the timeline. It waits for each phase
  // on its own, which is why it can be launched this early.
  const swarm = options.skipSwarm
    ? Promise.resolve()
    : runSwarm({
        size: options.size,
        jitterBlocks: options.jitterBlocks,
        careful: options.careful,
        fundWei: 0n, // already prefunded; fund() skips wallets with balance
      }).catch((error: unknown) => {
        log(`el enjambre fallo: ${describe(error)}`);
      });

  // ---- Fase 2: cualificacion ------------------------------------------------
  const closesAt = await publicClient.readContract({
    address: deployment.enrollment,
    abi: adminAbi,
    functionName: 'closesAt',
  });
  await waitForTimestamp(publicClient, closesAt);

  phase(2, 'cerrar enrolamiento y abrir cualificacion');
  await send(deployment.enrollment, adminAbi, 'closeEnrollment');
  const enrolled = await publicClient.readContract({
    address: deployment.enrollment,
    abi: adminAbi,
    functionName: 'enrolledCount',
  });
  await send(deployment.heartbeatRegistry, qualificationAdminAbi, 'openQualification');
  log(`${enrolled} participantes enrolados`);
  log(`${params.qualification.challengeCount} retos en instantes impredecibles`);

  const windowEnd = await publicClient.readContract({
    address: deployment.heartbeatRegistry,
    abi: qualificationAdminAbi,
    functionName: 'windowEndBlock',
  });
  await waitForBlock(publicClient, windowEnd + 1n, 'cualificacion');

  // ---- Fase 3: sorteo -------------------------------------------------------
  phase(3, 'sorteo');
  await send(deployment.lottery, lotteryAdminAbi, 'requestSeed');
  const seedBlock = await publicClient.readContract({
    address: deployment.lottery,
    abi: lotteryAdminAbi,
    functionName: 'seedBlock',
  });
  await waitForBlock(publicClient, seedBlock + 1n, 'semilla');
  await send(deployment.lottery, lotteryAdminAbi, 'finalizeSeed');
  log('semilla fijada desde el hash de un bloque futuro. el sorteo ya esta decidido');
  log('reclamar es recoger, no competir: llegar tarde no quita nada');

  // Let claims land. Derived from the round length rather than a fixed sleep:
  // a human needs to see the result, press the button and confirm in MetaMask,
  // and if this waits less than the round lasts the demo moves on while someone
  // is still confirming.
  const roundMs = Number(
    await publicClient.readContract({
      address: deployment.lottery,
      abi: lotteryAdminAbi,
      functionName: 'roundLengthBlocks',
    }),
  ) * params.network.blockTimeMs;
  log(`${Math.round(roundMs / 1000)} s para reclamar`);
  await Promise.race([swarm, sleep(roundMs)]);

  const entitlements = await publicClient.readContract({
    address: deployment.lottery,
    abi: lotteryAdminAbi,
    functionName: 'issued',
  });
  log(`${entitlements} derechos asignados`);

  // ---- Fase 4: deteccion y revocacion --------------------------------------
  phase(4, 'deteccion y revocacion');
  await exportDataset({fromBlock: startBlock, out: datasetPath});
  runDetector();

  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report;
  const flagged = Object.keys(report.proofs);
  log(`el detector agrupo ${flagged.length} wallets`);

  if (flagged.length === 0) {
    log('sin clusters: nada que revocar. comprueba minClusterSize y el tamano del enjambre');
  } else {
    await send(deployment.clusterRegistry, clusterAbi, 'commitFinding', [
      report.merkle_root,
      'ipfs://ruleset',
      'ipfs://dataset',
    ]);
    log(`hallazgo comprometido. raiz ${report.merkle_root}`);

    let marked = 0;
    let revoked = 0;
    for (const raw of flagged) {
      const address = getAddress(raw);
      const entry = report.proofs[raw];
      if (entry === undefined) continue;
      try {
        await send(deployment.clusterRegistry, clusterAbi, 'markFlagged', [
          address,
          BigInt(entry.clusterId),
          entry.proof,
        ]);
        marked += 1;
      } catch (error) {
        log(`  no se pudo marcar ${address}: ${describe(error)}`);
        continue;
      }
      try {
        await send(deployment.ticketRegistry, ticketAdminAbi, 'revoke', [address]);
        revoked += 1;
      } catch {
        // Expected for flagged wallets that never won a ticket.
      }
    }
    log(`marcadas ${marked}, entradas revocadas ${revoked}`);
  }

  await summary(publicClient, deployment, options);
  process.stdout.write(`\n[${at()}] demo completa\n`);
}

// ------------------------------------------------------------------ preflight

/** Checks everything that can be checked before going on stage. */
export async function preflight(options: DemoOptions): Promise<number> {
  const problems: string[] = [];
  const ok = (text: string): void => {
    process.stdout.write(`  ok    ${text}\n`);
  };
  const bad = (text: string): void => {
    process.stdout.write(`  FALLO ${text}\n`);
    problems.push(text);
  };

  const params = loadParams();
  const chain = monadTestnet(params);
  const publicClient = createPublicClient({chain, transport: http()}) as PublicClient;

  process.stdout.write('comprobacion previa\n');

  try {
    const block = await publicClient.getBlockNumber();
    ok(`RPC responde, bloque ${block}`);
  } catch (error) {
    bad(`RPC no responde: ${describe(error)}`);
    return 1;
  }

  const deployment = loadDeployment();
  for (const [name, address] of Object.entries(deployment)) {
    const code = await publicClient.getCode({address: address as Address});
    if (code === undefined || code === '0x') bad(`${name} no tiene codigo en ${address}`);
    else ok(`${name} desplegado`);
  }

  const phaseValue = await publicClient.readContract({
    address: deployment.enrollment,
    abi: adminAbi,
    functionName: 'phase',
  });
  if (phaseValue === 0) ok('Enrollment en fase Created, listo para abrir');
  else bad(`Enrollment ya esta en fase ${phaseValue}. Vuelve a desplegar para un ensayo limpio`);

  try {
    const admin = privateKeyToAccount(requireEnv('PK') as Hex);
    const balance = await publicClient.getBalance({address: admin.address});
    if (balance < 300_000_000_000_000_000n) bad(`el deployer tiene poco saldo: ${balance} wei`);
    else ok(`deployer con saldo (${admin.address})`);
  } catch (error) {
    bad(describe(error));
  }

  // Prefunding is the step that is easiest to forget and the one that breaks the
  // demo silently, because enrolment closes before forty sequential transfers
  // can land. Irrelevant when the swarm is not taking part.
  if (options.skipSwarm) {
    ok('enjambre desactivado (--no-swarm), no se comprueba el prefondeo');
  } else {
    let funded = 0;
    for (let i = 1; i <= options.size; i++) {
      const bot = mnemonicToAccount(SWARM_MNEMONIC, {addressIndex: i});
      const balance = await publicClient.getBalance({address: bot.address});
      if (balance > 50_000_000_000_000_000n) funded += 1;
    }
    if (funded < options.size) {
      bad(
        `solo ${funded}/${options.size} wallets prefondeadas. ` +
          `Ejecuta: prefund --size ${options.size}`,
      );
    } else {
      ok(`${funded} wallets del enjambre prefondeadas`);
    }
  }

  if (!existsSync(detectorPython)) {
    bad(`falta el venv del detector en ${detectorPython}`);
  } else {
    ok('venv del detector presente');
  }

  const total =
    params.enrollment.windowSeconds +
    params.qualification.windowSeconds +
    params.dispute.windowSeconds;
  if (total > 150) bad(`el ciclo dura ${total}s, demasiado para el pitch`);
  else ok(`ciclo de ~${total}s mas el sorteo`);

  process.stdout.write(
    problems.length === 0
      ? '\ntodo listo\n'
      : `\n${problems.length} problema(s) que arreglar antes del pitch\n`,
  );
  return problems.length === 0 ? 0 : 1;
}

// ------------------------------------------------------------------ utilities

function runDetector(): void {
  const result = spawnSync(
    detectorPython,
    ['-m', 'styx_detector', 'detect', '--input', datasetPath, '--out', reportPath],
    {cwd: detectorDir, stdio: 'inherit'},
  );
  if (result.status !== 0) throw new Error('el detector fallo');
}

async function summary(
  client: PublicClient,
  deployment: Deployment,
  options: DemoOptions,
): Promise<void> {
  const issued = await client.readContract({
    address: deployment.ticketRegistry,
    abi: ticketAdminAbi,
    functionName: 'issued',
  });
  const revoked = await client.readContract({
    address: deployment.ticketRegistry,
    abi: ticketAdminAbi,
    functionName: 'revoked',
  });

  let botsWithTickets = 0;
  let botsRevoked = 0;
  for (let i = 1; i <= options.size; i++) {
    const bot = mnemonicToAccount(SWARM_MNEMONIC, {addressIndex: i});
    const state = await client.readContract({
      address: deployment.ticketRegistry,
      abi: ticketAdminAbi,
      functionName: 'stateOf',
      args: [bot.address],
    });
    if (state !== 0) botsWithTickets += 1;
    if (state === 3) botsRevoked += 1;
  }

  const humanTickets = Number(issued) - botsWithTickets;
  process.stdout.write('\n=============== RESULTADO ===============\n');
  process.stdout.write(`entradas emitidas          ${issued}\n`);
  process.stdout.write(`  conseguidas por el enjambre ${botsWithTickets}\n`);
  process.stdout.write(`  revocadas al enjambre       ${botsRevoked}\n`);
  process.stdout.write(`  en manos de personas        ${humanTickets}\n`);
  process.stdout.write(`entradas vivas             ${Number(issued) - Number(revoked)}\n`);
  process.stdout.write('=========================================\n');
}

async function waitForTimestamp(client: PublicClient, target: bigint): Promise<void> {
  for (;;) {
    const block = await client.getBlock();
    if (block.timestamp >= target) return;
    await sleep(500);
  }
}

async function waitForBlock(client: PublicClient, target: bigint, label: string): Promise<void> {
  let announced = false;
  for (;;) {
    const current = await client.getBlockNumber();
    if (current >= target) return;
    if (!announced) {
      log(`esperando ${label}: bloque ${current} de ${target}`);
      announced = true;
    }
    await sleep(300);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function describe(error: unknown): string {
  if (error instanceof Error) return error.message.split('\n')[0] ?? error.message;
  return String(error);
}

function log(message: string): void {
  process.stdout.write(`  ${message}\n`);
}
