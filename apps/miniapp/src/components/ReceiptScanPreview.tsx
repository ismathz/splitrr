import React, { useEffect, useRef, useState } from "react";
import { createShader, PALETTES, type Direction } from "glimm";

const BAND_TIGHT = 14;
/** Matches glimm's internal `containedOverscan(bandTight)` so we can map
 *  progress directly to visible UV edges `[EDGE_INSET, 1 - EDGE_INSET]`. */
const CONTAINED_OVERSCAN = Math.max(0.2, Math.sqrt(4.6 / BAND_TIGHT));
const EDGE_INSET = 0.03;
const PROGRESS_START =
  (CONTAINED_OVERSCAN + EDGE_INSET) / (1 + 2 * CONTAINED_OVERSCAN);
const PROGRESS_END = 1 - PROGRESS_START;
const PASS_MS = 1200;
const FADE_IN_MS = 180;

export interface ReceiptScanPreviewProps {
  file: File;
  statusText: string;
  active: boolean;
}

export function ReceiptScanPreview({
  file,
  statusText,
  active,
}: ReceiptScanPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) return;

    const ctrl = createShader({
      canvas,
      palette: PALETTES.spectrum,
      direction: "ttb",
      bandTight: BAND_TIGHT,
      feather: "auto",
    });
    if (!ctrl) return;

    let raf = 0;
    let currentDir: Direction = "ttb";
    const startTime = performance.now();

    ctrl.setDirection(currentDir);
    ctrl.setProgress(PROGRESS_START);
    ctrl.setAlpha(0.01);

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const alpha = Math.min(1, elapsed / FADE_IN_MS);
      const passIndex = Math.floor(elapsed / PASS_MS);
      const passT = (elapsed % PASS_MS) / PASS_MS;
      const nextDir: Direction = passIndex % 2 === 0 ? "ttb" : "btt";

      if (nextDir !== currentDir) {
        currentDir = nextDir;
        ctrl.setDirection(currentDir);
      }

      // Smooth cosine turnaround so the band kisses each edge and reverses immediately.
      const eased = 0.5 * (1 - Math.cos(Math.PI * passT));
      ctrl.setProgress(
        PROGRESS_START + eased * (PROGRESS_END - PROGRESS_START),
      );
      ctrl.setAlpha(Math.max(0.01, alpha));

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ctrl.setAlpha(0);
      ctrl.destroy();
    };
  }, [active]);

  return (
    <div className="space-y-3">
      <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-[22px] border border-border bg-card">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Receipt being scanned"
            className="block max-h-[62vh] w-auto max-w-full object-contain"
            draggable={false}
          />
        ) : (
          <div className="flex h-48 w-56 items-center justify-center bg-muted text-sm text-muted-foreground">
            Loading preview…
          </div>
        )}
        <canvas
          ref={canvasRef}
          data-dw-skip=""
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden
        />
      </div>

      <div className="flex items-center justify-center gap-3">
        <div className="flex items-end gap-1" aria-hidden>
          <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
          <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:120ms]" />
          <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:240ms]" />
        </div>
        <p className="text-sm text-foreground">{statusText}</p>
      </div>
    </div>
  );
}
