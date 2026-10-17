"use client";

import { EnrollmentPhase } from "@/lib/chain/abis";
import { Button } from "@/components/ui/button";
import { Eyebrow, Field, Note, Panel } from "@/components/ui/panel";
import { ConnectButton } from "@/components/connect-button";
import { useCountdown } from "@/hooks/use-countdown";
import { useEnrollment } from "@/hooks/use-enrollment";
import { useWallet } from "@/hooks/use-wallet";
import { formatCount, formatDuration, formatMon } from "@/lib/format";
import { params, secondsToHours, secondsToMinutes } from "@/lib/protocol";

export function EnrollmentScreen() {
  const { status } = useWallet();
  const { loading, error, state, config, participant, cohort, submitting, enroll } =
    useEnrollment();

  const remaining = useCountdown(state?.closesAt ?? null);

  if (loading && state === null) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">Leyendo el estado del contrato</p>
      </Panel>
    );
  }

  if (state === null) {
    return (
      <Panel>
        <Eyebrow>Sin conexión al contrato</Eyebrow>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {error ?? "No se pudo leer el contrato de enrolamiento."}
        </p>
      </Panel>
    );
  }

  const isEnrolled = participant?.isEnrolled === true;
  const windowOpen = state.phase === EnrollmentPhase.Enrolling && (remaining ?? 0) > 0;

  return (
    <div className="space-y-6">
      <header>
        <Eyebrow>Fase 1 de 4 · Enrolamiento</Eyebrow>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
          Deposita el bono y queda enrolado.
        </h1>
        {/*
          Required copy. The whole point of a wide window is that it removes the
          race, and saying so is what stops a user treating it like a drop.
        */}
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Llegar primero no da ninguna ventaja. La ventana dura{" "}
          {secondsToHours(params.enrollment.windowSeconds)} horas y las entradas se reparten
          después por sorteo, no por orden de llegada.
        </p>
      </header>

      <Panel>
        <dl className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Bono"
            value={`${formatMon(state.bondAmount)} MON`}
            hint="Reembolsable al liquidar la venta"
            mono
          />
          <Field
            label="Cierra en"
            value={remaining === null ? "sin definir" : formatDuration(remaining)}
            hint="Da igual cuándo te enroles dentro de la ventana"
            mono
          />
          <Field label="Enrolados" value={formatCount(state.enrolledCount)} mono />
          <Field
            label="Retención por abandono"
            value={`${params.enrollment.abandonmentForfeitBps / 100} %`}
            hint="Solo si te cualificas y después abandonas"
            mono
          />
        </dl>

        <div className="mt-8 border-t border-border pt-6">
          <Note tone="claim">
            El bono no es un filtro de bots y no compra ninguna posición. Su función es
            acotar cuántas identidades puede sostener un atacante. Si participas de forma
            honesta, lo recuperas íntegro: el coste real es liquidez temporal.
          </Note>
        </div>
      </Panel>

      {isEnrolled ? (
        <Panel>
          <Eyebrow>Ya estás enrolado</Eyebrow>
          <dl className="mt-6 grid gap-8 sm:grid-cols-3">
            <Field
              label="Bono depositado"
              value={`${formatMon(participant?.bond ?? 0n)} MON`}
              mono
            />
            <Field
              label="Tu cohorte"
              value={
                cohort === null
                  ? "sin asignar"
                  : `${cohort} de ${config?.cohortCount ?? params.qualification.cohortCount}`
              }
              hint={
                cohort === null
                  ? "Se fija al cerrar el enrolamiento, para que no se puedan generar direcciones que caigan en una cohorte elegida"
                  : "Asignada por hash de tu dirección. No se puede elegir"
              }
              mono
            />
            <Field
              label="Ventana de cualificación"
              value={
                config !== null && config.windowStartBlock > 0n
                  ? `bloque ${config.windowStartBlock}`
                  : "aún no abierta"
              }
              hint={
                config !== null && config.windowStartBlock > 0n
                  ? `${config.challengeCount} retos en ${secondsToMinutes(
                      params.qualification.windowSeconds,
                    )} minutos`
                  : "El contrato no fija su inicio por adelantado: empieza cuando el organizador la abre"
              }
              mono
            />
          </dl>

          <div className="mt-8 border-t border-border pt-6">
            <Note>
              Estar enrolado no te da una entrada ni un puesto en la cola. Es solo un bono
              depositado. El siguiente paso es responder a los retos de la ventana de
              cualificación.
            </Note>
          </div>
        </Panel>
      ) : (
        <Panel>
          <Eyebrow>Enrolarse</Eyebrow>

          {status !== "connected" ? (
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <ConnectButton />
              <p className="text-sm text-muted-foreground">
                Necesitas una wallet en Monad testnet. El MON de prueba se consigue en el{" "}
                <a
                  href="https://faucet.monad.xyz"
                  className="text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-primary"
                >
                  faucet
                </a>
                .
              </p>
            </div>
          ) : !windowOpen ? (
            <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
              La ventana de enrolamiento no está abierta.
            </p>
          ) : (
            <div className="mt-6 space-y-4">
              <Button
                size="lg"
                disabled={submitting}
                onClick={() => void enroll()}
              >
                {submitting
                  ? "Confirmando"
                  : `Depositar ${formatMon(state.bondAmount)} MON y enrolarse`}
              </Button>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Se enviará exactamente {formatMon(state.bondAmount)} MON. El contrato
                rechaza cualquier otro importe.
              </p>
            </div>
          )}
        </Panel>
      )}

      {error !== null && (
        <Note tone="warning">{error}</Note>
      )}
    </div>
  );
}
