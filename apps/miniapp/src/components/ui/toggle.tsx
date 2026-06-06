import * as React from "react";

import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-medium transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
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
          ? "border-border bg-input/60 text-foreground hover:bg-input/80"
          : "border-transparent bg-transparent hover:bg-input/20 hover:text-foreground",
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
