"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";

/** A labelled text input in the settings register (12px label, 36px control). */
export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
  className = "",
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
  className?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-[12px] font-semibold text-t3">
        {label}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        className="h-9 rounded-control border-line-strong bg-hover text-[13px] placeholder:text-t3 dark:bg-hover"
      />
    </div>
  );
}
