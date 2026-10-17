"use client";

import { AppealState } from "@/lib/chain/abis";
import { Button } from "@/components/ui/button";
import { Eyebrow, Field, Note } from "@/components/ui/panel";
import type { ClusterFinding, ParticipantCluster } from "@/lib/chain/reads";
import { formatDuration, formatMon } from "@/lib/format";

/**
 * Shows a cluster finding against the connected wallet.
 *
 * Design invariant 3 forbids silent exclusion: a finding must reduce weight and
 * open a dispute, never deny participation outright, and the reason, the
 * evidence and the appeal path are all mandatory. So this renders:
 *
 * - the reason: which cluster the wallet was placed in
 * - the evidence: the committed Merkle root plus the ruleset and dataset CIDs,
 *   which let any third party recompute the result and refute it
 * - the appeal path: `appeal()` with its bond
 *
 * The weight multiplier is shown as a number because it is the honest framing:
 * the wallet keeps a reduced share of its weight, it is not removed.
 */
export function ClusterFindingPanel({
  finding,
  cluster,
  submitting,
  onAppeal,
}: {
  readonly finding: ClusterFinding;
  readonly cluster: ParticipantCluster;
  readonly submitting: boolean;
  onAppeal(): void;
}) {
  if (!cluster.isFlagged) return null;

  if (finding.voided) {
    return (
      <Note>
        El hallazgo que marcaba esta dirección fue anulado. Tu peso vuelve a estar intacto.
      </Note>
    );
  }

  const keptPercent = Number(cluster.weightMultiplierBps) / 100;
  const appealed = cluster.appealState !== AppealState.None;

  return (
    <section className="rounded-md border border-destructive/40 bg-destructive/10 p-6 md:p-8">
      <Eyebrow>Hallazgo de coordinación</Eyebrow>

      <h2 className="mt-4 text-xl font-semibold tracking-tight text-foreground">
        Esta dirección quedó en un clúster del detector.
      </h2>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Un hallazgo no te excluye y no anula tu peso: lo reduce y abre una impugnación. La
        vía de apelación es obligatoria, no una cortesía.
      </p>

      <dl className="mt-8 grid gap-8 sm:grid-cols-3">
        <Field label="Clúster" value={cluster.clusterId.toString()} mono />
        <Field
          label="Peso que conservas"
          value={`${keptPercent} %`}
          hint="Nunca baja a cero"
          mono
        />
        <Field
          label="Impugnación abierta"
          value={
            finding.disputeClosesAt === 0n
              ? "sin definir"
              : formatDuration(
                  Number(finding.disputeClosesAt) - Math.floor(Date.now() / 1000),
                )
          }
          mono
        />
      </dl>

      <div className="mt-8 border-t border-destructive/30 pt-6">
        <Eyebrow>Evidencia, para que cualquiera lo recompute</Eyebrow>
        <dl className="mt-4 space-y-3">
          <div>
            <dt className="text-xs text-muted-foreground">Raíz Merkle comprometida</dt>
            <dd className="mt-0.5 break-all font-mono text-xs text-foreground">
              {finding.root}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Ruleset publicado</dt>
            <dd className="mt-0.5 break-all font-mono text-xs text-foreground">
              {finding.rulesetCid.length > 0 ? finding.rulesetCid : "sin publicar"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Dataset usado</dt>
            <dd className="mt-0.5 break-all font-mono text-xs text-foreground">
              {finding.datasetCid.length > 0 ? finding.datasetCid : "sin publicar"}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          El detector es reproducible a propósito: con el mismo dataset y el mismo ruleset,
          un tercero obtiene la misma asignación de clúster. Eso es lo que hace verificable
          la impugnación en lugar de ser una decisión privada.
        </p>
      </div>

      <div className="mt-8 border-t border-destructive/30 pt-6">
        {appealed ? (
          <Note>
            {cluster.appealState === AppealState.Pending
              ? "Tu apelación está pendiente de resolución."
              : cluster.appealState === AppealState.Upheld
                ? "Tu apelación fue estimada. El bono se devuelve."
                : "Tu apelación fue rechazada."}
          </Note>
        ) : (
          <div className="space-y-3">
            <Button variant="secondary" disabled={submitting} onClick={onAppeal}>
              {submitting
                ? "Enviando"
                : `Apelar depositando ${formatMon(finding.appealBond)} MON`}
            </Button>
            <p className="text-xs leading-relaxed text-muted-foreground">
              El bono se devuelve si la apelación se estima. La detección es un mercado con
              incentivos por los dos lados, no una política privada: quien pierde la
              impugnación sufre slashing, y eso aplica también a quien acusa.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
