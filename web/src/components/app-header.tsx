import Link from "next/link";
import { BrandMark } from "./brand-mark";
import { ConnectButton } from "./connect-button";
import { DemoBadge } from "./demo-badge";

const navigation = [
  { href: "/", label: "Enrolamiento" },
  { href: "/cualificacion", label: "Cualificación" },
  { href: "/resultado", label: "Resultado" },
  { href: "/enjambre", label: "Enjambre" },
] as const;

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

        <nav aria-label="Fases del protocolo" className="hidden sm:block">
          <ul className="flex items-center gap-6">
            {navigation.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <ConnectButton />
      </div>
    </header>
  );
}
