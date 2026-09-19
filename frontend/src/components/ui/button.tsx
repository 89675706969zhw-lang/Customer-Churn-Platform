import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

const variants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium min-h-11 px-4 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 shrink-0",
  {
    variants: {
      variant: {
        default: "bg-violet-700 text-white hover:bg-violet-800 shadow-sm",
        outline:
          "border border-zinc-200 bg-white text-zinc-700 hover:bg-violet-50 hover:border-violet-300",
        ghost: "text-zinc-600 hover:bg-violet-50 hover:text-violet-800",
      },
    },
    defaultVariants: { variant: "default" },
  },
);
export function Button({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof variants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={twMerge(clsx(variants({ variant }), className))}
      {...props}
    />
  );
}
