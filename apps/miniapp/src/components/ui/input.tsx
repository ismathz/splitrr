import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const inputVariants = cva(
  "flex w-full border bg-white/[0.055] text-foreground shadow-none outline-none transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:border-white/25 focus-visible:bg-white/[0.08] focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20",
  {
    variants: {
      variant: {
        default: "h-10 rounded-[12px] border-white/[0.08] px-3 text-sm",
        search: "h-10 rounded-[12px] border-white/[0.08] px-4 text-sm",
        compact: "h-8 rounded-[12px] border-white/[0.08] px-2.5 text-xs",
        title:
          "h-10 rounded-[12px] border-white/[0.08] px-3 text-lg font-medium tracking-[-0.02em]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Input({
  className,
  variant,
  type = "text",
  ...props
}: React.ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(inputVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Input, inputVariants };
