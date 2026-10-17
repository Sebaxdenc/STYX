import { isDemoProfile, params } from "@/lib/protocol";
import { formatDuration } from "@/lib/format";

/**
 * States plainly that the loaded parameters are a compressed demo profile.
 *
 * Not decoration. The project's documentation is deliberate about claiming
 * neither more nor less than it delivers, and an interface showing a 25-second
 * enrolment window without saying it is compressed would imply the production
 * design is a race, which is the opposite of the point.
 */
export function DemoBadge() {
  if (!isDemoProfile()) return null;

  return (
    <p
      className="border-b border-primary/30 bg-primary/10 px-6 py-2 text-center text-xs leading-relaxed text-foreground"
      role="note"
    >
      <span className="font-mono uppercase tracking-[0.16em] text-primary">
        Perfil de demo
      </span>{" "}
      · Tiempos comprimidos para que el ciclo completo quepa en un escenario:
      enrolamiento {formatDuration(params.enrollment.windowSeconds)}, cualificación{" "}
      {formatDuration(params.qualification.windowSeconds)} con{" "}
      {params.qualification.challengeCount} retos, impugnación{" "}
      {formatDuration(params.dispute.windowSeconds)}. El diseño de producción usa 48 h, 5 min
      y 48 h.
    </p>
  );
}
