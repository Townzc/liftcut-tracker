"use client";

import { useState } from "react";
import type { ComponentProps } from "react";

import { Input } from "@/components/ui/input";

interface NumericInputProps
  extends Omit<
    ComponentProps<typeof Input>,
    "type" | "value" | "onChange" | "inputMode"
  > {
  value: number;
  onValueChange: (value: number) => void;
  allowDecimal?: boolean;
}

function isValidDraftValue(value: string, allowDecimal: boolean): boolean {
  if (value === "") {
    return true;
  }

  return allowDecimal ? /^\d*\.?\d*$/.test(value) : /^\d*$/.test(value);
}

export function NumericInput({
  value,
  onValueChange,
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
  const inputValue = isEditing ? draftValue : String(value);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    if (!isValidDraftValue(nextValue, allowDecimal)) {
      return;
    }

    setDraftValue(nextValue);

    if (nextValue === "") {
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

        if (typeof min === "number" && normalized < min) {
          normalized = min;
        }

        if (typeof max === "number" && normalized > max) {
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
    setDraftValue(String(value));
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
