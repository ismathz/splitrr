import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpDownIcon,
  ChevronUpIcon,
  DocumentIcon,
  EllipsisVerticalIcon,
  PhotoIcon,
  QrCodeIcon,
  TrashIcon,
  UserGroupIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { CheckIcon as CheckIconSolid } from "@heroicons/react/24/solid";
import type { ComponentProps, ComponentType, SVGProps } from "react";

import { cn } from "@/lib/utils";

const icons = {
  IconAddImage: PhotoIcon,
  IconArrowLeft: ArrowLeftIcon,
  IconCalendar: CalendarDaysIcon,
  IconCheck: CheckIconSolid,
  IconCheckmark1: CheckIcon,
  IconChevronDownMedium: ChevronDownIcon,
  IconChevronGrabberVertical: ChevronUpDownIcon,
  IconChevronTopMedium: ChevronUpIcon,
  IconCrossMedium: XMarkIcon,
  IconDotGrid1x3Vertical: EllipsisVerticalIcon,
  IconPageEmpty: DocumentIcon,
  IconPeople: UserGroupIcon,
  IconScanCode: QrCodeIcon,
  IconTrashCanSimple: TrashIcon,
} as const;

export type IconName = keyof typeof icons;

type HeroIconProps = SVGProps<SVGSVGElement> & {
  title?: string;
  titleId?: string;
};

export type IconProps = {
  name: IconName;
  size?: number | string;
  className?: string;
  color?: string;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
} & Omit<HeroIconProps, "name" | "className" | "color" | "width" | "height">;

/**
 * App icon wrapper around Heroicons (24 outline).
 */
export function Icon({
  name,
  size = 20,
  className,
  color,
  style,
  ...props
}: IconProps) {
  const Component = icons[name] as ComponentType<
    ComponentProps<(typeof icons)[IconName]>
  >;
  const px = typeof size === "number" ? size : undefined;

  return (
    <Component
      className={cn("shrink-0", className)}
      style={{
        width: px ?? size,
        height: px ?? size,
        color,
        ...style,
      }}
      aria-hidden={props["aria-label"] ? undefined : true}
      {...props}
    />
  );
}
