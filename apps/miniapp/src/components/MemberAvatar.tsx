import { useState } from "react";

import { cn } from "@/lib/utils";

/** Bencho-style radial orb palettes (circle closest-side, 4 stops). */
const ORB_PALETTES = [
  ["#f03c97", "#f4518f", "#f97c7c", "#fdb06b"],
  ["#8b3cf0", "#a24fe6", "#d071c8", "#f6a0b8"],
  ["#3c5df0", "#4f7cf0", "#5fb0f2", "#7fe0f0"],
  ["#12b5a0", "#2fc39a", "#7bd88a", "#c8ec7a"],
  ["#4a3cf0", "#6a4fe8", "#a874d8", "#f0a2c8"],
  ["#ff4f6e", "#ff6a78", "#ff9a8a", "#ffcf9e"],
  ["#b03cf0", "#9c55ee", "#7d86f0", "#6fb6f6"],
  ["#e8417a", "#ec5c94", "#e690c9", "#d9b8f2"],
  ["#10b981", "#26c39a", "#5fd6c6", "#9eeaf0"],
  ["#2f9bf0", "#4cb0ee", "#7fd0d8", "#b4f0c8"],
  ["#d63cf0", "#e351c8", "#f07f96", "#fbb46e"],
  ["#f05a1c", "#f47045", "#f7948a", "#f9c2c8"],
] as const;

function hashName(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return h;
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return initials || name.slice(0, 2).toUpperCase();
}

function rgb24IntToCss(n: number) {
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return { r, g, b, css: `rgb(${r} ${g} ${b})` };
}

function pickReadableForegroundFromRgb(r: number, g: number, b: number) {
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.55 ? "#111827" : "#ffffff";
}

function orbBackground(name: string) {
  const palette = ORB_PALETTES[hashName(name) % ORB_PALETTES.length];
  return `radial-gradient(circle closest-side, ${palette[0]} 0%, ${palette[1]} 34%, ${palette[2]} 68%, ${palette[3]} 100%)`;
}

export function MemberAvatar({
  name,
  avatarBgColors,
  photoUrl,
  className,
  sizeClassName = "h-6 w-6 text-[11px]",
}: {
  name: string;
  avatarBgColors?: number[];
  photoUrl?: string;
  className?: string;
  sizeClassName?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  if (photoUrl && !imgFailed) {
    return (
      <img
        src={photoUrl}
        alt=""
        className={cn(
          "shrink-0 rounded-full object-cover",
          sizeClassName,
          className,
        )}
        onError={() => setImgFailed(true)}
      />
    );
  }

  const initials = getInitials(name);
  const bg = avatarBgColors && avatarBgColors.length ? avatarBgColors : null;

  let backgroundColor: string | undefined;
  let backgroundImage: string | undefined;
  let foregroundColor: string;

  if (bg && bg.length) {
    const c0 = rgb24IntToCss(bg[0]);
    const c1 = bg.length >= 2 ? rgb24IntToCss(bg[1]) : null;
    backgroundColor = c0.css;
    foregroundColor = pickReadableForegroundFromRgb(c0.r, c0.g, c0.b);
    if (c1) {
      backgroundImage = `linear-gradient(135deg, ${c0.css}, ${c1.css})`;
    }
  } else {
    backgroundImage = orbBackground(name);
    foregroundColor = "#ffffff";
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-medium",
        sizeClassName,
        className,
      )}
      style={{ backgroundColor, backgroundImage, color: foregroundColor }}
    >
      {initials}
    </span>
  );
}
