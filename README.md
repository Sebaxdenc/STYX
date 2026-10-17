# STYX

Fair allotment protocol for high-demand ticket sales, built on Monad.

STYX replaces the opaque first-come-first-served queue with a public, verifiable
process: participants qualify over a long window, tickets are assigned by
verifiable lottery, and coordinated bot swarms are identified by analysing data
the blockchain records natively.

---

## The problem

When tickets for a major event go on sale, platforms put a hundred thousand
people into a virtual queue and sell in order of arrival. This is not a flawed
implementation of a good idea. It is a flawed idea.

**First-come-first-served rewards speed.** The winner of a latency race is
whoever has the lowest round-trip time and the most parallel sessions. A bot
operator with co-located infrastructure and ten thousand wallets beats a person
with a browser every single time. No amount of queue engineering changes this,
because the mechanism itself is the vulnerability.

**The queue is opaque.** A user sees a spinner and an estimated position. There
is no way to verify that the position is real, that the ordering was honest, or
that inventory was not allocated elsewhere before the sale opened.

**CAPTCHA is not the defence the industry treats it as.** OWASP catalogues
CAPTCHA circumvention as its own automated threat, OAT-009. Human solving farms
are a commodity service priced at roughly one US dollar per thousand
resolutions. A defence built on puzzle difficulty has a published price list.

**Device and network fingerprinting are a commodity arms race.** Anti-detect
browsers are sold specifically to spoof Canvas, WebGL and User-Agent values and
to isolate each wallet as though it were a separate device. Studies of
residential proxy traffic have found IP reputation checks evaded in the large
majority of sessions. Defences that depend on the client reporting the truth
fail, because the client is controlled by the attacker.

The result is the status quo: scalpers acquire inventory in the opening seconds
and resell at a large multiple, while the platform publishes bot-blocking
statistics that nobody can verify.

---

## The solution

STYX changes what is being measured. Instead of asking "is this request from a
human?", which is unanswerable, it asks two questions that can be answered with
evidence:

**1. Did this identity sustain a real cost over time?**

Qualification happens across a long window, not in a race. Participants post a
refundable bond and submit periodic signed heartbeats in response to challenges
derived from recent block hashes, so responses cannot be precomputed. Tickets
are then assigned among qualified participants by verifiable random selection,
weighted by participation with a cap.

Because allocation is a lottery rather than a race, **being fast gains nothing**.
There is no transaction to win, no ordering to exploit, and nothing to
front-run. The bond does not identify bots; it bounds how many identities an
attacker can field, which is what keeps a lottery from being trivially
sybil-attacked.

**2. Are these identities acting independently, or are they coordinated?**

This is where the design differs from everything else in the space. An
individual automated participant is indistinguishable from a person. A swarm of
ten thousand is not, because coordination leaves correlated traces.

The precedent is public. In 2026 CrowdSec documented a cluster of roughly
75,000 IP addresses spread across 230 network blocks and 43 countries, all
operated by a single actor. Every individual request looked legitimate. The
cluster was exposed by comparing requests against each other: traffic peaked at
implausible local hours and correlated tightly across time zones thirteen hours
apart, because the whole swarm ran on one clock; every node reported an
identical viewport inconsistent with the devices it claimed to be; and every
node reported a software renderer that the claimed hardware would never use.

STYX applies the same reasoning to data the chain already stores. Participation
requires transactions, and every transaction is permanently recorded with its
block and position. The resulting per-wallet time series are analysed for
coordination: response latency distributions, inter-wallet correlation, block
co-occurrence, funding lineage, and encoding fingerprints.

### The structural advantage

In a web application, defences live in the client and the attacker bypasses
them by calling the API directly. That is the fundamental reason conventional
bot mitigation loses.

In STYX there is no privileged client to bypass. The contract is the API, it is
public and permissionless, and every defence is enforced inside it.
Participating and being observed are the same action.

```
Web application:  participating  !=  being observed    attacker opts out
STYX:             participating  ==  being observed    no opt-out exists
```

---

## Why Monad

Monad mainnet produces a block every 300 ms with deterministic finality in
600 ms and a design capacity above 10,000 TPS.

**Temporal resolution is the point.** The coordination analysis depends on
measuring how long each wallet took to respond. On a chain with 12-second
blocks, a person taking two seconds and a script taking fifty milliseconds land
in the same block and are therefore indistinguishable. At 300 ms the difference
is visible. On a slow chain this analysis is not degraded, it is impossible, and
the signal is lost to block rounding.

**Throughput is a fairness requirement, not a performance preference.** If the
chain congests, fees spike and the queue becomes a fee auction, which the
best-funded participant wins. Sustained heartbeats from a hundred thousand
participants, plus an attacker's burst traffic, must be absorbed without the gas
market becoming the filter that decides who gets a ticket.

**Deterministic finality without a trusted sequencer.** The product is the
credibility of the fairness claim. If one party controls transaction ordering,
the queue is only as fair as that party, and nothing has been solved.

Detailed reasoning, including which components genuinely require Monad and
which would run on any EVM chain, is in [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## What we claim, and what we do not

Stating the limits is part of the design, not a disclaimer.

**What STYX claims**

- Allocation is verifiably random among qualified participants. Anyone can
  recompute the draw from public data.
- Speed confers no advantage, by construction.
- Fielding many identities has a real and linear cost.
- Coordination between identities is detectable, and the detection is
  reproducible by any third party because both the data and the rules are
  public.

**What STYX does not claim**

- We do not detect bots. We detect **coordination**. A single sophisticated
  automated participant that behaves independently is not distinguishable from
  a person, and we do not pretend otherwise.
- We do not solve sybil resistance. We price it. An adversary with sufficient
  capital can obtain a proportional share.
- A person paid to buy tickets is an economic bot that no proof of humanity
  detects. This limit applies to every system, including identity checks at a
  venue door.
- Detection is probabilistic. Cluster findings reduce lottery weight and open a
  challenge, never a silent exclusion, and an appeal path is mandatory.

---

## OWASP coverage

Claimed deliberately and narrowly. The mapping with full reasoning is in
[ARCHITECTURE.md](./ARCHITECTURE.md).

**OWASP Automated Threats to Web Applications** is the catalogue that matches
this problem directly: OAT-005 Scalping, OAT-013 Sniping, OAT-019 Account
Creation, OAT-020 Account Aggregation, OAT-021 Denial of Inventory.

**OWASP Top 10:2025**, four categories: A09 Security Logging and Alerting
Failures, A06 Insecure Design, A01 Broken Access Control, A08 Software or Data
Integrity Failures.

**OWASP Smart Contract Top 10:2026** is used as a hardening checklist, to show
that moving allocation logic into a contract does not introduce new
vulnerabilities.

Categories outside this list, such as supply chain failures or security
misconfiguration, are not addressed by this architecture and are not claimed.

---

## Repository layout

```
contracts/    Solidity contracts (Foundry)
indexer/      Event indexer, builds the per-wallet feature matrix (TypeScript)
detector/     Coordination analysis and clustering (Python)
web/          Demo interface and swarm visualisation (Next.js)
```

Contract responsibilities, named after the Greek underworld:

| Contract | Role |
|---|---|
| `Caronte` | Enrolment and refundable bond |
| `Obolo` | Vigil challenges and heartbeat records |
| `Laquesis` | Verifiable random allotment |
| `Eliseo` | Ticket issuance and official transfer channel |
| `Argos` | Cluster commitments and the challenge game |

## Network

| Network | Chain ID | RPC |
|---|---|---|
| Monad Mainnet | 143 | `https://rpc.monad.xyz` |
| Monad Testnet | 10143 | `https://testnet-rpc.monad.xyz` |

Testnet funds: `https://faucet.monad.xyz`

## Status

Early development. Built for a Monad hackathon. Not audited. Not for production
use.

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - design, threat model, detection
  pipeline, Monad-specific decisions
- [AGENTS.md](./AGENTS.md) - conventions and design invariants for contributors
  and coding agents

## Sources

- [Monad: current facts for AI agents](https://docs.monad.xyz/ai/current-facts)
- [Monad: why Monad](https://docs.monad.xyz/introduction/why-monad)
- [OWASP Automated Threats to Web Applications](https://owasp.org/www-project-automated-threats-to-web-applications/)
- [OWASP Top 10:2025](https://owasp.org/Top10/2025/)
- [OWASP Smart Contract Top 10:2026](https://scs.owasp.org/sctop10/)
- [CrowdSec: one operator, 75,000 IPs, 43 countries](https://www.crowdsec.net/blog/the-paperphone-cluster-one-operator-80k-ips-43-countries)
- [BleepingComputer: residential proxies evaded IP reputation checks in 78 percent of 4B sessions](https://www.bleepingcomputer.com/news/security/residential-proxies-evaded-ip-reputation-checks-in-78-percent-of-4b-sessions/)

Content from external sources has been paraphrased for compliance with
licensing restrictions.
