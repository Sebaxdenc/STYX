/**
 * Turning chain errors into something a person can act on.
 *
 * Two traps documented in `.kiro/steering/monad-dev/references/frontend.md`:
 *
 * 1. viem reuses the text "Missing or invalid parameters." for both `-32602`
 *    (genuinely malformed parameters) and `-32000`, which is the generic code
 *    nodes return for ANY transaction rejection: nonce, balance, fee, reserve
 *    balance. The text alone tells you nothing.
 *
 * 2. `error.message` embeds the request URL and the whole body, burying the real
 *    reason. The reason lives in `error.details`.
 */

/** EIP-1193: the user rejected the request. Not a failure worth reporting. */
const USER_REJECTED = 4001;

interface ChainErrorShape {
  readonly code?: number;
  readonly details?: string;
  readonly shortMessage?: string;
  readonly message?: string;
  readonly cause?: {
    readonly code?: number;
    readonly details?: string;
    readonly message?: string;
  };
}

function asChainError(error: unknown): ChainErrorShape {
  if (typeof error === "object" && error !== null) {
    return error as ChainErrorShape;
  }
  return {};
}

function firstLine(text: string): string {
  const lines = text.split("\n");
  const head = lines.length > 0 ? lines[0] : undefined;
  return (head ?? text).trim().slice(0, 160);
}

export function isUserRejection(error: unknown): boolean {
  const err = asChainError(error);
  return err.code === USER_REJECTED || err.cause?.code === USER_REJECTED;
}

/** Short, human-readable reason in Spanish, safe to render in the interface. */
export function describeError(error: unknown): string {
  const err = asChainError(error);

  if (isUserRejection(error)) return "Cancelaste la transacción";

  const detail =
    err.details ?? err.cause?.details ?? err.cause?.message ?? err.shortMessage ?? err.message;

  if (detail === undefined) return "Error desconocido al enviar la transacción";

  const raw = firstLine(detail);

  // Messages measured against Monad testnet, mapped to actionable Spanish.
  if (/insufficient balance/i.test(raw)) {
    return "Saldo insuficiente. Consigue MON en el faucet de testnet";
  }
  if (/fee too low/i.test(raw)) {
    return "La comisión quedó por debajo del mínimo. Vuelve a intentarlo";
  }
  if (/nonce/i.test(raw)) {
    return "Transacciones desincronizadas. Vuelve a intentarlo";
  }
  if (/limited to a 100 range/i.test(raw)) {
    return "Se pidió demasiado historial de bloques";
  }

  return raw;
}

/**
 * Maps a decoded contract revert to copy explaining what to do next.
 *
 * Takes the error name that viem decodes from the ABI, which is why the custom
 * errors are declared in `abis.ts`.
 */
export function describeRevert(errorName: string): string | null {
  switch (errorName) {
    case "AlreadyEnrolled":
      return "Esta dirección ya está enrolada";
    case "IncorrectBond":
      return "El bono enviado no coincide exactamente con el requerido";
    case "EnrollmentWindowOver":
      return "La ventana de enrolamiento ya cerró";
    case "NotEnrolled":
      return "Esta dirección no está enrolada";
    case "AlreadyWithdrawn":
      return "El bono ya fue retirado";
    case "NotOpen":
      return "La ventana de cualificación no está abierta";
    case "ChallengeNotIssued":
      return "El reto de esta ronda todavía no se ha emitido";
    case "ResponseTooLate":
      return "La ventana de respuesta se cerró. Esta ronda se cuenta como fallada";
    case "AlreadyResponded":
      return "Ya respondiste a esta ronda";
    case "ChallengeUnverifiable":
      return "El reto ya no es verificable en la cadena";
    default:
      return null;
  }
}
