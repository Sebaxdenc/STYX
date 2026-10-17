import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Panel({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className={cn("rounded-md border border-border bg-card p-6 md:p-8", className)}>
      {children}
    </section>
  );
}

export function Eyebrow({ children }: { readonly children: ReactNode }) {
  return (
    <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </p>
  );
}

/** Label and value pair. `mono` aligns digits for values that change. */
export function Field({
  label,
  value,
  hint,
  mono = false,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly hint?: string;
  readonly mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-1 text-foreground",
          mono ? "font-mono text-lg tabular-nums" : "text-lg",
        )}
      >
        {value}
      </dd>
      {hint !== undefined && (
        <p className="mt-1 text-xs leading-snug text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/**
 * Callout for statements that must not be missed.
 *
 * `tone="claim"` is for honesty-critical copy, such as what a participant
 * actually owns at a given stage. Those sentences exist to prevent the interface
 * promising more than the protocol delivers, so they get visual weight.
 */
export function Note({
  tone = "neutral",
  children,
}: {
  readonly tone?: "neutral" | "claim" | "warning";
  readonly children: ReactNode;
}) {
  const tones: Readonly<Record<"neutral" | "claim" | "warning", string>> = {
    neutral: "border-border bg-muted/40 text-muted-foreground",
    claim: "border-primary/40 bg-primary/10 text-foreground",
    warning: "border-destructive/40 bg-destructive/10 text-foreground",
  };

  return (
    <p className={cn("rounded-md border px-4 py-3 text-sm leading-relaxed", tones[tone])}>
      {children}
    </p>
  );
}
