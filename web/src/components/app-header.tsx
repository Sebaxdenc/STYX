import Link from "next/link";
import { BrandMark } from "./brand-mark";
import { ConnectButton } from "./connect-button";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-sm font-semibold tracking-[0.2em] text-foreground transition-opacity duration-200 hover:opacity-70"
        >
          <BrandMark className="size-4 text-primary" />
          STYX
        </Link>

        <nav aria-label="Secciones" className="flex items-center gap-6">
          <Link
            href="/enjambre"
            className="text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground"
          >
            Enjambre
          </Link>
          <ConnectButton />
        </nav>
      </div>
    </header>
  );
}
