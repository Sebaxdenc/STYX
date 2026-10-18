import Link from "next/link";
import { BrandMark } from "./brand-mark";
import { ConnectButton } from "./connect-button";
import { DemoBadge } from "./demo-badge";
import { FlowStepper, TransparencyLink } from "./flow-stepper";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
      <DemoBadge />

      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-6 px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-sm font-semibold tracking-[0.2em] text-foreground transition-opacity duration-200 hover:opacity-70"
        >
          <BrandMark className="size-4 text-primary" />
          STYX
        </Link>

        <ConnectButton />
      </div>

      {/*
        The stepper sits on its own row rather than inline with the wordmark.
        Four steps with their numbers do not fit beside a wallet button on a
        phone, and compressing them is what made the previous flat nav read as
        four unrelated links instead of an ordered journey.
      */}
      {/*
        The stepper sits on its own row rather than inline with the wordmark.
        Three steps with their numbers do not fit beside a wallet button on a
        phone, and compressing them is what made the previous flat nav read as
        unrelated links instead of an ordered journey.

        The transparency link is separated by a rule on purpose: it is not a step
        and must not look like one, or a buyer will think something is pending
        there.
      */}
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 border-t border-border px-6 py-1.5 lg:flex-row lg:items-stretch lg:gap-4">
        <FlowStepper />
        <TransparencyLink />
      </div>
    </header>
  );
}
