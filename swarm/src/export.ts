import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {createPublicClient, http, keccak256, type Address, type PublicClient} from 'viem';

import {heartbeatAbi} from './abi.js';
import {loadDeployment, loadParams, monadTestnet} from './config.js';

/**
 * Minimal indexer: turns on-chain state into the dataset the detector consumes.
 *
 * Everything here is derived from public chain data. No IP addresses, no device
 * fingerprints, no personal data of any kind, per invariant 1.
 *
 * Funding lineage is reconstructed by scanning blocks for native transfers to
 * participants, because plain JSON-RPC has no index for those. It is cheap at
 * demo scale (a few hundred blocks). A production indexer would track transfers
 * continuously instead.
 */
interface HeartbeatRow {
  wallet: Address;
  cohort: number;
  round: number;
  challenge_block: number;
  response_block: number;
  gas_price: number;
  gas_limit: number;
  calldata_hash: string;
  funder: string;
}

export interface ExportOptions {
  readonly fromBlock: bigint;
  readonly out: string;
  readonly deploymentPath?: string;
}

export async function exportDataset(options: ExportOptions): Promise<void> {
  const params = loadParams();
  const chain = monadTestnet(params);
  const deployment = loadDeployment(options.deploymentPath);
  const client = createPublicClient({chain, transport: http()}) as PublicClient;

  const logs = await fetchHeartbeatsChunked(client, deployment.heartbeatRegistry, options.fromBlock);
  log(`${logs.length} latidos encontrados desde el bloque ${options.fromBlock}`);
  if (logs.length === 0) {
    throw new Error('sin latidos: comprueba fromBlock y que la ventana haya corrido');
  }

  // Transaction level signals: gas settings and calldata come from the tx itself,
  // not from the event.
  const txCache = new Map<string, {gasPrice: bigint; gas: bigint; input: `0x${string}`}>();
  for (const entry of logs) {
    // Only pending logs carry a null hash, and the ranges queried here are
    // already mined, but the guard keeps the types honest.
    const hash = entry.transactionHash;
    if (hash === null || txCache.has(hash)) continue;
    const tx = await client.getTransaction({hash});
    txCache.set(hash, {
      gasPrice: tx.gasPrice ?? tx.maxFeePerGas ?? 0n,
      gas: tx.gas,
      input: tx.input,
    });
  }

  const participants = new Set<Address>(logs.map((l) => l.args.participant as Address));
  const funders = await scanFunding(client, participants, options.fromBlock);

  const rows: HeartbeatRow[] = [];
  for (const entry of logs) {
    const hash = entry.transactionHash;
    const tx = hash === null ? undefined : txCache.get(hash);
    const {participant, cohort, round, challengeBlock, responseBlock} = entry.args;
    if (!tx || participant === undefined) continue;

    rows.push({
      wallet: participant,
      cohort: Number(cohort ?? 0),
      round: Number(round ?? 0),
      challenge_block: Number(challengeBlock ?? 0n),
      response_block: Number(responseBlock ?? 0n),
      gas_price: Number(tx.gasPrice),
      gas_limit: Number(tx.gas),
      calldata_hash: keccak256(tx.input),
      funder: funders.get(participant.toLowerCase()) ?? '',
    });
  }

  rows.sort((a, b) => (a.wallet === b.wallet ? a.round - b.round : a.wallet < b.wallet ? -1 : 1));
  // `detector/data/` is gitignored, so on a fresh clone it does not exist and the
  // write fails with ENOENT after all the chain reading is already done.
  mkdirSync(dirname(options.out), {recursive: true});
  writeFileSync(options.out, JSON.stringify({heartbeats: rows}, null, 2));

  const withFunder = rows.filter((r) => r.funder !== '').length;
  log(`wallets: ${participants.size}, filas: ${rows.length}`);
  log(`con financiador identificado: ${withFunder}/${rows.length}`);
  log(`escrito en ${options.out}`);
}

/**
 * Monad caps `eth_getLogs` at a 100-block range and answers a wider one with
 * `-32614`. At 300 ms per block that is only 30 seconds of history, so even a
 * single qualification window (150 blocks) has to be fetched in chunks.
 */
const LOG_RANGE_LIMIT = 100n;

/** Single typed range query. Keeps the ABI inference that chunking would erase. */
async function getHeartbeatRange(
  client: PublicClient,
  address: Address,
  fromBlock: bigint,
  toBlock: bigint,
) {
  return client.getContractEvents({
    address,
    abi: heartbeatAbi,
    eventName: 'Heartbeat',
    fromBlock,
    toBlock,
  });
}

type HeartbeatLogs = Awaited<ReturnType<typeof getHeartbeatRange>>;

async function fetchHeartbeatsChunked(
  client: PublicClient,
  address: Address,
  fromBlock: bigint,
): Promise<HeartbeatLogs> {
  const latest = await client.getBlockNumber();
  const collected: HeartbeatLogs = [];

  for (let start = fromBlock; start <= latest; start += LOG_RANGE_LIMIT) {
    const candidate = start + LOG_RANGE_LIMIT - 1n;
    const end = candidate > latest ? latest : candidate;
    collected.push(...(await getHeartbeatRange(client, address, start, end)));
  }

  return collected;
}

/** Reconstructs who funded each participant by scanning native transfers. */
async function scanFunding(
  client: PublicClient,
  participants: ReadonlySet<Address>,
  fromBlock: bigint,
): Promise<Map<string, string>> {
  const wanted = new Set([...participants].map((a) => a.toLowerCase()));
  const funders = new Map<string, string>();
  const latest = await client.getBlockNumber();

  // Funding happens before enrolment, so look a little further back. Kept modest
  // on purpose: each block is one `getBlock` with full transactions, and the
  // public RPC allows only 15 to 25 requests per second.
  const start = fromBlock > 300n ? fromBlock - 300n : 0n;
  log(`buscando linaje de fondeo en los bloques ${start}..${latest}`);

  // Small batches rather than one request at a time, and well under the batch
  // limit of the public endpoints.
  const BATCH = 8;
  for (let n = start; n <= latest; n += BigInt(BATCH)) {
    const numbers: bigint[] = [];
    for (let k = 0; k < BATCH && n + BigInt(k) <= latest; k++) numbers.push(n + BigInt(k));

    const blocks = await Promise.all(
      numbers.map((blockNumber) => client.getBlock({blockNumber, includeTransactions: true})),
    );

    for (const block of blocks) {
      for (const tx of block.transactions) {
        if (typeof tx === 'string') continue;
        if (tx.to === null || tx.value === 0n) continue;
        const to = tx.to.toLowerCase();
        if (!wanted.has(to) || funders.has(to)) continue;
        funders.set(to, tx.from.toLowerCase());
      }
    }
  }

  return funders;
}

function log(message: string): void {
  process.stdout.write(`[export] ${message}\n`);
}
