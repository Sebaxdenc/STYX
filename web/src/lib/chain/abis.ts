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
