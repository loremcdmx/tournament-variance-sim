"use client";

import type { ComponentPropsWithRef, CSSProperties } from "react";

type RangeInputProps = Omit<
  ComponentPropsWithRef<"input">,
  "type" | "value" | "defaultValue"
> & {
  value: number | string;
};

export function RangeInput({
  value,
  min,
  max,
  className,
  style,
  ...props
}: RangeInputProps) {
  const lower = Number(min ?? 0);
  const upper = Number(max ?? 100);
  const current = Number(value);
  const progress =
    Number.isFinite(lower) &&
    Number.isFinite(upper) &&
    Number.isFinite(current) &&
    upper > lower
      ? Math.max(0, Math.min(100, ((current - lower) / (upper - lower)) * 100))
      : 0;
  const rangeStyle: CSSProperties & { "--range-progress": string } = {
    "--range-progress": `${progress}%`,
    ...style,
  };

  return (
    <input
      {...props}
      type="range"
      min={min}
      max={max}
      value={value}
      className={className ? `range-control ${className}` : "range-control"}
      style={rangeStyle}
    />
  );
}
