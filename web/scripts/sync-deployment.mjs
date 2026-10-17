/**
 * Mirrors `deployment.json` into `web/.env.local` as NEXT_PUBLIC_* variables.
 *
 * DEPLOY.md makes `deployment.json` at the repository root the place where the
 * five contract addresses live, and `swarm/src/config.ts` reads it directly.
 * The browser cannot read a file outside the bundle, so the web needs the same
 * values as build-time environment variables.
 *
 * Writing them by hand in two places invites exactly the mismatch that design
 * invariant 0 exists to prevent, so this runs before `dev` and `build` and keeps
 * one authority: the JSON.
 *
 * Only the keys it manages are rewritten. Anything else already in
 * `.env.local`, such as a dedicated RPC URL, is preserved untouched.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const webRoot = path.resolve(import.meta.dirname, "..");
const deploymentPath = path.resolve(webRoot, "..", "deployment.json");
const envPath = path.join(webRoot, ".env.local");

/** deployment.json key -> environment variable consumed by src/lib/chain/config.ts */
const MAPPING = {
  enrollment: "NEXT_PUBLIC_ENROLLMENT_ADDRESS",
  heartbeatRegistry: "NEXT_PUBLIC_HEARTBEAT_ADDRESS",
  lottery: "NEXT_PUBLIC_LOTTERY_ADDRESS",
  ticketRegistry: "NEXT_PUBLIC_TICKET_REGISTRY_ADDRESS",
  clusterRegistry: "NEXT_PUBLIC_CLUSTER_REGISTRY_ADDRESS",
};

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

if (!existsSync(deploymentPath)) {
  // Not an error: the contracts may simply not be deployed yet. The interface
  // already reports missing addresses as a setup state.
  console.log("[styx] sin deployment.json, se omite la sincronizacion de direcciones");
  process.exit(0);
}

let deployment;
try {
  deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
} catch (error) {
  console.error(`[styx] deployment.json ilegible: ${error.message}`);
  process.exit(1);
}

const managed = new Map();
const skipped = [];

for (const [key, variable] of Object.entries(MAPPING)) {
  const value = deployment[key];
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value.trim())) {
    skipped.push(key);
    continue;
  }
  managed.set(variable, value.trim());
}

// Preserve every line this script does not own, so a hand-written RPC key or
// any unrelated variable survives.
const preserved = [];
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const name = line.split("=")[0]?.trim();
    if (name !== undefined && managed.has(name)) continue;
    if (line.trim().length > 0) preserved.push(line);
  }
}

const body = [
  ...preserved,
  "# Direcciones sincronizadas desde deployment.json. No las edites aqui.",
  ...[...managed].map(([name, value]) => `${name}=${value}`),
  "",
].join("\n");

writeFileSync(envPath, body, "utf8");

console.log(`[styx] ${managed.size} direcciones sincronizadas en web/.env.local`);
if (skipped.length > 0) {
  console.log(`[styx] sin direccion valida: ${skipped.join(", ")}`);
}
