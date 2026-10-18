"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FLOW_STEPS, TRANSPARENCY_LINK } from "./flow-steps";
import { cn } from "@/lib/cn";

/**
 * Horizontal stepper showing where in the journey the user currently is.
 *
 * Replaces a flat list of links, which told the user what pages existed but not
 * that they form an order, nor which one they were on.
 *
 * Three things are communicated at once: the order (numbers and connecting
 * rules), the current position (colour plus `aria-current`), and what each step
 * involves (the blurb, revealed on hover or keyboard focus).
 *
 * The blurb is also rendered for assistive technology at all times, because a
 * hover-only explanation is no explanation for anyone not using a mouse.
 */
export function FlowStepper() {
  const pathname = usePathname();

  return (
    <nav aria-label="Pasos para conseguir tu entrada" className="flex-1">
      <p className="sr-only">
        Tres pasos para conseguir una entrada. La transparencia del reparto está fuera de
        este recorrido.
      </p>
      {/*
        Wraps rather than scrolling horizontally. `overflow-x-auto` would clip
        the tooltips, because an overflow container clips on both axes, and the
        tooltips hang below each step.
      */}
      <ol className="flex flex-wrap items-stretch gap-1">
        {FLOW_STEPS.map((step, index) => {
          const isCurrent = pathname === step.href;
          const currentIndex = FLOW_STEPS.findIndex((item) => item.href === pathname);
          const isPast = currentIndex > index;

          return (
            <li key={step.href} className="group/step relative flex-1 min-w-[7.5rem]">
              <Link
                href={step.href}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "flex h-full flex-col gap-1 rounded-sm border-t-2 px-3 py-2.5 transition-colors duration-200",
                  isCurrent
                    ? "border-t-primary bg-primary/10"
                    : isPast
                      ? "border-t-border hover:bg-secondary"
                      : "border-t-border/50 hover:bg-secondary",
                )}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "font-mono text-[0.6875rem] tabular-nums",
                      isCurrent
                        ? "text-primary"
                        : isPast
                          ? "text-foreground"
                          : "text-muted-foreground",
                    )}
                  >
                    {step.ordinal}
                  </span>
                  <span
                    className={cn(
                      "text-xs font-medium",
                      isCurrent
                        ? "text-foreground"
                        : isPast
                          ? "text-foreground"
                          : "text-muted-foreground",
                    )}
                  >
                    {step.label}
                  </span>
                </span>

                {/*
                  No "you are here" caption. The colour, the top rule and
                  `aria-current` already carry it, and the hover reveals the
                  detail, so the caption was redundant and added a line of
                  height to every step.
                */}

                {/* Always present for screen readers; shown visually on hover. */}
                <span className="sr-only">{step.blurb}</span>
              </Link>

              {/*
                Tooltip. Driven by group-hover and group-focus-within so that it
                also appears on keyboard navigation, and hidden from assistive
                technology because the same text is already in the link above.
              */}
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute left-0 top-full z-50 mt-2 w-64 rounded-md border border-border bg-popover p-3",
                  "text-xs leading-relaxed text-muted-foreground shadow-lg",
                  "opacity-0 transition-opacity duration-150",
                  "group-hover/step:opacity-100 group-focus-within/step:opacity-100",
                )}
              >
                {step.blurb}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Link to the transparency view, outside the stepper.
 *
 * Styled deliberately unlike a step: no number, separated by a rule, muted
 * until hovered. A buyer glancing at the header must not read it as a fourth
 * thing they have to do.
 */
export function TransparencyLink() {
  const pathname = usePathname();
  const isCurrent = pathname === TRANSPARENCY_LINK.href;

  return (
    <div className="group/aside relative flex items-stretch border-border lg:border-l lg:pl-4">
      <Link
        href={TRANSPARENCY_LINK.href}
        aria-current={isCurrent ? "page" : undefined}
        className={cn(
          "flex items-center gap-2 rounded-sm px-3 py-2.5 text-xs transition-colors duration-200",
          isCurrent
            ? "bg-secondary text-foreground"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        )}
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          aria-hidden="true"
          className="size-3.5"
        >
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 5.25v5.5M5.25 8h5.5" />
        </svg>
        {TRANSPARENCY_LINK.label}
        <span className="sr-only">{TRANSPARENCY_LINK.blurb}</span>
      </Link>

      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute right-0 top-full z-50 mt-2 w-64 rounded-md border border-border bg-popover p-3",
          "text-xs leading-relaxed text-muted-foreground shadow-lg",
          "opacity-0 transition-opacity duration-150",
          "group-hover/aside:opacity-100 group-focus-within/aside:opacity-100",
        )}
      >
        {TRANSPARENCY_LINK.blurb}
      </span>
    </div>
  );
}
