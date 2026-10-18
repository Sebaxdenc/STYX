/**
 * The buyer's journey, in order.
 *
 * Three steps, not four. The swarm review is deliberately NOT a step: it is
 * something the system does, not something the buyer does, and listing it as a
 * step implied there was an action waiting there. What the review means for a
 * buyer is the state of their own ticket, which belongs on the result screen.
 *
 * The labels are written for a person buying a ticket rather than for someone
 * reading the contracts: "estar atento" instead of "ventana de cualificacion".
 * They map onto the protocol phases in ARCHITECTURE.md section 2.
 */
export interface FlowStep {
  readonly href: string;
  readonly ordinal: number;
  /** Short label for the stepper. */
  readonly label: string;
  /** Plain-language description, shown on hover and to screen readers. */
  readonly blurb: string;
}

export const FLOW_STEPS: readonly FlowStep[] = [
  {
    href: "/",
    ordinal: 1,
    label: "Apuntarte",
    blurb:
      "Dejas un depósito que se te devuelve. Llegar primero no da ninguna ventaja: la ventana es ancha a propósito para que no haya carrera.",
  },
  {
    href: "/cualificacion",
    ordinal: 2,
    label: "Estar atento",
    blurb:
      "Llegan unos avisos en momentos que no sabes de antemano y contestas con un toque. No hay nada que resolver, solo hay que estar.",
  },
  {
    href: "/resultado",
    ordinal: 3,
    label: "Tu resultado",
    blurb:
      "Ves si te tocó entrada y qué tienes exactamente en este momento. El reparto ya estaba decidido, así que no hay que correr.",
  },
] as const;

/**
 * Transparency view, outside the journey.
 *
 * Reachable at any time and from anywhere, but never presented as a step the
 * buyer has to complete. Its audience is anyone checking the allotment was
 * clean, including a buyer who wants to, but it is not part of buying.
 */
export const TRANSPARENCY_LINK = {
  href: "/enjambre",
  label: "Transparencia",
  blurb:
    "Cómo se revisó el reparto y qué cuentas coordinadas se encontraron. Cualquiera puede comprobarlo.",
} as const;

export function stepFor(pathname: string): FlowStep | null {
  return FLOW_STEPS.find((step) => step.href === pathname) ?? null;
}

export function nextStepAfter(pathname: string): FlowStep | null {
  const index = FLOW_STEPS.findIndex((step) => step.href === pathname);
  if (index === -1 || index === FLOW_STEPS.length - 1) return null;
  return FLOW_STEPS[index + 1] ?? null;
}

export function previousStepBefore(pathname: string): FlowStep | null {
  const index = FLOW_STEPS.findIndex((step) => step.href === pathname);
  if (index <= 0) return null;
  return FLOW_STEPS[index - 1] ?? null;
}

export function isLastStep(pathname: string): boolean {
  return pathname === FLOW_STEPS[FLOW_STEPS.length - 1]?.href;
}
