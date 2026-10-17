import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { isDetectorReport } from "@/lib/detector/report";

/**
 * Serves the detector's report to the browser.
 *
 * Read from disk on every request rather than imported at build time, because
 * the report does not exist when the app is built: the demo orchestrator writes
 * `detector/data/report.json` during phase 4, on stage. A static import would
 * either fail the build or serve a stale file, and there is no opportunity to
 * rebuild between the detection running and the swarm view being shown.
 *
 * This means the web server must run on the same machine as the detector, which
 * is how the demo runs anyway.
 */
export const dynamic = "force-dynamic";

const REPORT_PATH = path.resolve(process.cwd(), "..", "detector", "data", "report.json");

export async function GET() {
  let raw: string;
  try {
    raw = await readFile(REPORT_PATH, "utf8");
  } catch {
    // Absence is the normal state before the detector has run, not a failure.
    return NextResponse.json(
      { status: "pending", reason: "El detector todavia no ha escrito un informe" },
      { status: 404 },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { status: "invalid", reason: "El informe no es JSON valido" },
      { status: 422 },
    );
  }

  if (!isDetectorReport(parsed)) {
    return NextResponse.json(
      { status: "invalid", reason: "El informe no tiene la forma esperada" },
      { status: 422 },
    );
  }

  return NextResponse.json(parsed, {
    headers: { "cache-control": "no-store" },
  });
}
