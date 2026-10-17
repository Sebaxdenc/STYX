"use client";

import { useEffect, useRef } from "react";
import type { SwarmLayout } from "@/lib/detector/layout";

/**
 * Renders the swarm layout to a canvas.
 *
 * Canvas rather than SVG or DOM nodes: a hundred thousand elements in the
 * document is not viable, while a hundred thousand fills per frame is. Points
 * are drawn as small rectangles rather than arcs because `fillRect` is
 * materially cheaper than `arc` plus `fill` at this count, and at two or three
 * pixels the difference is not visible.
 *
 * The reveal interpolates each clustered point from its scattered position to
 * its clustered one. That transition IS the finding: in real time there are
 * seconds of data and nothing shows, and in retrospect the whole pattern is
 * there. Under `prefers-reduced-motion` it jumps straight to the final state.
 */
export function SwarmCanvas({
  layout,
  className,
}: {
  readonly layout: SwarmLayout;
  readonly className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const context = canvas.getContext("2d", { alpha: true });
    if (context === null) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let frame = 0;
    let start = 0;

    const styles = getComputedStyle(canvas);
    const dim = styles.getPropertyValue("--swarm-loose").trim() || "#64748b";
    const hot = styles.getPropertyValue("--swarm-tight").trim() || "#f59e0b";

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const easeInOutCubic = (t: number): number =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const draw = (progress: number) => {
      context.clearRect(0, 0, width, height);

      const eased = easeInOutCubic(progress);
      const pad = 12;
      const innerWidth = Math.max(1, width - pad * 2);
      const innerHeight = Math.max(1, height - pad * 2);

      // Unclustered first, so clustered points sit above them.
      context.fillStyle = dim;
      context.globalAlpha = 0.5;
      for (const point of layout.points) {
        if (point.clusterId !== null) continue;
        const x = pad + point.loose[0] * innerWidth;
        const y = pad + point.loose[1] * innerHeight;
        context.fillRect(x, y, 2, 2);
      }

      context.fillStyle = hot;
      context.globalAlpha = 0.35 + eased * 0.65;
      for (const point of layout.points) {
        if (point.clusterId === null) continue;
        const x = pad + (point.loose[0] + (point.tight[0] - point.loose[0]) * eased) * innerWidth;
        const y = pad + (point.loose[1] + (point.tight[1] - point.loose[1]) * eased) * innerHeight;
        const size = 2 + eased;
        context.fillRect(x, y, size, size);
      }

      context.globalAlpha = 1;
    };

    const step = (timestamp: number) => {
      if (start === 0) start = timestamp;
      const elapsed = timestamp - start;
      const progress = Math.min(1, elapsed / 2_600);

      draw(progress);

      if (progress < 1) frame = requestAnimationFrame(step);
    };

    resize();

    if (reduceMotion) {
      draw(1);
    } else {
      frame = requestAnimationFrame(step);
    }

    const onResize = () => {
      resize();
      draw(1);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, [layout]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={
        {
          "--swarm-loose": "oklch(0.715 0.016 265)",
          "--swarm-tight": "oklch(0.79 0.135 72)",
        } as React.CSSProperties
      }
      role="img"
      aria-label={
        `Distribución de ${layout.unclusteredCount + layout.clusteredCount} participantes. ` +
        `${layout.unclusteredCount} independientes forman una nube difusa y ` +
        `${layout.clusteredCount} agrupados por el detector se concentran en grumos densos.`
      }
    />
  );
}
