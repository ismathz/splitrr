import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "@/lib/utils";

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverPortal({ ...props }: PopoverPrimitive.Portal.Props) {
  return <PopoverPrimitive.Portal data-slot="popover-portal" {...props} />;
}

function PopoverPositioner({ ...props }: PopoverPrimitive.Positioner.Props) {
  return (
    <PopoverPrimitive.Positioner data-slot="popover-positioner" {...props} />
  );
}

function PopoverContent({
  className,
  sideOffset = 8,
  align = "center",
  ...props
}: PopoverPrimitive.Popup.Props & {
  sideOffset?: number;
  align?: PopoverPrimitive.Positioner.Props["align"];
}) {
  return (
    <PopoverPortal>
      <PopoverPositioner sideOffset={sideOffset} align={align}>
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "z-50 min-w-36 rounded-[16px] border border-white/[0.08] bg-popover p-1 text-foreground shadow-none ring-1 ring-white/[0.08] outline-none data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            className,
          )}
          {...props}
        />
      </PopoverPositioner>
    </PopoverPortal>
  );
}

export { Popover, PopoverContent, PopoverPortal, PopoverPositioner, PopoverTrigger };
