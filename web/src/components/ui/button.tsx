import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "lg" | "hero";

const VARIANTS: Readonly<Record<Variant, string>> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  secondary: "border border-border text-foreground hover:bg-secondary",
  ghost: "text-muted-foreground hover:text-foreground",
};

const SIZES: Readonly<Record<Size, string>> = {
  md: "px-5 py-2.5 text-sm",
  lg: "px-6 py-3 text-base",
  // Used for the challenge response: it must be unmissable and easy to hit.
  hero: "w-full px-8 py-10 text-2xl font-semibold tracking-tight",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant;
  readonly size?: Size;
  readonly children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium",
        "transition-colors duration-200",
        // Disabled must look inert and not merely dimmed: a control that looks
        // tappable but does nothing is its own usability failure.
        "disabled:cursor-not-allowed disabled:opacity-40",
        "not-disabled:cursor-pointer",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
