import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DistortionWave,
  defaultStyle,
  duration,
  snapshot,
  type CaptureFunction,
  type DistortionWaveHandle,
} from "distortion-waves";

const PANEL_CLASS =
  "mx-auto h-full w-full max-w-md overflow-y-auto bg-background px-4 py-5 pt-[max(1.25rem,env(safe-area-inset-top))] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

const PREPARE_TIMEOUT_MS = 500;
const WAVE_DURATION_MS = Math.ceil(duration(defaultStyle("vertical")) * 1000);
const SAFETY_TIMEOUT_MS = WAVE_DURATION_MS + 1500;

/**
 * Tailwind v4 preflight sets `border: 0 solid` (`border-style: solid` with
 * `border-width: 0px`) on all elements. When distortion-waves diffs computed
 * styles against a plain `<div>` (`border-style: none`, computed width `0px`),
 * it copies `border-style: solid` while omitting `border-width: 0px`, which
 * falls back to CSS `medium` (3px) inside the SVG foreignObject snapshot and
 * shifts every nested box. Explicitly forcing `0px` widths keeps the snapshot
 * pixel-aligned with the live DOM.
 */
const captureWithoutGhostBorders: CaptureFunction = async ({
  element,
  slot,
  width,
  height,
  scale,
  background,
  ignore,
}) => {
  const rootStyle = getComputedStyle(element);
  const bl = parseFloat(rootStyle.borderLeftWidth) || 0;
  const bt = parseFloat(rootStyle.borderTopWidth) || 0;
  const br = parseFloat(rootStyle.borderRightWidth) || 0;
  const bb = parseFloat(rootStyle.borderBottomWidth) || 0;
  const bw = width + bl + br;
  const bh = height + bt + bb;
  const targetLayer = element.querySelector(`[data-dw-layer="${slot}"]`);

  const result = await snapshot(element, {
    width,
    height,
    scale,
    background,
    skip: ignore,
    force: (el) => {
      const cs = getComputedStyle(el);
      let overrides: Record<string, string> | undefined;

      if (el === element) {
        overrides = {
          "border-radius": "0",
          position: "absolute",
          left: `${-bl}px`,
          top: `${-bt}px`,
          right: "auto",
          bottom: "auto",
          margin: "0",
          transform: "none",
          translate: "none",
          rotate: "none",
          scale: "none",
          opacity: "1",
          visibility: "visible",
          width: `${bw}px`,
          height: `${bh}px`,
          "box-sizing": "border-box",
          "min-width": "0",
          "min-height": "0",
          "max-width": "none",
          "max-height": "none",
        };
      } else if (el === targetLayer) {
        overrides = {
          opacity: "1",
          visibility: "visible",
        };
      }

      if (cs.borderTopWidth === "0px" && cs.borderTopStyle !== "none") {
        (overrides ??= {})["border-top-width"] = "0px";
      }
      if (cs.borderRightWidth === "0px" && cs.borderRightStyle !== "none") {
        (overrides ??= {})["border-right-width"] = "0px";
      }
      if (cs.borderBottomWidth === "0px" && cs.borderBottomStyle !== "none") {
        (overrides ??= {})["border-bottom-width"] = "0px";
      }
      if (cs.borderLeftWidth === "0px" && cs.borderLeftStyle !== "none") {
        (overrides ??= {})["border-left-width"] = "0px";
      }

      return overrides;
    },
  });

  return result.canvas;
};

export interface ReceiptScanTransitionProps {
  readyToReveal: boolean;
  scanContent: ReactNode;
  revealedContent: ReactNode;
  onComplete: () => void;
}

export function ReceiptScanTransition({
  readyToReveal,
  scanContent,
  revealedContent,
  onComplete,
}: ReceiptScanTransitionProps) {
  const waveRef = useRef<DistortionWaveHandle>(null);
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const [revealed, setRevealed] = useState(false);

  const finish = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onCompleteRef.current();
  }, []);

  useEffect(() => {
    if (!readyToReveal || revealed || completedRef.current) return;

    let cancelled = false;
    let raf1 = 0;
    let raf2 = 0;
    let prepareTimeout = 0;

    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        void (async () => {
          try {
            const preparePromise = waveRef.current?.prepare();
            if (preparePromise) {
              await Promise.race([
                preparePromise,
                new Promise<void>((resolve) => {
                  prepareTimeout = window.setTimeout(
                    resolve,
                    PREPARE_TIMEOUT_MS,
                  );
                }),
              ]);
            }
          } catch {
            // prepare() can fail without WebGL2; DistortionWave still crossfades.
          } finally {
            if (prepareTimeout) {
              window.clearTimeout(prepareTimeout);
              prepareTimeout = 0;
            }
          }
          if (cancelled) return;
          setRevealed(true);
        })();
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (prepareTimeout) {
        window.clearTimeout(prepareTimeout);
        prepareTimeout = 0;
      }
    };
  }, [readyToReveal, revealed]);

  useEffect(() => {
    if (!revealed || completedRef.current) return;
    const timer = window.setTimeout(() => {
      finish();
    }, SAFETY_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [revealed, finish]);

  return (
    <DistortionWave
      ref={waveRef}
      revealed={revealed}
      type="vertical"
      palette="colorful"
      prewarm
      capture={captureWithoutGhostBorders}
      className="fixed inset-0 z-30 overflow-hidden bg-background"
      style={{
        width: "100%",
        height: "100%",
        gridTemplateRows: "minmax(0, 1fr)",
      }}
      onFinish={(isRevealed) => {
        if (isRevealed) finish();
      }}
      revealedContent={<div className={PANEL_CLASS}>{revealedContent}</div>}
    >
      <div className={PANEL_CLASS}>{scanContent}</div>
    </DistortionWave>
  );
}
