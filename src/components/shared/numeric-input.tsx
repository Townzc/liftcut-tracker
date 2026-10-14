"use client";

import { useState } from "react";
import type { ComponentProps } from "react";

import { Input } from "@/components/ui/input";

interface NumericInputBaseProps
  extends Omit<
    ComponentProps<typeof Input>,
    "type" | "value" | "onChange" | "inputMode"
  > {
  allowDecimal?: boolean;
}

type NumericInputProps = NumericInputBaseProps & (
  | { nullable: true; value: number | null; onValueChange: (value: number | null) => void }
  | { nullable?: false; value: number; onValueChange: (value: number) => void }
);

function isValidDraftValue(value: string, allowDecimal: boolean): boolean {
  if (value === "") {
    return true;
  }

  return allowDecimal ? /^\d*\.?\d*$/.test(value) : /^\d*$/.test(value);
}

export function NumericInput({
  value,
  onValueChange,
  nullable,
  allowDecimal = true,
  min,
  max,
  step,
  onBlur,
  onFocus,
  ...props
}: NumericInputProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftValue, setDraftValue] = useState("");
  const displayValue = value === null ? "" : String(value);
  const inputValue = isEditing ? draftValue : displayValue;

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    if (!isValidDraftValue(nextValue, allowDecimal)) {
      return;
    }

    setDraftValue(nextValue);

    if (nextValue === "") {
      if (nullable) onValueChange(null);
      return;
    }

    const parsed = Number(nextValue);
    if (Number.isFinite(parsed)) {
      onValueChange(parsed);
    }
  };

  const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    setIsEditing(false);

    if (draftValue === "") {
      setDraftValue("");
    } else {
      const parsed = Number(draftValue);
      if (Number.isFinite(parsed)) {
        let normalized = parsed;

        // Optional reported values are validated when saved, not silently replaced.
        if (!nullable && typeof min === "number" && normalized < min) {
          normalized = min;
        }

        if (!nullable && typeof max === "number" && normalized > max) {
          normalized = max;
        }

        if (normalized !== parsed) {
          onValueChange(normalized);
        }
      }
      setDraftValue("");
    }
    onBlur?.(event);
  };

  const handleFocus = (event: React.FocusEvent<HTMLInputElement>) => {
    setIsEditing(true);
    setDraftValue(displayValue);
    event.currentTarget.select();
    onFocus?.(event);
  };

  return (
    <Input
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      value={inputValue}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={handleFocus}
      min={min}
      max={max}
      step={step}
      {...props}
    />
  );
}
