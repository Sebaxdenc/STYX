/**
 * Proof that a real person acted.
 *
 * Design invariant 11 forbids answering a challenge without a human present:
 * automatic responses, auto-signing, session keys that answer by themselves, or
 * any background mode. The reason is not UX policy. If the client answers on its
 * own, the recorded latency measures the machine instead of the person, the
 * variance signal disappears, and the coordination detection that the whole
 * project rests on stops working.
 *
 * Enforcing that by convention would mean trusting every future caller to
 * remember. Instead the response path requires a token that can only be minted
 * from a trusted DOM event, so a timer, an effect, or a retry loop has no way to
 * construct one. The compiler rejects the call rather than a reviewer catching it.
 *
 * `isTrusted` is false for events dispatched from script, which is precisely the
 * case to exclude. An adversary automating their own browser can still generate
 * trusted events, and that is fine: the obligation is that this client never
 * responds without its user, not that the user is unautomatable.
 */

/** A gesture older than this is stale. Comfortable for a person, useless to a loop. */
const MAX_GESTURE_AGE_MS = 3_000;

export class HumanGesture {
  #createdAt: number;
  #consumed = false;

  private constructor(createdAt: number) {
    this.#createdAt = createdAt;
  }

  /**
   * Mints a gesture from a user event. Returns null for synthetic events.
   *
   * Accepts the minimal shape rather than a React or DOM event type so that
   * callers cannot fake it with an object literal: `isTrusted` is only true on
   * events the browser itself produced.
   */
  static fromEvent(event: { readonly isTrusted: boolean }): HumanGesture | null {
    if (!event.isTrusted) return null;
    return new HumanGesture(Date.now());
  }

  /** True once, and only while fresh. Prevents replaying one tap for many rounds. */
  consume(): boolean {
    if (this.#consumed) return false;
    if (Date.now() - this.#createdAt > MAX_GESTURE_AGE_MS) return false;
    this.#consumed = true;
    return true;
  }
}

export class MissingHumanGestureError extends Error {
  constructor() {
    super(
      "Una respuesta a un reto exige una pulsación humana. Ver el invariante 11 en AGENTS.md",
    );
    this.name = "MissingHumanGestureError";
  }
}
