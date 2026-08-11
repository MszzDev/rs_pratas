import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Altura mínima de 48px em todas as variantes: o alvo de toque recomendado
 * para uso em tablet, operado em pé e com pressa no balcão.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-rose-primary text-white hover:bg-rose-dark",
        secondary: "bg-rose-soft text-rose-dark hover:bg-rose-light hover:text-white",
        outline: "border border-border bg-surface text-text-primary hover:bg-background-secondary",
        ghost: "text-text-secondary hover:bg-background-secondary",
        danger: "bg-danger text-white hover:opacity-90",
      },
      size: {
        md: "min-h-[48px] px-5 text-base",
        lg: "min-h-[56px] px-7 text-lg",
        icon: "h-12 w-12",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);

Button.displayName = "Button";
