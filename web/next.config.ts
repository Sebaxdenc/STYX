import path from "node:path";
import type { NextConfig } from "next";

/**
 * Turbopack resolves modules relative to its root and refuses anything outside
 * it. `src/lib/protocol.ts` imports `protocol-params.json` from the repository
 * root, which is one level above this package, so the root is widened to cover
 * it.
 *
 * The alternative would be copying the file into `web/` during a build step, but
 * design invariant 0 makes that JSON the single source of truth and a duplicate
 * is exactly what the invariant exists to prevent.
 *
 * Setting this explicitly also avoids Turbopack inferring the root from stray
 * lockfiles in parent directories, which is a known cause of runaway memory use
 * during module resolution.
 */
const repositoryRoot = path.resolve(import.meta.dirname, "..");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: repositoryRoot,
  },
};

export default nextConfig;
