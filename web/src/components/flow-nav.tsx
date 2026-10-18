"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  isLastStep,
  nextStepAfter,
  previousStepBefore,
  stepFor,
  TRANSPARENCY_LINK,
  FLOW_STEPS,
} from "./flow-steps";

/**
 * Footer navigation that carries the user to the next step.
 *
 * The screens existed as separate pages with no thread between them, so a person
 * finished one and had no idea anything followed. This closes that gap: every
 * screen ends by naming what comes next and why.
 *
 * Two cases beyond the plain middle step:
 *
 * - On the last step there is no next step. Offering the transparency view there
 *   as an invitation, rather than as a pending task, is the honest framing: the
 *   review is something the system does, not something the buyer must complete.
 * - On the transparency view itself, which is outside the journey, the only
 *   thing needed is a way back in.
 */
function ArrowRight() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
    >
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

function ArrowLeft() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      className="size-3.5 transition-transform duration-200 group-hover:-translate-x-0.5"
    >
      <path d="M13 8H3M7 4L3 8l4 4" />
    </svg>
  );
}

export function FlowNav() {
  const pathname = usePathname();

  // Outside the journey: only a way back in.
  if (pathname === TRANSPARENCY_LINK.href) {
    const first = FLOW_STEPS[0];
    if (first === undefined) return null;

    return (
      <nav
        aria-label="Volver al recorrido"
        className="mt-12 border-t border-border pt-8"
      >
        <Link
          href={first.href}
          className="group inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground"
        >
          <ArrowLeft />
          Volver a conseguir tu entrada
        </Link>
      </nav>
    );
  }

  if (stepFor(pathname) === null) return null;

  const next = nextStepAfter(pathname);
  const previous = previousStepBefore(pathname);
  const last = isLastStep(pathname);

  return (
    <nav aria-label="Navegación entre pasos" className="mt-12 border-t border-border pt-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        {previous !== null ? (
          <Link
            href={previous.href}
            className="group inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground"
          >
            <ArrowLeft />
            Paso {previous.ordinal}: {previous.label}
          </Link>
        ) : (
          <span />
        )}

        {next !== null && (
          <div className="sm:max-w-sm sm:text-right">
            <p className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-muted-foreground">
              Paso {next.ordinal} de {FLOW_STEPS.length}
            </p>
            <Link
              href={next.href}
              className="group mt-2 inline-flex items-center gap-2 text-base font-medium text-foreground transition-colors duration-200 hover:text-primary"
            >
              {next.label}
              <ArrowRight />
            </Link>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{next.blurb}</p>
          </div>
        )}

        {last && (
          <div className="sm:max-w-sm sm:text-right">
            <p className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-muted-foreground">
              Opcional
            </p>
            <Link
              href={TRANSPARENCY_LINK.href}
              className="group mt-2 inline-flex items-center gap-2 text-base font-medium text-foreground transition-colors duration-200 hover:text-primary"
            >
              Comprobar que el reparto fue limpio
              <ArrowRight />
            </Link>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {TRANSPARENCY_LINK.blurb}
            </p>
          </div>
        )}
      </div>
    </nav>
  );
}
