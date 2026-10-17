"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eyebrow, Field, Note, Panel } from "@/components/ui/panel";
import { useQualification } from "@/hooks/use-qualification";
import { useWallet } from "@/hooks/use-wallet";
import { HumanGesture } from "@/lib/chain/human-gesture";
import { blocksToSecondsLabel } from "@/lib/format";
import { cn } from "@/lib/cn";

export function QualificationScreen() {
  const { status } = useWallet();
  const {
    loading,
    error,
    config,
    cohort,
    currentBlock,
    rounds,
    score,
    isQualified,
    windowOpen,
    windowClosed,
    activeRound,
    activeState,
    submitting,
    respond,
  } = useQualification();

  const challengeIsOpen = activeState?.kind === "open";

  // Part of making the challenge impossible to miss: the tab title changes, so
  // a participant who switched away still sees it. Reverted on cleanup.
  useEffect(() => {
    if (!challengeIsOpen) return;
    const original = document.title;
    document.title = "RESPONDE AHORA — STYX";
    return () => {
      document.title = original;
    };
  }, [challengeIsOpen]);

  // Haptics where available. Silent no-op elsewhere, never a requirement.
  useEffect(() => {
    if (!challengeIsOpen) return;
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate([120, 80, 120]);
    }
  }, [challengeIsOpen]);

  if (loading && config === null) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">Leyendo la ventana de cualificación</p>
      </Panel>
    );
  }

  if (config === null) {
    return (
      <Panel>
        <Eyebrow>Sin conexión al contrato</Eyebrow>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {error ?? "No se pudo leer el registro de latidos."}
        </p>
      </Panel>
    );
  }

  const minToQualify = config.minResponsesToQualify;
  const total = config.challengeCount;

  return (
    <div className="space-y-6">
      <header>
        <Eyebrow>Fase 2 de 4 · Ventana de cualificación</Eyebrow>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
          {total} retos en instantes impredecibles.
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Sabes cuándo estar, no cuándo llegará cada reto. Cada uno es un toque, nunca un
          puzzle, y tienes {blocksToSecondsLabel(config.responseWindowBlocks)} para
          responder.
        </p>
      </header>

      <Panel>
        <dl className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Respondidos"
            value={`${score} de ${total}`}
            hint={`Mínimo ${minToQualify} para cualificar`}
            mono
          />
          <Field
            label="Estado"
            value={isQualified ? "Cualificado" : "Sin cualificar"}
            hint={
              isQualified
                ? "Ya superaste el mínimo"
                : `Te faltan ${Math.max(0, minToQualify - score)}`
            }
            mono
          />
          <Field
            label="Tu cohorte"
            value={cohort === null ? "sin asignar" : `${cohort} de ${config.cohortCount}`}
            hint="Los retos están desfasados entre cohortes"
            mono
          />
          <Field
            label="Bloque"
            value={currentBlock === null ? "sincronizando" : currentBlock.toString()}
            hint={
              config.windowStartBlock === 0n
                ? "Ventana no abierta"
                : `Cierra en el ${config.windowEndBlock}`
            }
            mono
          />
        </dl>
      </Panel>

      <ChallengePanel
        connected={status === "connected"}
        windowOpen={windowOpen}
        windowClosed={windowClosed}
        notStarted={config.windowStartBlock === 0n}
        activeRound={activeRound}
        state={activeState}
        submitting={submitting}
        alreadyResponded={
          activeRound !== null && rounds[activeRound]?.responded === true
        }
        onRespond={(round, gesture) => void respond(round, gesture)}
      />

      <Panel>
        <Eyebrow>Historial de rondas</Eyebrow>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          La latencia se mide en bloques y solo se conoce para las rondas respondidas desde
          este navegador. El contrato guarda qué rondas respondiste, no a qué velocidad, y el
          reto deja de ser consultable en cadena pasados 256 bloques.
        </p>

        <ul className="mt-6 divide-y divide-border">
          {rounds.map((record) => (
            <li
              key={record.round}
              className="flex items-center justify-between gap-4 py-3 text-sm"
            >
              <span className="font-mono text-muted-foreground">
                Ronda {record.round + 1}
              </span>

              <span className="font-mono tabular-nums text-muted-foreground">
                {record.timing === null
                  ? "pendiente"
                  : `bloque ${record.timing.challengeBlock}`}
              </span>

              <span
                className={cn(
                  "font-mono tabular-nums",
                  record.responded ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {record.latencyBlocks !== null
                  ? `${record.latencyBlocks} bl · ${blocksToSecondsLabel(BigInt(record.latencyBlocks))}`
                  : record.responded
                    ? "respondida"
                    : "sin respuesta"}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      {error !== null && <Note tone="warning">{error}</Note>}
    </div>
  );
}

function ChallengePanel({
  connected,
  windowOpen,
  windowClosed,
  notStarted,
  activeRound,
  state,
  submitting,
  alreadyResponded,
  onRespond,
}: {
  readonly connected: boolean;
  readonly windowOpen: boolean;
  readonly windowClosed: boolean;
  readonly notStarted: boolean;
  readonly activeRound: number | null;
  readonly state: ReturnType<typeof useQualification>["activeState"];
  readonly submitting: boolean;
  readonly alreadyResponded: boolean;
  onRespond(round: number, gesture: HumanGesture): void;
}) {
  const [rejected, setRejected] = useState(false);

  if (notStarted) {
    return (
      <Panel>
        <Eyebrow>Ventana no abierta</Eyebrow>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          El contrato no fija el inicio por adelantado. Mantén esta pestaña abierta cuando
          llegue la hora anunciada.
        </p>
      </Panel>
    );
  }

  if (windowClosed) {
    return (
      <Panel>
        <Eyebrow>Ventana cerrada</Eyebrow>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          La ventana de cualificación terminó. El sorteo se resuelve en segundos.
        </p>
      </Panel>
    );
  }

  if (!connected) {
    return (
      <Panel>
        <Note tone="warning">
          Conecta tu wallet antes de que caiga el primer reto. Una ventana de respuesta de
          pocos segundos no da tiempo a conectarla cuando ya ha caído.
        </Note>
      </Panel>
    );
  }

  if (!windowOpen || activeRound === null || state === null) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">Esperando el inicio de la ventana</p>
      </Panel>
    );
  }

  if (alreadyResponded) {
    return (
      <Panel>
        <Eyebrow>Ronda {activeRound + 1} respondida</Eyebrow>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Ya respondiste a esta ronda. El siguiente reto llegará en un instante
          impredecible.
        </p>
      </Panel>
    );
  }

  if (state.kind === "open") {
    return (
      <section
        // The alert must be impossible to ignore, so it is announced as well as
        // visually dominant.
        role="alert"
        aria-live="assertive"
        className="rounded-md border-2 border-primary bg-primary/15 p-6 md:p-8"
      >
        <div className="flex items-baseline justify-between gap-4">
          <Eyebrow>Reto {activeRound + 1} · responde ahora</Eyebrow>
          <span className="font-mono text-2xl font-semibold tabular-nums text-primary">
            {blocksToSecondsLabel(state.blocksLeft)}
          </span>
        </div>

        <Button
          size="hero"
          className="mt-6"
          disabled={submitting}
          onClick={(event) => {
            // Invariant 11 enforcement point. The token can only be minted from
            // a trusted browser event, so no timer or effect can reach here.
            const gesture = HumanGesture.fromEvent(event.nativeEvent);
            if (gesture === null) {
              setRejected(true);
              return;
            }
            setRejected(false);
            onRespond(activeRound, gesture);
          }}
        >
          {submitting ? "Enviando" : "Responder"}
        </Button>

        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          Quedan {state.blocksLeft.toString()} bloques. Tu latencia se mide en bloques desde
          el {state.timing.challengeBlock}.
        </p>

        {rejected && (
          <p className="mt-3 text-xs text-destructive">
            Se ignoró una respuesta sin pulsación humana.
          </p>
        )}
      </section>
    );
  }

  if (state.kind === "armed") {
    return (
      <Panel>
        <Eyebrow>Ronda {activeRound + 1} · armada</Eyebrow>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          El reto cae en el bloque {state.timing.challengeBlock}, dentro de{" "}
          {blocksToSecondsLabel(state.blocksUntil)}. No cierres esta pestaña.
        </p>
      </Panel>
    );
  }

  if (state.kind === "pending") {
    return (
      <Panel>
        <Eyebrow>Ronda {activeRound + 1} · resolviendo</Eyebrow>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          El instante del reto se deriva del hash del primer bloque de esta sub-ventana, que
          acaba de producirse. No se puede conocer antes.
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      <Eyebrow>Ronda {activeRound + 1} · perdida</Eyebrow>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        {state.reason === "late"
          ? "La ventana de respuesta se cerró. Puedes fallar algunas rondas y seguir cualificando."
          : "El reto ya no es verificable en la cadena."}
      </p>
    </Panel>
  );
}
