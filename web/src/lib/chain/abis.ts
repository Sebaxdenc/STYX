/**
 * Contract ABIs, declared `as const` so viem infers argument and return types.
 *
 * Written by hand from `contracts/src/*.sol` rather than generated from
 * `contracts/out/`, because Foundry is not required to build the frontend and a
 * generated artifact would add a build step for no type-safety gain. Keep these
 * in sync with the Solidity sources: the event schema is a public interface and
 * changing it is a breaking change (see AGENTS.md).
 *
 * Custom errors are included on purpose. viem decodes a revert into the error
 * name only when the ABI declares it, which is the difference between showing
 * "IncorrectBond" and showing an opaque hex string.
 */

export const enrollmentAbi = [
  // --- writes
  { type: "function", name: "enroll", inputs: [], outputs: [], stateMutability: "payable" },
  { type: "function", name: "withdrawBond", inputs: [], outputs: [], stateMutability: "nonpayable" },

  // --- views
  {
    type: "function",
    name: "isEnrolled",
    inputs: [{ name: "participant", type: "address" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "bondOf",
    inputs: [{ name: "participant", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasWithdrawn",
    inputs: [{ name: "participant", type: "address" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  { type: "function", name: "phase", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { type: "function", name: "closesAt", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "enrolledCount", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "bondAmount", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "cohortSeed", inputs: [], outputs: [{ type: "bytes32" }], stateMutability: "view" },
  { type: "function", name: "enrollmentClosed", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  {
    type: "function",
    name: "abandonmentForfeitBps",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },

  // --- events
  {
    type: "event",
    name: "Enrolled",
    inputs: [
      { name: "participant", type: "address", indexed: true },
      { name: "bond", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EnrollmentOpened",
    inputs: [
      { name: "openedAt", type: "uint256", indexed: false },
      { name: "closesAt", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EnrollmentClosed",
    inputs: [
      { name: "enrolledCount", type: "uint256", indexed: false },
      { name: "cohortSeed", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BondWithdrawn",
    inputs: [
      { name: "participant", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BondForfeited",
    inputs: [
      { name: "participant", type: "address", indexed: true },
      { name: "forfeited", type: "uint256", indexed: false },
      { name: "remaining", type: "uint256", indexed: false },
    ],
  },

  // --- custom errors
  {
    type: "error",
    name: "WrongPhase",
    inputs: [
      { name: "expected", type: "uint8" },
      { name: "actual", type: "uint8" },
    ],
  },
  { type: "error", name: "AlreadyEnrolled", inputs: [] },
  { type: "error", name: "NotEnrolled", inputs: [] },
  {
    type: "error",
    name: "IncorrectBond",
    inputs: [
      { name: "expected", type: "uint256" },
      { name: "provided", type: "uint256" },
    ],
  },
  { type: "error", name: "EnrollmentWindowOver", inputs: [] },
  { type: "error", name: "EnrollmentWindowStillOpen", inputs: [] },
  { type: "error", name: "AlreadyWithdrawn", inputs: [] },
  { type: "error", name: "TransferFailed", inputs: [] },
  { type: "error", name: "Unauthorized", inputs: [] },
] as const;

export const heartbeatRegistryAbi = [
  // --- writes
  {
    type: "function",
    name: "respond",
    inputs: [{ name: "round", type: "uint8" }],
    outputs: [],
    stateMutability: "nonpayable",
  },

  // --- views
  {
    type: "function",
    name: "cohortOf",
    inputs: [{ name: "participant", type: "address" }],
    outputs: [{ type: "uint16" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "challengeBlockOf",
    inputs: [
      { name: "cohort", type: "uint16" },
      { name: "round", type: "uint8" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "participationScore",
    inputs: [{ name: "participant", type: "address" }],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasResponded",
    inputs: [
      { name: "participant", type: "address" },
      { name: "round", type: "uint8" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "responseBits",
    inputs: [{ name: "participant", type: "address" }],
    outputs: [{ type: "uint16" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isQualified",
    inputs: [{ name: "participant", type: "address" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  { type: "function", name: "windowStartBlock", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "windowEndBlock", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "isOpen", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "challengeCount", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { type: "function", name: "cohortCount", inputs: [], outputs: [{ type: "uint16" }], stateMutability: "view" },
  { type: "function", name: "subWindowBlocks", inputs: [], outputs: [{ type: "uint32" }], stateMutability: "view" },
  {
    type: "function",
    name: "responseWindowBlocks",
    inputs: [],
    outputs: [{ type: "uint32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "minResponsesToQualify",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  { type: "function", name: "cohortSeed", inputs: [], outputs: [{ type: "bytes32" }], stateMutability: "view" },

  // --- events
  {
    type: "event",
    name: "Heartbeat",
    inputs: [
      { name: "participant", type: "address", indexed: true },
      { name: "cohort", type: "uint16", indexed: true },
      { name: "round", type: "uint8", indexed: true },
      { name: "challengeBlock", type: "uint256", indexed: false },
      { name: "responseBlock", type: "uint256", indexed: false },
      { name: "latencyBlocks", type: "uint32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "QualificationOpened",
    inputs: [
      { name: "startBlock", type: "uint256", indexed: false },
      { name: "endBlock", type: "uint256", indexed: false },
    ],
  },

  // --- custom errors
  { type: "error", name: "NotOpen", inputs: [] },
  { type: "error", name: "AlreadyOpen", inputs: [] },
  { type: "error", name: "EnrollmentNotClosed", inputs: [] },
  { type: "error", name: "WindowOver", inputs: [] },
  { type: "error", name: "NotEnrolled", inputs: [] },
  { type: "error", name: "InvalidRound", inputs: [{ name: "round", type: "uint8" }] },
  { type: "error", name: "ChallengeNotIssued", inputs: [] },
  {
    type: "error",
    name: "ResponseTooLate",
    inputs: [
      { name: "deadline", type: "uint256" },
      { name: "current", type: "uint256" },
    ],
  },
  { type: "error", name: "AlreadyResponded", inputs: [{ name: "round", type: "uint8" }] },
  { type: "error", name: "ChallengeUnverifiable", inputs: [] },
  { type: "error", name: "Unauthorized", inputs: [] },
] as const;

/** Mirrors `Enrollment.Phase`. The contract exposes it as `uint8`. */
export const EnrollmentPhase = {
  Created: 0,
  Enrolling: 1,
  Closed: 2,
  Settled: 3,
} as const;

export type EnrollmentPhaseValue =
  (typeof EnrollmentPhase)[keyof typeof EnrollmentPhase];

export const lotteryAbi = [
  // --- writes
  // All four are callable by anyone on purpose: the schedule must not depend on
  // an operator being online, and no admin input exists anywhere in the draw.
  { type: "function", name: "requestSeed", inputs: [], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "finalizeSeed", inputs: [], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "reRequestSeed", inputs: [], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "advanceRound", inputs: [], outputs: [], stateMutability: "nonpayable" },
  {
    type: "function",
    name: "claimEntitlement",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },

  // --- views
  { type: "function", name: "phase", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { type: "function", name: "seed", inputs: [], outputs: [{ type: "bytes32" }], stateMutability: "view" },
  { type: "function", name: "seedBlock", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "inventory", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "issued", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    type: "function",
    name: "remainingInventory",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  { type: "function", name: "currentRound", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  {
    type: "function",
    name: "currentRoundClosesAt",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  { type: "function", name: "roundOpen", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "isRoundOpen", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  {
    type: "function",
    name: "roundRateBps",
    inputs: [{ name: "round", type: "uint8" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "participationCap",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasEntitlement",
    inputs: [{ name: "participant", type: "address" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "wonInRound",
    inputs: [{ name: "participant", type: "address" }],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "weightOf",
    inputs: [{ name: "participant", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isSelected",
    inputs: [
      { name: "participant", type: "address" },
      { name: "round", type: "uint8" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },

  // --- events
  {
    type: "event",
    name: "SeedFinalized",
    inputs: [{ name: "seed", type: "bytes32", indexed: false }],
  },
  {
    type: "event",
    name: "RoundOpened",
    inputs: [
      { name: "round", type: "uint8", indexed: false },
      { name: "rateBps", type: "uint256", indexed: false },
      { name: "remaining", type: "uint256", indexed: false },
      { name: "closesAtBlock", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EntitlementGranted",
    inputs: [
      { name: "participant", type: "address", indexed: true },
      { name: "round", type: "uint8", indexed: false },
      { name: "issued", type: "uint256", indexed: false },
    ],
  },

  // --- custom errors
  {
    type: "error",
    name: "WrongPhase",
    inputs: [
      { name: "expected", type: "uint8" },
      { name: "actual", type: "uint8" },
    ],
  },
  { type: "error", name: "QualificationNotOver", inputs: [] },
  { type: "error", name: "SeedNotReady", inputs: [{ name: "readyAtBlock", type: "uint256" }] },
  { type: "error", name: "SeedExpired", inputs: [] },
  { type: "error", name: "NotQualified", inputs: [] },
  { type: "error", name: "AlreadyWon", inputs: [] },
  { type: "error", name: "NotSelected", inputs: [] },
  { type: "error", name: "InventoryExhausted", inputs: [] },
  { type: "error", name: "NoRoundOpen", inputs: [] },
  { type: "error", name: "RoundStillOpen", inputs: [] },
  { type: "error", name: "AllRoundsUsed", inputs: [] },
] as const;

export const ticketRegistryAbi = [
  // --- writes
  {
    type: "function",
    name: "claimTicket",
    inputs: [{ name: "nullifier", type: "bytes32" }],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "finalize",
    inputs: [{ name: "holder", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "redeem",
    inputs: [
      { name: "gateChallenge", type: "bytes32" },
      { name: "identityProof", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },

  // --- views
  {
    type: "function",
    name: "stateOf",
    inputs: [{ name: "holder", type: "address" }],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "disputeDeadline",
    inputs: [{ name: "holder", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isProvisional",
    inputs: [{ name: "holder", type: "address" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isValid",
    inputs: [{ name: "holder", type: "address" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "tokenIdOf",
    inputs: [{ name: "holder", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "claimedAt",
    inputs: [{ name: "holder", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  { type: "function", name: "activeTickets", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "priceWei", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    type: "function",
    name: "disputeWindowSeconds",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  { type: "function", name: "issued", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "revoked", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    type: "function",
    name: "tokenURI",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "string" }],
    stateMutability: "view",
  },

  // --- events
  {
    type: "event",
    name: "TicketClaimed",
    inputs: [
      { name: "holder", type: "address", indexed: true },
      { name: "nullifier", type: "bytes32", indexed: false },
      { name: "paid", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TicketRevoked",
    inputs: [
      { name: "holder", type: "address", indexed: true },
      { name: "caller", type: "address", indexed: false },
      { name: "refunded", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TicketFinalized",
    inputs: [{ name: "holder", type: "address", indexed: true }],
  },

  // --- custom errors
  { type: "error", name: "NoEntitlement", inputs: [] },
  { type: "error", name: "AlreadyClaimed", inputs: [] },
  { type: "error", name: "NotProvisional", inputs: [{ name: "actual", type: "uint8" }] },
  { type: "error", name: "NotRedeemable", inputs: [{ name: "actual", type: "uint8" }] },
  { type: "error", name: "ContractCustodyForbidden", inputs: [] },
  { type: "error", name: "DisputeWindowOpen", inputs: [{ name: "closesAt", type: "uint256" }] },
  { type: "error", name: "DisputeWindowOver", inputs: [{ name: "closesAt", type: "uint256" }] },
  {
    type: "error",
    name: "IncorrectPayment",
    inputs: [
      { name: "expected", type: "uint256" },
      { name: "provided", type: "uint256" },
    ],
  },
  { type: "error", name: "IdentityAlreadyUsed", inputs: [] },
  { type: "error", name: "EmptyNullifier", inputs: [] },
  { type: "error", name: "InvalidIdentityProof", inputs: [] },
  { type: "error", name: "TransfersRestricted", inputs: [] },
] as const;

export const clusterRegistryAbi = [
  // --- writes
  { type: "function", name: "appeal", inputs: [], outputs: [], stateMutability: "payable" },

  // --- views
  {
    type: "function",
    name: "isFlagged",
    inputs: [{ name: "participant", type: "address" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "clusterOf",
    inputs: [{ name: "participant", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "appealState",
    inputs: [{ name: "participant", type: "address" }],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "weightMultiplierBps",
    inputs: [{ name: "participant", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  { type: "function", name: "hasFinding", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  {
    type: "function",
    name: "disputeWindowOpen",
    inputs: [],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  { type: "function", name: "root", inputs: [], outputs: [{ type: "bytes32" }], stateMutability: "view" },
  // The published ruleset and dataset. Committed on chain before a sale opens so
  // a third party can recompute the finding; that reproducibility is what the
  // dispute game verifies.
  { type: "function", name: "rulesetCid", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "datasetCid", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "disputeClosesAt", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "voided", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "appealBond", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    type: "function",
    name: "FLAGGED_MULTIPLIER_BPS",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },

  // --- events
  {
    type: "event",
    name: "FindingCommitted",
    inputs: [
      { name: "root", type: "bytes32", indexed: false },
      { name: "rulesetCid", type: "string", indexed: false },
      { name: "datasetCid", type: "string", indexed: false },
      { name: "submitter", type: "address", indexed: false },
      { name: "closesAt", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WalletFlagged",
    inputs: [
      { name: "wallet", type: "address", indexed: true },
      { name: "clusterId", type: "uint256", indexed: false },
      { name: "marker", type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AppealRaised",
    inputs: [
      { name: "wallet", type: "address", indexed: true },
      { name: "bond", type: "uint256", indexed: false },
    ],
  },

  // --- custom errors
  { type: "error", name: "NoFinding", inputs: [] },
  { type: "error", name: "FindingVoided", inputs: [] },
  { type: "error", name: "NotFlagged", inputs: [] },
  { type: "error", name: "AppealAlreadyRaised", inputs: [] },
  { type: "error", name: "DisputeWindowOver", inputs: [] },
  {
    type: "error",
    name: "IncorrectBond",
    inputs: [
      { name: "expected", type: "uint256" },
      { name: "provided", type: "uint256" },
    ],
  },
] as const;

/** Mirrors `Lottery.Phase`. */
export const LotteryPhase = {
  Pending: 0,
  SeedRequested: 1,
  Drawing: 2,
  Closed: 3,
} as const;

export type LotteryPhaseValue = (typeof LotteryPhase)[keyof typeof LotteryPhase];

/**
 * Mirrors `TicketRegistry.State`, which is the on-chain half of the ownership
 * stages in ARCHITECTURE.md section 2. `Provisional` is deliberate: it is what
 * makes revoking a swarm's tickets executable after retrospective analysis.
 */
export const TicketState = {
  None: 0,
  Provisional: 1,
  Final: 2,
  Revoked: 3,
  Redeemed: 4,
} as const;

export type TicketStateValue = (typeof TicketState)[keyof typeof TicketState];

/** Mirrors `ClusterRegistry.AppealState`. */
export const AppealState = {
  None: 0,
  Pending: 1,
  Upheld: 2,
  Rejected: 3,
} as const;

export type AppealStateValue = (typeof AppealState)[keyof typeof AppealState];
