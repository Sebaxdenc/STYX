/** Minimal ABI fragments. Full ABIs live in contracts/out after `forge build`. */

export const enrollmentAbi = [
  {type: 'function', name: 'enroll', inputs: [], outputs: [], stateMutability: 'payable'},
  {
    type: 'function',
    name: 'isEnrolled',
    inputs: [{name: 'participant', type: 'address'}],
    outputs: [{type: 'bool'}],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'bondAmount',
    inputs: [],
    outputs: [{type: 'uint256'}],
    stateMutability: 'view',
  },
  {type: 'function', name: 'phase', inputs: [], outputs: [{type: 'uint8'}], stateMutability: 'view'},
] as const;

export const heartbeatAbi = [
  {
    type: 'function',
    name: 'respond',
    inputs: [{name: 'round', type: 'uint8'}],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'windowStartBlock',
    inputs: [],
    outputs: [{type: 'uint256'}],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'cohortOf',
    inputs: [{name: 'participant', type: 'address'}],
    outputs: [{type: 'uint16'}],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'challengeBlockOf',
    inputs: [
      {name: 'cohort', type: 'uint16'},
      {name: 'round', type: 'uint8'},
    ],
    outputs: [{type: 'uint256'}],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'participationScore',
    inputs: [{name: 'participant', type: 'address'}],
    outputs: [{type: 'uint8'}],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'Heartbeat',
    inputs: [
      {name: 'participant', type: 'address', indexed: true},
      {name: 'cohort', type: 'uint16', indexed: true},
      {name: 'round', type: 'uint8', indexed: true},
      {name: 'challengeBlock', type: 'uint256', indexed: false},
      {name: 'responseBlock', type: 'uint256', indexed: false},
      {name: 'latencyBlocks', type: 'uint32', indexed: false},
    ],
  },
] as const;

export const lotteryAbi = [
  {
    type: 'function',
    name: 'claimEntitlement',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'isSelected',
    inputs: [
      {name: 'participant', type: 'address'},
      {name: 'round', type: 'uint8'},
    ],
    outputs: [{type: 'bool'}],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'currentRound',
    inputs: [],
    outputs: [{type: 'uint8'}],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isRoundOpen',
    inputs: [],
    outputs: [{type: 'bool'}],
    stateMutability: 'view',
  },
] as const;

export const ticketAbi = [
  {
    type: 'function',
    name: 'claimTicket',
    inputs: [{name: 'nullifier', type: 'bytes32'}],
    outputs: [],
    stateMutability: 'payable',
  },
] as const;
