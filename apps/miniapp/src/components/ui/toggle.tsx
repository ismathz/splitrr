import * as React from "react";

import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition-[transform,background-color,color,border-color] duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "",
        outline: "",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type ToggleProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof toggleVariants> & {
    pressed?: boolean;
    onPressedChange?: (pressed: boolean) => void;
  };

function Toggle({
  className,
  variant,
  pressed = false,
  onPressedChange,
  type = "button",
  onClick,
  ...props
}: ToggleProps) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      data-state={pressed ? "on" : "off"}
      className={cn(
        toggleVariants({ variant }),
        pressed
          ? "border-white/[0.18] bg-white/[0.14] text-foreground"
          : "border-transparent bg-white/[0.055] text-[#b4b4b4] hover:bg-white/[0.09] hover:text-foreground",
        className,
      )}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        onPressedChange?.(!pressed);
      }}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
