"use client";

import { isProductLineId, PRODUCT_LINES, type ProductLineId } from "@/domain/product-lines";
import { Select, type SelectProps } from "./ui/controls";

export interface ProductLineSelectProps
  extends Omit<SelectProps, "value" | "onChange" | "label" | "children"> {
  value: ProductLineId | null;
  onChange: (lineId: ProductLineId | null) => void;
  label?: string;
  /** Adds a "Select a line…" option. Required wherever no line is a valid state. */
  placeholder?: string;
}

/**
 * The product line picker, shared by Inspect, the knowledge base editor, and
 * the feedback tool.
 *
 * Narrows the raw `<select>` string back to `ProductLineId` at this one
 * boundary, so nothing downstream has to re-validate it.
 */
export function ProductLineSelect({
  value,
  onChange,
  label = "Product line",
  placeholder,
  ...props
}: ProductLineSelectProps) {
  return (
    <Select
      label={label}
      value={value ?? ""}
      onChange={(event) => {
        const next = event.target.value;
        onChange(isProductLineId(next) ? next : null);
      }}
      {...props}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {PRODUCT_LINES.map((line) => (
        <option key={line.id} value={line.id}>
          {line.name}
        </option>
      ))}
    </Select>
  );
}
