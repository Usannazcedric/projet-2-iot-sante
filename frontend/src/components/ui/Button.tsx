import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-purple-600 text-white hover:bg-purple-700",
  secondary: "bg-zinc-800 text-white border border-purple-500 hover:bg-zinc-700",
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost: "text-zinc-300 hover:bg-zinc-800",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, Props>(({ variant = "primary", className = "", ...rest }, ref) => (
  <button
    ref={ref}
    className={`inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none ${VARIANTS[variant]} ${className}`}
    {...rest}
  />
));
Button.displayName = "Button";
