# Architecture

Design document for STYX. Covers the threat model, the allocation mechanism,
the coordination detection pipeline, and the Monad-specific engineering
decisions.

Read [README.md](./README.md) first for the problem statement.

---

## 1. Threat model

### Adversary capabilities

We assume a well-funded, technically competent adversary who can:

- Create an unlimited number of wallets at negligible cost.
- Deploy smart contracts, including wallets that batch several actions
  atomically in a single transaction.
- Rent arbitrary cloud compute and memory on demand.
- Route traffic through residential proxy networks, defeating IP reputation.
- Spoof browser and device fingerprints using commodity anti-detect browsers.
- Buy human CAPTCHA solving at roughly one dollar per thousand resolutions.
- Submit transactions directly to any public RPC or their own node, bypassing
  any interface we control.
- **Read all of our code, including the detection logic**, because it is public.
- Add randomised jitter to timing to frustrate naive analysis.

### What we defend against

Coordinated mass acquisition of inventory by a single operator controlling many
identities. This is the economically significant attack and the one that
produces the observed market failure.

### What we explicitly do not defend against

- A single sophisticated automated participant behaving independently. It is
  not distinguishable from a person, and claiming otherwise would be false.
- Humans paid to acquire tickets. An economic bot defeats every proof of
  personhood, including a physical identity check at a venue door.
- An adversary accepting a proportional share. Capital buys proportional
  participation; it does not buy the whole inventory.

### Core design law

> **Absolute signals can be satisfied locally. Relative signals cannot.**

Because the contract is public, any rule with a fixed threshold is a
specification for evading it. A rule such as "the gap between two actions must
exceed five seconds" is defeated by one line of code, at zero cost.

A relative signal compares a participant against the population. An adversary
cannot verify locally whether they are passing, because passing depends on the
behaviour of a hundred thousand participants they do not control. This is why
the detection pipeline is built on inter-wallet correlation and distributional
comparison rather than per-wallet thresholds, and why **publishing the entire
algorithm does not break it**.

Every signal added to this system must be justified against this law.

---

## 2. Allocation mechanism

Four phases. Each removes a different resource from the adversary: capital,
concurrency, speed, and liquidity.

### Phase 1: Enrolment (`Caronte`)

An open window of hours or days. A participant posts a refundable bond and is
enrolled. Arriving early confers no advantage, which eliminates the demand
spike at the opening instant by construction.

The bond is not a bot filter. Its function is to **bound the number of
identities an adversary can field**, which is what prevents the lottery in
Phase 3 from being trivially sybil-attacked. For an honest participant the bond
is returned, so the real cost is temporary liquidity. For an adversary it is
capital multiplied by identity count.

A partial forfeit applies to identities that qualify and are then abandoned,
which prevents enrolling at scale and walking away.

### Phase 2: Vigil (`Obolo`)

A window of roughly twenty minutes containing six to ten challenges issued at
unpredictable moments.

```
At block N:   challenge = keccak256(blockhash(N), eventId, round)
Response deadline: block N + k   (k chosen so the window is a few seconds)
```

The challenge derives from a recent block hash, so it cannot be precomputed. A
response is a signed, timely transaction. Each valid response increments the
participant's vigil score.

The heartbeat is deliberately cheap to verify: an ECDSA signature and a block
number comparison. Heavy client puzzles were evaluated and rejected, see
section 6.

The vigil produces the per-wallet timing series that Phase 5 analyses. This is
its primary purpose. The cost it imposes is secondary and modest.

### Phase 3: Allotment (`Laquesis`)

At the close of the vigil, winners are selected from all qualified participants
using verifiable randomness, weighted by vigil score with a cap:

```
weight = min(vigilScore, CAP)
```

The cap is deliberate. Participation must count, but the draw must not become
an auction won by whoever commands the most machines.

No transaction races here. Selection happens inside the contract, so latency
confers no advantage, there is no ordering to exploit, and there is nothing to
front-run.

`Laquesis` is immutable once a sale opens.

### Phase 4: Issuance and official channel (`Eliseo`)

Tickets are issued as NFTs bound to the qualifying identity.

**Transfer restriction alone is insufficient and we do not rely on it.** An
operator can sell the wallet rather than the token: the private key changes
hands, the token never moves, and a transfer restriction never triggers. With
ERC-6551 token bound accounts or a multisig, that sale is atomic and
trustless. EIP-7702 further allows an EOA to delegate execution to contract
code while keeping its address.

The correct control is therefore at **redemption**, not transfer:

```
Bearer model  (broken):   whoever holds the key enters
Entitlement model (used):  whoever proves the bound identity enters
```

Admission requires a fresh proof tied to the identity bound at issuance, over a
challenge issued at the gate, which also prevents proof replay. Once redemption
is identity-bound, transferability of the wallet becomes irrelevant rather than
being the hole in the design.

Supporting measures:

- Require EOA custody at claim and at redemption (`code.length == 0`, no
  delegation designator). Checked at redemption, not only at mint, because
  delegation can be added later. This removes the atomic account-sale path and
  forces plain key handoff, which carries counterparty risk in both directions.
- Provide an official return channel that is strictly better than a grey market
  sale: instant, guaranteed, with no counterparty risk, and a waiting list that
  reassigns returned tickets automatically. The grey market is defeated on
  product quality, not only by prohibition.

Optional per-event policy, chosen by the organiser:

- Identity tier: proof of document uniqueness via a zero-knowledge nullifier.
  Only the nullifier is stored; no document data leaves the user's device and no
  personal data is written on chain. An adversary cannot field ten thousand real
  documents.
- Named transfer: a ticket may be ceded to one named person who then binds their
  own identity, with a cap on the number of times. This preserves gifting while
  preventing a market from forming.

---

## 3. Coordination detection pipeline

The central component. It analyses data the chain records natively. No IP
addresses, no TLS fingerprints, no device fingerprints, no edge telemetry, no
personal data.

### Why onchain data is sufficient here

Participation requires transactions, and transactions are permanently recorded
with block number and intra-block position. Unlike a web application, there is
no path by which an adversary participates without producing the record.

### Pipeline

```
Obolo emits heartbeat events        (wallet, round, block, position)
          |
indexer builds the feature matrix   one row per wallet
          |
detector computes pairwise similarity and clusters
          |
Argos commits the result            Merkle root + ruleset CID
          |
challenge window                    anyone recomputes and disputes
```

The model runs off chain and the result is committed on chain with an optimistic
challenge window. This is the opML pattern. Running inference inside a contract
is not viable and is not attempted, see section 6.

### Feature matrix

For wallet `i` and round `r`, latency is measured in blocks, which on Monad
means 300 ms granularity:

```
latency[i][r] = response_block - challenge_block
```

| Feature | Signal | Relative |
|---|---|---|
| Latency vector across rounds | Response timing per wallet | yes |
| Latency mean, standard deviation, skew | Human variance against machine regularity | yes |
| Pairwise latency correlation | Shared scheduler, the single clock signal | yes |
| Block co-occurrence rate | Wallets acting on the same tick | yes |
| Funding lineage | Common funder address | yes |
| `gasPrice` and `gasLimit` exact match | Shared library defaults | yes |
| Calldata hash and ABI encoding quirks | Shared client implementation | yes |
| Nonce progression pattern | Batch provisioning | yes |
| Funded-to-enrolled interval | Automated provisioning sequence | yes |
| Published-to-claim interval | Reaction to winning | yes |

Expected separation:

| | Latency mean | Variance | Inter-wallet correlation |
|---|---|---|---|
| Independent participants | 4 to 8 blocks | high | low |
| Coordinated swarm | 1 to 2 blocks | near zero | high |

### Clustering

1. Compute pairwise similarity over latency vectors, using Pearson correlation,
   combined with exact-match indicators for gas parameters, funder and calldata
   hash.
2. Build a similarity graph, adding an edge above a combined threshold.
3. Run community detection, Louvain or connected components.
4. Score each cluster by size, internal density, and implausibility.

The method is **unsupervised**, which matters: there is no labelled bot training
data, none is needed, and the objective is coordination rather than a notion of
"botness" that cannot be defined.

### Robustness to jitter

An adversary adding randomised per-wallet jitter reduces pairwise correlation.
Two responses:

- If the jitter is generated on shared infrastructure, the **distribution**
  remains common across wallets even when individual series decorrelate. A
  two-sample Kolmogorov-Smirnov test compares distributions rather than
  sequences.
- Population entropy detects both failure modes. A real population follows a
  long-tailed distribution. A swarm is either too uniform or uniformly random,
  and uniform randomness is itself anomalous because real populations are not
  uniform.

Adding jitter also forces the adversary away from optimal response timing.

### Enforcement policy

Non-negotiable:

- A cluster finding **reduces lottery weight and opens a challenge**. It never
  silently excludes.
- An appeal path is mandatory, and exclusion rates are published.
- The ruleset and the dataset are published, pinned by CID and committed on
  chain before the sale opens, so any third party can reproduce the result.
- Anyone may challenge a cluster assignment, or challenge a wallet, by posting a
  bond and publishing evidence. The losing side is slashed. Detection is a
  market with incentives, not a private policy.

An automated score that denies access carries obligations under GDPR Article 22,
including human involvement, explanation and contest. The challenge-and-appeal
design is how those obligations are met, and it is also what distinguishes this
from the opaque scoring it replaces.

---

## 4. Monad-specific design

Canonical network figures, from Monad documentation:

| Metric | Value |
|---|---|
| Block time | 300 ms |
| Speculative finality | 300 ms, one slot |
| Finality | 600 ms, two slots |
| Throughput | 10,000+ TPS design capacity |
| Block gas limit | 150M gas |
| Gas throughput | 500M gas/s |
| Per-transaction gas limit | 30M gas |

### Temporal resolution for forensics

The detection pipeline measures response latency. Block time sets the
resolution of that measurement.

| Chain | Block time | Human at 2 s against script at 50 ms |
|---|---|---|
| 12-second blocks | 12 s | Same block, indistinguishable |
| Monad | 300 ms | Approximately 40 times finer, distinguishable |

On a slow chain this analysis is not weaker, it is impossible: the signal is
lost to block rounding. This is the primary reason the project targets Monad.

### Capacity

Estimates to be replaced by measured values from `forge test --gas-report`.

Assume a direct heartbeat costs approximately 45,000 gas (21,000 base, calldata,
one storage write, one event, verification).

```
Per block:    150M / 45k            = ~3,300 heartbeats
Per second:   3,300 / 0.3 s         = ~11,000 heartbeats/s

Load, 100k participants at one heartbeat per 12 s:
              100,000 / 12          = ~8,300 heartbeats/s
Gas:          8,300 x 45k           = ~375M gas/s   = ~75% of capacity
```

75 percent of network gas throughput is feasible but inconsiderate and leaves no
headroom, so the **default path is aggregated**. Participants sign EIP-712
attestations and permissionless relayers submit batches, with signatures
verified on chain:

```
Per heartbeat, batched (ecrecover 3k + storage 5k + calldata, base amortised):
              ~9,600 gas
Gas:          8,300 x 9,600         = ~80M gas/s    = ~16% of capacity
```

A relayer can censor but cannot forge, and the direct self-submission path
always remains available as the censorship fallback.

### Parallel execution and state layout

Heartbeats write only to the submitting participant's own slot, which makes
writes disjoint and ideal for optimistic parallel execution.

**A naive global counter destroys this.** If every heartbeat executes
`totalVigils++`, every transaction touches the same slot, every transaction
conflicts with every other, and the engine falls back to serial re-execution.
Throughput collapses from thousands of transactions per second to hundreds.

Rules for any high-frequency path:

1. Preferred: **maintain no global counter during the vigil.** Emit events and
   derive totals off chain, or compute them at allotment time. The enrolled
   count is already known when enrolment closes.
2. If a counter is unavoidable, shard it and sum on read in a view function:

```solidity
uint256[256] private totalVigils;
totalVigils[uint8(uint160(msg.sender))] += 1;
```

Bucket count is a tuning parameter. Raise it if contention is measured.

### Finality without a trusted sequencer

The product is the credibility of the fairness claim. If a single party orders
transactions, the queue is only as fair as that party. MonadBFT reaches
deterministic finality in two 300 ms slots with a decentralised validator set,
so the claim that a draw was fair does not rest on trusting the operator.

### Honest attribution

| Component | Requires Monad |
|---|---|
| Refundable bond | No, any EVM chain |
| Verifiable random allotment | No, any EVM chain |
| Identity-bound redemption | No, any EVM chain |
| **Latency-based coordination detection** | **Yes, needs sub-second block time for resolution** |
| **100k concurrent participants** | **Yes, needs roughly 10,000 TPS sustained** |
| **Fairness under adversarial burst traffic** | **Yes, requires that no gas auction forms** |

Three of six components genuinely require Monad, and they are the three novel
ones. Overstating this damages credibility.

---

## 5. Privacy and data rules

Binding constraints, not preferences.

- **No personal data on chain, ever.** Only commitments, nullifiers and
  pseudonymous addresses. EDPB Guidelines 02/2025 state that storing personal
  data on a blockchain should be avoided where it conflicts with data protection
  principles, and that technical impossibility does not excuse failure to honour
  erasure rights. An immutable ledger and the right to erasure in GDPR
  Article 17 are incompatible by construction.
- **No personal data on IPFS.** Content pinned to IPFS is public by default and
  retrievable by anyone holding the CID, and DHT metadata is public. Encrypting
  it does not help: a contract cannot read ciphertext, and a decryption key
  placed on chain is a published key.
- **IPFS is used only for public integrity artefacts:** the published ruleset,
  the audit bundle, the challenge sets, the dataset used for a cluster finding,
  and ticket metadata. CIDs are committed on chain before a sale opens so the
  ruleset is tamper-evident.
- Offchain signals, if ever introduced, enter only as `k`-of-`n` signed
  attestations committing a hash, never raw values, and never from a single
  provider.

---

## 6. Rejected approaches

Documented so they are not reintroduced.

| Approach | Reason for rejection |
|---|---|
| IP-based detection | The EVM never sees the IP. Residential proxies evade reputation checks in the large majority of sessions. Storing IPs on chain is a permanent data protection violation. |
| Device fingerprinting | Collected client side, therefore self-reported and forgeable. Anti-detect browsers are a commodity product sold to defeat exactly this. Fingerprints are personal data. |
| Click or mouse telemetry | Clicks do not exist on chain. Any client report of human interaction is forgeable; a contract cannot verify that a person touched a screen. |
| Hash-based proof of work | Asymmetry runs the wrong way. A GPU is four to five orders of magnitude faster than a low-end phone, so difficulty calibrated to cost a phone three seconds costs the adversary a fraction of a millisecond. It is also regressive, penalising participants with cheaper hardware, which is unacceptable in a fairness product. |
| Memory-hard client puzzles, Argon2 class | Memory-hard functions are deliberately symmetric, so verification costs as much as solving. 256 MB cannot be verified in the EVM at any sane gas cost. An Equihash-class asymmetric construction would be verifiable, but the cost imposed is tens of dollars against a very large prize, and implementation expense is not justified. |
| Machine learning inference on chain | Not viable. ZKML proving overhead is super-linear and infeasible at useful model sizes. The opML pattern, off chain inference with optimistic verification, is used instead. |
| Secret risk or dangerousness score | Reconstructs the opaque gatekeeper the project exists to replace, and enters prohibited-practice territory for profiling in unrelated contexts. |
| Per-wallet purchase limits as a defence | Wallets are free and unlimited, so a per-wallet limit is no limit. Implemented because it is free and forces the adversary to spread across wallets, which is what makes clustering possible, but never presented as a defence. |
| Virtual waiting room | First-come-first-served under another name. Queue position is the prize the swarm races for. The visual metaphor is retained in the interface; the allocation mechanism is not. |
| Absolute timing thresholds, for example "registered and purchased within N blocks" | Violates the core design law. The rule is public, so it is defeated by one line of sleep, and a contract can batch both actions atomically in a single transaction. Timing intervals are retained as relative features in the matrix, never as rules. |

---

## 7. Known limitations

1. Sybil resistance is priced, not solved. Sufficient capital buys a
   proportional share.
2. Coordination detection is probabilistic. False positives are possible, which
   is why findings modulate weight and open a challenge rather than excluding.
3. A sophisticated adversary running genuinely independent infrastructure per
   identity, with independent randomness, raises the bar substantially. We catch
   the economically rational adversary, not an unbounded one.
4. Detection is an arms race requiring ongoing operation. In the CrowdSec case
   the operator began rotating addresses as soon as blocks were applied.
5. The identity tier excludes participants without a suitable document or
   device, which is why a bond tier must always remain available and why the
   permissionless path cannot be removed.
6. An individual may hand over both document and key and simply not attend. This
   is unpreventable and is the same residual risk that paper tickets with
   identity checks carry today.

---

## 8. Out of scope

Frontend and RPC denial of service protection is an operational concern handled
at the edge with conventional rate limiting, and is where a cheap client puzzle
legitimately belongs, labelled as a rate limiter rather than a bot defence.
Payment rails, venue hardware integration, and organiser onboarding are not
addressed.

## Sources

- [Monad: current facts for AI agents](https://docs.monad.xyz/ai/current-facts)
- [Monad: how Monad works](https://monad.xyz/blog/how-monad-works)
- [OWASP Top 10:2025](https://owasp.org/Top10/2025/)
- [OWASP Smart Contract Top 10:2026](https://scs.owasp.org/sctop10/)
- [OWASP Automated Threats to Web Applications](https://owasp.org/www-project-automated-threats-to-web-applications/)
- [CrowdSec: one operator, 75,000 IPs, 43 countries](https://www.crowdsec.net/blog/the-paperphone-cluster-one-operator-80k-ips-43-countries)
- [EDPB Guidelines 02/2025 on blockchain and personal data](https://www.edpb.europa.eu/documents/guideline/guidelines-022025-on-processing-of-personal-data-through-blockchain_en)
- [IPFS: pinned data is public by default](https://docs.ipfs.tech/quickstart/pin/)
- [ERC-6551 token bound accounts](https://github.com/ethereum/ERCs/blob/master/ERCS/erc-6551.md)
- [EIP-7702 EOA code delegation](https://github.com/ethereum/EIPs/blob/master/EIPS/eip-7702.md)
- [Green et al., USENIX LEET: hash reversal proof of work under GPU adversaries](http://www.usenix.org/events/leet11/tech/full_papers/Green.pdf)
- [opML: optimistic machine learning on blockchain](https://arxiv.org/pdf/2401.17555v2)

Content from external sources has been paraphrased for compliance with
licensing restrictions.
