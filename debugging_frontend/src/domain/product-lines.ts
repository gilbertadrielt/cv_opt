import type { ProductLine } from "./types";

/**
 * The product lines this station is qualified to inspect.
 *
 * Declared `as const` so `ProductLineId` is a closed union — a typo in a line id
 * becomes a compile error rather than an empty knowledge base at runtime.
 */
export const PRODUCT_LINES = [
  {
    id: "ryzen-9000",
    name: "Ryzen 9000 Series",
    packaging: "AM5 · LGA-1718",
    family: "lga",
    model: "lga-pkg-v4.2",
  },
  {
    id: "ryzen-7000",
    name: "Ryzen 7000 Series",
    packaging: "AM5 · LGA-1718",
    family: "lga",
    model: "lga-pkg-v4.2",
  },
  {
    id: "epyc-9005",
    name: "EPYC 9005 (Turin)",
    packaging: "SP5 · LGA-6096",
    family: "lga",
    model: "lga-server-v2.0",
  },
  {
    id: "tr-7000wx",
    name: "Ryzen Threadripper PRO 7000WX",
    packaging: "sTR5 · LGA-4844",
    family: "lga",
    model: "lga-server-v2.0",
  },
  {
    id: "rx-7900xtx",
    name: "Radeon RX 7900 XTX",
    packaging: "Board-level AIB",
    family: "board",
    model: "board-aib-v3.1",
  },
  {
    id: "mi300x",
    name: "Instinct MI300X",
    packaging: "OAM · SH5",
    family: "oam",
    model: "oam-pkg-v1.4",
  },
] as const satisfies readonly ProductLine[];

export type ProductLineId = (typeof PRODUCT_LINES)[number]["id"];

export const DEFAULT_PRODUCT_LINE_ID: ProductLineId = PRODUCT_LINES[0].id;

const BY_ID = new Map<string, ProductLine>(PRODUCT_LINES.map((line) => [line.id, line]));

export function findProductLine(id: string | null | undefined): ProductLine | undefined {
  return id == null ? undefined : BY_ID.get(id);
}

export function isProductLineId(id: string): id is ProductLineId {
  return BY_ID.has(id);
}

/**
 * Like `findProductLine` but throws. Use only where the id provably came from
 * `PRODUCT_LINES` (e.g. a `ProductLineId`-typed value) and a miss is a bug.
 */
export function requireProductLine(id: ProductLineId): ProductLine {
  const line = BY_ID.get(id);
  if (!line) throw new Error(`Unknown product line: ${id}`);
  return line;
}
