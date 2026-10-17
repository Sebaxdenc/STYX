"use client";

import { LotteryPhase, TicketState } from "@/lib/chain/abis";
import { ClusterFindingPanel } from "@/components/cluster-finding";
import { OwnershipLadder } from "@/components/ownership-ladder";
import { Button } from "@/components/ui/button";
import { Eyebrow, Field, Note, Panel } from "@/components/ui/panel";
import { ConnectButton } from "@/components/connect-button";
import { useAllotment } from "@/hooks/use-allotment";
import { useCountdown } from "@/hooks/use-countdown";
import { useWallet } from "@/hooks/use-wallet";
import { formatCount, formatDuration, formatMon } from "@/lib/format";
import { loadIdentity } from "@/lib/identity";
import { params } from "@/lib/protocol";

export function ResultScreen() {
  const { status } = useWallet();
  const {
    loading,
    error,
    lottery,
    participant,
    ticket,
    finding,
    cluster,
    isQualified,
    participationScore,
    stage,
    submitting,
    claimEntitlement,
    claimTicket,
    finalize,
    appeal,
  } = useAllotment();

  const disputeRemaining = useCountdown(
    ticket !== null && ticket.disputeDeadline > 0n ? ticket.disputeDeadline : null,
  );

  if (loading && lottery === null) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">Leyendo el estado del sorteo</p>
      </Panel>
    );
  }

  if (lottery === null) {
    return (
      <Panel>
        <Eyebrow>Sin conexión al contrato</Eyebrow>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {error ?? "No se pudo leer el sorteo."}
        </p>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <Eyebrow>Fases 3 y 4 · Sorteo y propiedad</Eyebrow>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
          El resultado ya está decidido.
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Al fijarse la semilla, el resultado de cada participante quedó determinado.
          Reclamar es recoger, no competir: llegar tarde dentro de la ronda no quita nada y
          cualquiera puede recomputar el resultado de cualquiera.
        </p>
      </header>

      <Panel>
        <dl className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Inventario"
            value={`${formatCount(lottery.issued)} de ${formatCount(lottery.inventory)}`}
            hint="Derechos otorgados sobre el total"
            mono
          />
          <Field
            label="Fase del sorteo"
            value={describeLotteryPhase(lottery.phase)}
            mono
          />
          <Field
            label="Ronda"
            value={lottery.currentRound === 0 ? "sin abrir" : lottery.currentRound.toString()}
            hint={lottery.roundOpen ? "Abierta" : "Cerrada"}
            mono
          />
          <Field
            label="Tu peso"
            value={participant === null ? "sin conectar" : participant.weight.toString()}
            hint={`Participación ${participationScore}, con tope ${lottery.participationCap}`}
            mono
          />
        </dl>

        {lottery.seed !== `0x${"0".repeat(64)}` && (
          <div className="mt-8 border-t border-border pt-6">
            <dt className="text-xs text-muted-foreground">Semilla del sorteo</dt>
            <dd className="mt-1 break-all font-mono text-xs text-foreground">
              {lottery.seed}
            </dd>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Sale del hash de un bloque que no existía cuando se decidió participar, así que
              nadie pudo conocerla por adelantado.
            </p>
          </div>
        )}
      </Panel>

      {status !== "connected" ? (
        <Panel>
          <Eyebrow>Tu resultado</Eyebrow>
          <div className="mt-6">
            <ConnectButton />
          </div>
        </Panel>
      ) : (
        <>
          <Panel>
            <Eyebrow>Qué posees ahora mismo</Eyebrow>
            <div className="mt-6">
              <OwnershipLadder stage={stage} />
            </div>

            <div className="mt-8 border-t border-border pt-6">
              <OwnershipStatement
                stage={stage}
                disputeRemaining={disputeRemaining}
                isQualified={isQualified}
                selectedInCurrentRound={participant?.selectedInCurrentRound === true}
                roundOpen={lottery.roundOpen}
              />
            </div>
          </Panel>

          <Panel>
            <Eyebrow>Siguiente paso</Eyebrow>
            <div className="mt-6 space-y-4">
              {stage === "qualified" && lottery.roundOpen && (
                participant?.selectedInCurrentRound === true ? (
                  <Button disabled={submitting} onClick={() => void claimEntitlement()}>
                    {submitting ? "Confirmando" : "Recoger el derecho a reclamar"}
                  </Button>
                ) : (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    No saliste seleccionado en la ronda {lottery.currentRound}. Cada ronda es
                    un sorteo independiente sobre el inventario que queda.
                  </p>
                )
              )}

              {stage === "selected" && (
                <div className="space-y-4">
                  <Button disabled={submitting} onClick={() => void claimTicket()}>
                    {submitting
                      ? "Confirmando"
                      : ticket !== null && ticket.priceWei > 0n
                        ? `Reclamar la entrada por ${formatMon(ticket.priceWei)} MON`
                        : "Reclamar la entrada"}
                  </Button>
                  <Note tone="warning">
                    Al reclamar se genera en tu navegador un secreto de identidad y se envía
                    solo su hash. Si lo pierdes, la entrada no se puede redimir nunca. El
                    verificador de esta demo no es sólido ni privado y debe sustituirse por
                    uno real antes de cualquier uso en producción.
                  </Note>
                </div>
              )}

              {stage === "claimed" && (
                <div className="space-y-4">
                  {disputeRemaining !== null && disputeRemaining > 0 ? (
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      Las transferencias están bloqueadas mientras la impugnación siga
                      abierta. Al cerrarse, la entrada pasa a definitiva.
                    </p>
                  ) : (
                    <Button disabled={submitting} onClick={() => void finalize()}>
                      {submitting ? "Confirmando" : "Hacer definitiva la entrada"}
                    </Button>
                  )}
                  <IdentityReminder />
                </div>
              )}

              {stage === "final" && (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  La entrada es firme. En la puerta se prueba la identidad ligada, no la
                  posesión de la wallet.
                </p>
              )}

              {stage === "unenrolled" && (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Esta dirección no está enrolada en esta venta.
                </p>
              )}

              {stage === "enrolled" && (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Estás enrolado pero no cualificaste: respondiste {participationScore} retos
                  y hacían falta {params.qualification.minResponsesToQualify}.
                </p>
              )}
            </div>
          </Panel>

          {finding !== null && cluster !== null && (
            <ClusterFindingPanel
              finding={finding}
              cluster={cluster}
              submitting={submitting}
              onAppeal={() => void appeal()}
            />
          )}
        </>
      )}

      {error !== null && <Note tone="warning">{error}</Note>}
    </div>
  );
}

/**
 * The sentence that states what the user owns.
 *
 * The brief asked for "Has obtenido una entrada. Queda confirmada en 48 horas."
 * The structure is kept, but the duration is read from the parameters instead of
 * written in: the loaded profile uses a compressed dispute window, so printing
 * 48 hours would be false here. Design invariant 0 and the honesty requirement
 * point the same way.
 */
function OwnershipStatement({
  stage,
  disputeRemaining,
  isQualified,
  selectedInCurrentRound,
  roundOpen,
}: {
  readonly stage: ReturnType<typeof useAllotment>["stage"];
  readonly disputeRemaining: number | null;
  readonly isQualified: boolean;
  readonly selectedInCurrentRound: boolean;
  readonly roundOpen: boolean;
}) {
  const disputeWindow = formatDuration(params.dispute.windowSeconds);

  switch (stage) {
    case "claimed":
      return (
        <Note tone="claim">
          Has obtenido una entrada. Queda confirmada en{" "}
          {disputeRemaining !== null && disputeRemaining > 0
            ? formatDuration(disputeRemaining)
            : disputeWindow}
          . Hasta entonces el NFT es provisional y no se puede transferir.
        </Note>
      );
    case "selected":
      return (
        <Note tone="claim">
          Tienes un derecho a reclamar, que no es una entrada. El contrato no ha acuñado
          nada todavía: registró que esta dirección puede reclamar.
        </Note>
      );
    case "final":
      return <Note tone="claim">Tu entrada es definitiva.</Note>;
    case "redeemed":
      return <Note>La entrada ya se usó en la puerta.</Note>;
    case "revoked":
      return (
        <Note tone="warning">
          Esta entrada fue revocada tras un hallazgo de coordinación. El precio se reembolsa
          íntegro y la vía de apelación sigue abierta.
        </Note>
      );
    case "qualified":
      return (
        <Note>
          Cualificaste, y eso todavía no es una entrada: es un participationScore que pondera
          tu peso en el sorteo.
          {roundOpen && !selectedInCurrentRound
            ? " En la ronda abierta no saliste seleccionado."
            : ""}
        </Note>
      );
    case "enrolled":
      return (
        <Note>
          {isQualified
            ? "Cualificaste."
            : "Estás enrolado. Eso es un bono depositado, nada más."}
        </Note>
      );
    default:
      return <Note>Esta dirección no participa en esta venta.</Note>;
  }
}

/** Reminds the holder that the locally stored secret is the only way to redeem. */
function IdentityReminder() {
  const identity = loadIdentity();
  if (identity === null) return null;

  return (
    <Note tone="warning">
      Tu secreto de identidad está guardado en este navegador. Sin él no puedes redimir la
      entrada en la puerta, y nadie puede recuperarlo por ti. Su hash público es{" "}
      <span className="break-all font-mono text-xs">{identity.nullifier}</span>
    </Note>
  );
}

function describeLotteryPhase(phase: number): string {
  switch (phase) {
    case LotteryPhase.Pending:
      return "sin empezar";
    case LotteryPhase.SeedRequested:
      return "semilla pedida";
    case LotteryPhase.Drawing:
      return "en sorteo";
    case LotteryPhase.Closed:
      return "cerrado";
    default:
      return "desconocida";
  }
}

export { TicketState };
