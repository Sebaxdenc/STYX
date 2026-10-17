import type { OwnershipStage } from "@/hooks/use-allotment";
import { cn } from "@/lib/cn";

/**
 * The six ownership stages from ARCHITECTURE.md section 2, shown as a ladder.
 *
 * This component exists to stop the interface lying. The critical jump is from
 * stage 3 to stage 5: the draw mints nothing, it records that an address has a
 * RIGHT to claim, and the NFT issued at stage 4 stays provisional with transfers
 * locked while the dispute window is open.
 *
 * Collapsing any of that into "you have a ticket" would be the single most
 * tempting dishonesty available here, which is why each stage states plainly
 * what is owned rather than how far along the user is.
 */
const STAGES = [
  {
    id: "enrolled",
    ordinal: 1,
    name: "Enrolado",
    owns: "Nada. Solo un bono depositado",
  },
  {
    id: "qualified",
    ordinal: 2,
    name: "Cualificado",
    owns: "Nada. Un participationScore",
  },
  {
    id: "selected",
    ordinal: 3,
    name: "Seleccionado",
    owns: "Un derecho a reclamar, no una entrada",
  },
  {
    id: "claimed",
    ordinal: 4,
    name: "Reclamado",
    owns: "El NFT, pero provisional y sin poder transferirse",
  },
  {
    id: "final",
    ordinal: 5,
    name: "Definitivo",
    owns: "La entrada, firme",
  },
  {
    id: "redeemed",
    ordinal: 6,
    name: "Redimido",
    owns: "Acceso consumido",
  },
] as const satisfies readonly { id: OwnershipStage; ordinal: number; name: string; owns: string }[];

const ORDER: readonly OwnershipStage[] = STAGES.map((stage) => stage.id);

export function OwnershipLadder({ stage }: { readonly stage: OwnershipStage }) {
  const currentIndex = ORDER.indexOf(stage);
  const revoked = stage === "revoked";

  return (
    <ol className="divide-y divide-border">
      {STAGES.map((item, index) => {
        const reached = !revoked && currentIndex >= index;
        const isCurrent = !revoked && currentIndex === index;

        return (
          <li
            key={item.id}
            className={cn(
              "flex items-baseline gap-4 py-3",
              isCurrent && "bg-primary/10 -mx-4 px-4 rounded-sm",
            )}
          >
            <span
              className={cn(
                "font-mono text-xs tabular-nums",
                reached ? "text-primary" : "text-muted-foreground",
              )}
            >
              {item.ordinal}
            </span>

            <span className="flex-1">
              <span
                className={cn(
                  "text-sm font-medium",
                  reached ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {item.name}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                {item.owns}
              </span>
            </span>

            {isCurrent && (
              <span className="font-mono text-xs uppercase tracking-[0.14em] text-primary">
                aquí
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
