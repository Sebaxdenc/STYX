# AGENTS.md

Conventions and binding constraints for humans and coding agents working in
this repository.

Read [README.md](./README.md) for the problem and
[ARCHITECTURE.md](./ARCHITECTURE.md) for the design before writing code. This
file is the operational rulebook, not a summary of either.

---

## Project in one paragraph

STYX allocates high-demand event tickets through an onchain qualification
window followed by a verifiable lottery, and identifies coordinated bot swarms
by analysing transaction timing data that the chain records natively. It runs on
Monad because 300 ms blocks provide the temporal resolution the detection
depends on. The project does not claim to detect bots; it detects coordination.

---

## Stack and layout

```
contracts/    Solidity, Foundry
indexer/      TypeScript, viem        onchain events to feature matrix
detector/     Python                  clustering and statistics
web/          TypeScript, Next.js     demo and swarm visualisation
```

Python is used for the detector because the clustering and statistical work
depends on `networkx`, `scikit-learn` and `scipy`. Do not reimplement it in
TypeScript to reduce stack count.

### Contracts

| Contract | Responsibility |
|---|---|
| `Caronte` | Enrolment, refundable bond, partial forfeit on abandonment |
| `Obolo` | Challenge issuance, heartbeat verification, vigil score |
| `Laquesis` | Verifiable random allotment, capped weighting. Immutable once a sale opens |
| `Eliseo` | Ticket issuance, identity-bound redemption, official return channel |
| `Argos` | Cluster commitments, challenge game, bond slashing |

Names come from the Greek underworld and are domain vocabulary, not decoration.
Keep them. Use English for all code, comments and documentation; the module
names stay as they are.

---

## Commands

```
# contracts
cd contracts && forge build
cd contracts && forge test -vvv
cd contracts && forge test --gas-report      # required before changing capacity claims
cd contracts && forge fmt

# indexer
cd indexer && npm install && npm run build && npm test

# detector
cd detector && pip install -r requirements.txt && pytest

# web
cd web && npm install && npm run build
```

Never start long-running processes such as `npm run dev`, watch modes, or a
local node left in the foreground. Use single-run flags.

---

## Network configuration

Canonical values. Do not hardcode anything not listed here without checking
`https://docs.monad.xyz/ai/current-facts` first.

| Network | Chain ID | RPC | Explorer |
|---|---|---|---|
| Monad Mainnet | 143 | `https://rpc.monad.xyz` | MonadVision, Monadscan |
| Monad Testnet | 10143 | `https://testnet-rpc.monad.xyz` | MonadVision, Monadscan |

Native currency `MON`. Testnet faucet `https://faucet.monad.xyz`.

Performance figures used in documentation: 300 ms block time, 300 ms
speculative finality, 600 ms finality, 150M block gas limit, 500M gas/s, 30M
per-transaction gas limit, 10,000+ TPS design capacity.

Never deploy to mainnet from automation. Testnet only unless a human explicitly
asks otherwise.

---

## Design invariants

These are not style preferences. Violating one is a design regression, and a
pull request that does so should be rejected even if tests pass.

**1. No personal data on chain or on IPFS. Ever.**
Only commitments, nullifiers and pseudonymous addresses. No IP addresses, no
device fingerprints, no document data. Encrypting does not make it acceptable:
a contract cannot read ciphertext, and a key placed on chain is published.

**2. Prefer relative signals over absolute thresholds.**
All detection logic is public, so a fixed threshold is a specification for
evading it. A new signal must compare a participant against the population, not
against a constant. If you cannot express it that way, justify the exception in
the pull request. See the core design law in ARCHITECTURE.md section 1.

**3. Detection modulates weight. It never silently excludes.**
Every cluster finding must reduce lottery weight and open a challenge, with an
appeal path and published exclusion rates. No code path may deny participation
on an automated score alone.

**4. No hot storage slot in any high-frequency path.**
A single shared counter incremented by every heartbeat serialises the entire
block under optimistic parallel execution. Prefer emitting events and deriving
totals off chain. If a counter is unavoidable, shard it and sum on read.

**5. The permissionless path always exists.**
Participation must never require passing through an interface, relayer or
attester that the project controls. Attested paths may offer better terms; they
may not be mandatory.

**6. No single trusted party on the critical path.**
Where offchain data is genuinely required, use `k`-of-`n` signed attestations
committing a hash. A relayer may censor but must never be able to forge, and
self-submission must remain available.

**7. `Laquesis` is immutable once a sale opens.**
No proxy, no upgrade path, no admin function that can influence a draw.
Privileged functions elsewhere sit behind a timelock.

**8. Assume the adversary has read this repository.**
Security must not depend on any detail being secret. If a mechanism only works
while undocumented, it does not work.

**9. Do not expand OWASP claims.**
The mapping in ARCHITECTURE.md is deliberately narrow. Do not add categories to
documentation, marketing copy or interface text without a concrete technical
justification tied to a specific control.

**10. Do not weaken the honesty sections.**
The limitations and rejected-approaches sections exist to prevent rediscovering
dead ends and to keep claims defensible. Extend them; do not trim them.

---

## Coding conventions

### Solidity

- Target the Solidity version pinned in `foundry.toml`. Do not float it.
- Custom errors, not revert strings.
- Checks, then effects, then interactions. Reentrancy guards on claim, refund
  and slashing paths.
- Validate every input: round index, deadline, phase, signature, caller.
- Explicit phase state machine. No implicit transitions driven by timestamps
  alone.
- EIP-712 for all signed payloads, with a domain separator including chain ID
  and contract address. Nonces or block binding on anything replayable.
- Never use `block.timestamp` where a block number is the correct unit.
  Heartbeat latency is measured in blocks.
- `immutable` and `constant` wherever possible; storage costs matter at this
  transaction volume.
- Emit an event for every state change the indexer or detector needs. The event
  schema is a public interface; changing it is a breaking change.

### TypeScript

- Strict mode. No `any`. `viem` for chain access, not `ethers`.
- Indexer must be deterministic and resumable: given the same block range it
  produces the same feature matrix.

### Python

- Type hints on public functions. `ruff` for linting, `black` for formatting.
- The detector must be reproducible: fixed random seeds, pinned dependency
  versions, and a committed ruleset file. A third party must be able to rerun it
  on the published dataset and obtain the identical cluster assignment. This is
  a correctness requirement, not a nicety, because reproducibility is what the
  challenge game verifies.

---

## Testing requirements

- Every contract needs unit tests for the happy path, every revert condition,
  and phase boundary behaviour.
- Fuzz the allotment: for any participant set and randomness, assert
  `tickets_issued <= inventory` and at most one allocation per qualified
  identity.
- Test the adversary explicitly. A test suite that only proves honest
  participants succeed is incomplete. Include a swarm simulation and assert that
  the detector clusters it, including a jittered variant.
- Run `forge test --gas-report` and update ARCHITECTURE.md section 4 whenever
  heartbeat gas cost changes. The capacity numbers there are estimates flagged
  for replacement with measured values.

---

## Do not build

Rejected with reasoning in ARCHITECTURE.md section 6. Do not reintroduce:

IP collection or geolocation. Device or browser fingerprinting. Click, mouse or
keystroke telemetry. Hash-based or memory-hard client puzzles as a bot defence.
Machine learning inference inside a contract. Any secret risk or dangerousness
score. Absolute timing thresholds as rules. A virtual waiting room as an
allocation mechanism. Personal data storage of any kind, anywhere.

A client puzzle is acceptable in exactly one place: edge rate limiting to keep
the RPC proxy and frontend available during a demand spike, labelled as a rate
limiter and never presented as a bot defence.

---

## Factual claims

This project's credibility rests on its numbers being correct.

- Monad network and performance figures: verify against
  `https://docs.monad.xyz/ai/current-facts`, which explicitly supersedes older
  blog posts and model memory.
- OWASP category names and numbering: the web Top 10 is the **2025** edition and
  the Smart Contract Top 10 is the **2026** edition. Category names changed
  between editions; check before citing.
- Gas and capacity figures: measure with `forge test --gas-report`. Do not
  propagate an estimate as a measurement.
- Cite a source for any external claim, and paraphrase rather than quote.

If you cannot verify a number, write that it is unverified rather than
presenting a plausible value.

---

## Commits and pull requests

- Conventional commit prefixes: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`,
  `chore:`. Scope by package, for example `feat(contracts): ...`.
- Imperative mood, present tense, no trailing period.
- Never commit to `main`. Branch, then open a pull request.
- A pull request that touches detection logic must state which design invariant
  governs the change and, if a new signal is added, whether it is relative or
  absolute and why.
- Never commit secrets, private keys or `.env` files. Deployment keys come from
  the environment.
- No emojis in code, comments, documentation or commit messages.
