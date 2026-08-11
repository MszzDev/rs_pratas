import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
}

/**
 * Campo com label sempre associado ao input e erro anunciado por leitor de
 * tela. O erro também não depende só de cor — traz texto —, para atender quem
 * não distingue o vermelho.
 */
export const Field = forwardRef<HTMLInputElement, FieldProps>(
  ({ label, error, hint, className, id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;
    const hintId = `${inputId}-hint`;

    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-sm font-medium text-text-secondary">
          {label}
        </label>

        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={cn(error && errorId, hint && hintId) || undefined}
          className={cn(
            "min-h-[48px] rounded-md border bg-surface px-4 text-base text-text-primary outline-none transition-colors",
            "placeholder:text-text-muted focus:border-rose-primary focus:ring-2 focus:ring-rose-soft",
            error ? "border-danger" : "border-border",
            className,
          )}
          {...props}
        />

        {hint && (
          <p id={hintId} className="text-sm text-text-muted">
            {hint}
          </p>
        )}

        {error && (
          <p id={errorId} role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    );
  },
);

Field.displayName = "Field";
