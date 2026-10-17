import { keccak256 } from "viem";

/**
 * Identity commitment for claiming and redeeming a ticket.
 *
 * In production the nullifier is a zero-knowledge nullifier derived from a
 * government document, so an adversary cannot field ten thousand real
 * identities, and only the nullifier ever reaches the chain.
 *
 * The deployed `DemoIdentityVerifier` is explicitly NOT SOUND AND NOT PRIVATE:
 * it merely checks that the caller can present the preimage of the bound
 * nullifier over a gate challenge. It exists so the redemption flow is runnable
 * end to end, and must be replaced before any real use. The interface says so
 * where a user can see it.
 *
 * Shape required by the verifier:
 *
 *   nullifier = keccak256(secret)          with secret a 32-byte value
 *   proof     = abi.encode(secret)         which for one bytes32 is the 32 bytes
 *
 * Losing the secret means the ticket can never be redeemed, so it is persisted
 * and never silently overwritten.
 */

export interface IdentitySecret {
  readonly secret: `0x${string}`;
  readonly nullifier: `0x${string}`;
  readonly createdAt: number;
}

const STORAGE_KEY = "styx:identity";
const HISTORY_KEY = "styx:identity:history";

function toHex32(bytes: Uint8Array): `0x${string}` {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return `0x${out}`;
}

export function generateIdentity(): IdentitySecret {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const secret = toHex32(bytes);

  return {
    secret,
    // The verifier computes keccak256(abi.encodePacked(secret)); for a lone
    // bytes32 that is the hash of the 32 bytes, so hashing the value matches.
    nullifier: keccak256(secret),
    createdAt: Date.now(),
  };
}

function parseIdentity(raw: string): IdentitySecret | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Partial<IdentitySecret>;
    if (typeof candidate.secret !== "string" || typeof candidate.nullifier !== "string") {
      return null;
    }
    return {
      secret: candidate.secret as `0x${string}`,
      nullifier: candidate.nullifier as `0x${string}`,
      createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : 0,
    };
  } catch {
    return null;
  }
}

export function loadIdentity(): IdentitySecret | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === null ? null : parseIdentity(raw);
}

/**
 * Persists an identity, archiving any previous one first.
 *
 * Overwriting a secret that is already bound to a claimed ticket would make that
 * ticket permanently unredeemable, so the old value is appended to a history
 * list rather than discarded.
 */
export function saveIdentity(identity: IdentitySecret): void {
  if (typeof window === "undefined") return;

  const existing = loadIdentity();
  if (existing !== null && existing.secret !== identity.secret) {
    const rawHistory = window.localStorage.getItem(HISTORY_KEY);
    const history: unknown = rawHistory === null ? [] : JSON.parse(rawHistory);
    const list = Array.isArray(history) ? history : [];
    list.push(existing);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
}

/** Returns the stored identity, creating and persisting one on first use. */
export function ensureIdentity(): IdentitySecret {
  const existing = loadIdentity();
  if (existing !== null) return existing;

  const created = generateIdentity();
  saveIdentity(created);
  return created;
}

/** Proof accepted by `DemoIdentityVerifier`: the raw 32-byte secret. */
export function proofFor(identity: IdentitySecret): `0x${string}` {
  return identity.secret;
}
