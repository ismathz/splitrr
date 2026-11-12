/**
 * Pick a receipt image from camera or gallery.
 *
 * Telegram Android WebViews often ignore `<input capture>` and open the
 * gallery instead. For camera we prefer getUserMedia → canvas snapshot when
 * available, then fall back to a programmatically created file input with
 * `capture="environment"` set via setAttribute (avoids React attribute quirks).
 */

export type ReceiptImageSource = "camera" | "gallery";

function createFileInput(opts: {
  capture?: "environment";
}): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = false;
  input.style.position = "fixed";
  input.style.left = "-9999px";
  input.style.top = "0";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";
  if (opts.capture) {
    input.setAttribute("capture", opts.capture);
  }
  document.body.appendChild(input);
  return input;
}

function pickViaFileInput(source: ReceiptImageSource): Promise<File | null> {
  return new Promise((resolve) => {
    const input = createFileInput(
      source === "camera" ? { capture: "environment" } : {},
    );
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(file);
    };
    const onChange = () => {
      const file = input.files?.[0] ?? null;
      finish(file);
    };
    const onFocus = () => {
      // If the user cancels the picker, change may never fire.
      window.setTimeout(() => {
        if (!settled && (!input.files || input.files.length === 0)) {
          finish(null);
        }
      }, 750);
    };
    const cleanup = () => {
      input.removeEventListener("change", onChange);
      window.removeEventListener("focus", onFocus);
      input.remove();
    };
    input.addEventListener("change", onChange);
    window.addEventListener("focus", onFocus);
    input.click();
  });
}

function telegramPlatform(): string {
  try {
    const wa = (
      window as unknown as {
        Telegram?: { WebApp?: { platform?: string } };
      }
    ).Telegram?.WebApp;
    return (wa?.platform ?? "").toLowerCase();
  } catch {
    return "";
  }
}

async function captureViaGetUserMedia(): Promise<File | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Take receipt photo");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:99999;background:#0b0b0c;display:flex;flex-direction:column;align-items:stretch;";

    const video = document.createElement("video");
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
    video.style.cssText = "flex:1;width:100%;object-fit:cover;background:#000;";
    video.srcObject = stream;

    const bar = document.createElement("div");
    bar.style.cssText =
      "display:flex;gap:12px;padding:16px;padding-bottom:max(16px,env(safe-area-inset-bottom));background:#111;justify-content:center;";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.cssText =
      "flex:1;max-width:160px;height:48px;border-radius:12px;border:1px solid #333;background:#1c1c1e;color:#fff;font:600 15px/1 system-ui;";

    const shootBtn = document.createElement("button");
    shootBtn.type = "button";
    shootBtn.textContent = "Capture";
    shootBtn.style.cssText =
      "flex:1;max-width:160px;height:48px;border-radius:12px;border:0;background:#fff;color:#111;font:600 15px/1 system-ui;";

    bar.append(cancelBtn, shootBtn);
    overlay.append(video, bar);
    document.body.appendChild(overlay);

    const stop = () => {
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
      overlay.remove();
    };

    cancelBtn.onclick = () => {
      stop();
      resolve(null);
    };

    shootBtn.onclick = () => {
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        stop();
        resolve(null);
        return;
      }
      ctx.drawImage(video, 0, 0, w, h);
      stop();
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(null);
            return;
          }
          resolve(
            new File([blob], `receipt-${Date.now()}.jpg`, {
              type: "image/jpeg",
            }),
          );
        },
        "image/jpeg",
        0.92,
      );
    };

    void video.play().catch(() => {
      /* autoplay may fail; user can still capture after paint */
    });
  });
}

/**
 * Open camera or gallery and return the selected image file (or null if cancelled).
 */
export async function pickReceiptImage(
  source: ReceiptImageSource,
): Promise<File | null> {
  if (source === "gallery") {
    return pickViaFileInput("gallery");
  }

  // Android Telegram WebView often ignores capture= and opens the gallery.
  // Prefer an in-app camera stream there; still fall back to capture input.
  const platform = telegramPlatform();
  const preferLiveCamera =
    platform === "android" ||
    platform === "android_x" ||
    /android/i.test(navigator.userAgent);

  if (preferLiveCamera) {
    try {
      const live = await captureViaGetUserMedia();
      if (live) return live;
    } catch {
      // Permission denied / unsupported — fall through to file input.
    }
  }

  return pickViaFileInput("camera");
}
