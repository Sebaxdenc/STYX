"use client";

import { useEffect, useMemo, useState } from "react";
import { SwarmCanvas } from "@/components/swarm-canvas";
import { Eyebrow, Field, Note, Panel } from "@/components/ui/panel";
import { buildLayout } from "@/lib/detector/layout";
import {
  describePath,
  describeSignal,
  flaggedCount,
  isDetectorReport,
  unclusteredCount,
  type DetectorReport,
} from "@/lib/detector/report";
import { formatCount } from "@/lib/format";
import { params } from "@/lib/protocol";

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "pending" }
  | { readonly kind: "error"; readonly reason: string }
  | { readonly kind: "ready"; readonly report: DetectorReport };

export function SwarmScreen() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  // Polled rather than fetched once: during the demo the report appears partway
  // through, while this screen is already on the projector.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch("/api/report", { cache: "no-store" });
        if (cancelled) return;

        if (response.status === 404) {
          setState({ kind: "pending" });
          return;
        }
        if (!response.ok) {
          setState({ kind: "error", reason: `El informe devolvio ${response.status}` });
          return;
        }

        const payload: unknown = await response.json();
        if (cancelled) return;

        if (!isDetectorReport(payload)) {
          setState({ kind: "error", reason: "El informe no tiene la forma esperada" });
          return;
        }
        setState({ kind: "ready", report: payload });
      } catch {
        if (!cancelled) setState({ kind: "error", reason: "No se pudo leer el informe" });
      }
    };

    void load();
    const timer = setInterval(() => void load(), 3_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const layout = useMemo(
    () => (state.kind === "ready" ? buildLayout(state.report) : null),
    [state],
  );

  return (
    <div className="space-y-6">
      <header>
        <Eyebrow>Detección de coordinación</Eyebrow>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
          La infraestructura compartida produce ruido compartido.
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          No detectamos bots. Detectamos coordinación. Un participante automatizado que
          actúe solo es indistinguible de una persona; diez mil coordinados no lo son,
          porque una causa común deja desviaciones comunes.
        </p>
      </header>

      {state.kind === "loading" && (
        <Panel>
          <p className="text-sm text-muted-foreground">Leyendo el informe del detector</p>
        </Panel>
      )}

      {state.kind === "pending" && (
        <Panel>
          <Eyebrow>Sin informe todavía</Eyebrow>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            El detector corre en retrospectiva, no en tiempo real. Mientras la ventana de
            cualificación está abierta hay segundos de datos y no se puede concluir nada; el
            patrón completo solo existe al cerrarla. Esta pantalla se actualiza en cuanto
            aparece el informe.
          </p>
        </Panel>
      )}

      {state.kind === "error" && <Note tone="warning">{state.reason}</Note>}

      {state.kind === "ready" && layout !== null && (
        <>
          <Panel className="p-0 md:p-0">
            <SwarmCanvas layout={layout} className="block h-[420px] w-full" />
          </Panel>

          <Panel>
            <dl className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              <Field
                label="Participantes"
                value={formatCount(state.report.wallet_count)}
                mono
              />
              <Field
                label="Independientes"
                value={formatCount(unclusteredCount(state.report))}
                hint="Nube difusa, sin aristas densas"
                mono
              />
              <Field
                label="Agrupados"
                value={formatCount(flaggedCount(state.report))}
                hint={`En ${state.report.clusters.length} clúster(es)`}
                mono
              />
              <Field label="Rondas analizadas" value={state.report.round_count} mono />
            </dl>

            <div className="mt-8 space-y-3 border-t border-border pt-6">
              <div>
                <dt className="text-xs text-muted-foreground">Raíz Merkle del hallazgo</dt>
                <dd className="mt-0.5 break-all font-mono text-xs text-foreground">
                  {state.report.merkle_root}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Huella del ruleset</dt>
                <dd className="mt-0.5 break-all font-mono text-xs text-foreground">
                  {state.report.params_digest}
                </dd>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                La huella ata este informe al ruleset exacto con el que se generó. Con el
                mismo dataset y la misma semilla, un tercero obtiene la misma asignación de
                clúster: eso es lo que hace verificable la impugnación.
              </p>
            </div>
          </Panel>

          {state.report.clusters.map((cluster) => (
            <Panel key={cluster.cluster_id}>
              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <Eyebrow>Clúster {cluster.cluster_id}</Eyebrow>
                <span className="font-mono text-xs text-muted-foreground">
                  ruta {cluster.path}
                </span>
              </div>

              <p className="mt-4 text-sm leading-relaxed text-foreground">
                {describePath(cluster.path)}
              </p>

              <dl className="mt-6 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Miembros" value={formatCount(cluster.members.length)} mono />
                <Field
                  label="Correlación interna"
                  value={cluster.mean_internal_correlation.toFixed(2)}
                  hint="Mide moverse juntos, no ser rápido"
                  mono
                />
                <Field label="Densidad" value={cluster.density.toFixed(2)} mono />
                <Field
                  label="Sospecha"
                  value={cluster.suspicion.toFixed(2)}
                  hint="Baja a propósito si la evasión mejora"
                  mono
                />
              </dl>

              {cluster.conjunction_signals.length > 0 && (
                <div className="mt-6 border-t border-border pt-6">
                  <dt className="text-xs text-muted-foreground">
                    Señales de coincidencia exacta ({Math.round(cluster.conjunction_share * 100)}
                    % de los miembros)
                  </dt>
                  <dd className="mt-2 text-sm leading-relaxed text-foreground">
                    {cluster.conjunction_signals.map(describeSignal).join(", ")}
                  </dd>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    La correlación sola no basta: usuarios honestos tras un mismo RPC público
                    comparten sus picos de carga y correlacionan entre sí. Un hallazgo exige
                    correlación más al menos una señal exacta, que esos usuarios no comparten
                    porque no comparten financiador ni parámetros de gas.
                  </p>
                </div>
              )}
            </Panel>
          ))}

          <Panel>
            <Eyebrow>El límite honesto</Eyebrow>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Un adversario que aleatorice la temporización y las huellas, con financiador,
              gas y calldata distintos por wallet, <strong className="text-foreground">no
              es detectable</strong> con datos onchain. El detector incluye un test que lo
              verifica, para que el límite sea comprobable en lugar de una nota al pie. Esa
              evasión no es gratis: exige infraestructura independiente por identidad y
              fondear cada wallet por una ruta distinta.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Un hallazgo reduce el peso en el sorteo y abre una impugnación. Nunca excluye
              en silencio, la vía de apelación es obligatoria, y el umbral de correlación
              vigente es {params.detection.correlationThreshold} con un tamaño mínimo de
              clúster de {params.detection.minClusterSize}.
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}
