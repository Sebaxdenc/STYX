import {writeFileSync} from 'node:fs';
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

  const logs = await client.getContractEvents({
    address: deployment.heartbeatRegistry,
    abi: heartbeatAbi,
    eventName: 'Heartbeat',
    fromBlock: options.fromBlock,
    toBlock: 'latest',
  });
  log(`${logs.length} latidos encontrados desde el bloque ${options.fromBlock}`);
  if (logs.length === 0) {
    throw new Error('sin latidos: comprueba fromBlock y que la ventana haya corrido');
  }

  // Transaction level signals: gas settings and calldata come from the tx itself,
  // not from the event.
  const txCache = new Map<string, {gasPrice: bigint; gas: bigint; input: string}>();
  for (const entry of logs) {
    if (txCache.has(entry.transactionHash)) continue;
    const tx = await client.getTransaction({hash: entry.transactionHash});
    txCache.set(entry.transactionHash, {
      gasPrice: tx.gasPrice ?? tx.maxFeePerGas ?? 0n,
      gas: tx.gas,
      input: tx.input,
    });
  }

  const participants = new Set<Address>(logs.map((l) => l.args.participant as Address));
  const funders = await scanFunding(client, participants, options.fromBlock);

  const rows: HeartbeatRow[] = [];
  for (const entry of logs) {
    const tx = txCache.get(entry.transactionHash);
    const args = entry.args;
    if (!tx || args.participant === undefined) continue;

    const wallet = args.participant as Address;
    rows.push({
      wallet,
      cohort: Number(args.cohort ?? 0),
      round: Number(args.round ?? 0),
      challenge_block: Number(args.challengeBlock ?? 0n),
      response_block: Number(args.responseBlock ?? 0n),
      gas_price: Number(tx.gasPrice),
      gas_limit: Number(tx.gas),
      calldata_hash: keccak256(tx.input as `0x${string}`),
      funder: funders.get(wallet.toLowerCase()) ?? '',
    });
  }

  rows.sort((a, b) => (a.wallet === b.wallet ? a.round - b.round : a.wallet < b.wallet ? -1 : 1));
  writeFileSync(options.out, JSON.stringify({heartbeats: rows}, null, 2));

  const withFunder = rows.filter((r) => r.funder !== '').length;
  log(`wallets: ${participants.size}, filas: ${rows.length}`);
  log(`con financiador identificado: ${withFunder}/${rows.length}`);
  log(`escrito en ${options.out}`);
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

  // Funding happens before enrolment, so look a little further back.
  const start = fromBlock > 400n ? fromBlock - 400n : 0n;
  log(`buscando linaje de fondeo en los bloques ${start}..${latest}`);

  for (let n = start; n <= latest; n++) {
    const block = await client.getBlock({blockNumber: n, includeTransactions: true});
    for (const tx of block.transactions) {
      if (typeof tx === 'string') continue;
      if (tx.to === null || tx.value === 0n) continue;
      const to = tx.to.toLowerCase();
      if (!wanted.has(to) || funders.has(to)) continue;
      funders.set(to, tx.from.toLowerCase());
    }
  }

  return funders;
}

function log(message: string): void {
  process.stdout.write(`[export] ${message}\n`);
}
