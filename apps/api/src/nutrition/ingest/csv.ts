import { writeFileSync } from "fs";

/**
 * Minimal CSV read/write helpers shared by `fetch-usda.ts` and the Phase D adapter/normalizer.
 * Extracted from `fetch-usda.ts` (Phase A) rather than duplicated, once a second file needed
 * the same row splitter and column lookup.
 *
 * The splitter assumes USDA's own export shape: every field double-quoted, comma-separated, no
 * embedded commas or quotes inside a field -- verified against the real files at this pin.
 */

export interface CsvTable {
  readonly header: string[];
  readonly rows: string[][];
}

function splitRow(line: string): string[] {
  return line.split('","').map((field, index, all) => {
    if (index === 0) return field.replace(/^"/, "");
    if (index === all.length - 1) return field.replace(/"$/, "");
    return field;
  });
}

export function parseCsv(raw: string): CsvTable {
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  const headerLine = lines[0];
  if (headerLine === undefined) {
    throw new Error("empty CSV: no header row");
  }
  return { header: splitRow(headerLine), rows: lines.slice(1).map(splitRow) };
}

export function writeCsv(path: string, header: string[], rows: string[][]): void {
  const quote = (value: string): string => `"${value}"`;
  const body = [header, ...rows].map((row) => row.map(quote).join(",")).join("\n");
  writeFileSync(path, `${body}\n`, "utf8");
}

export function col(header: string[], name: string): number {
  const index = header.indexOf(name);
  if (index === -1) {
    throw new Error(`column "${name}" not found in header: ${header.join(", ")}`);
  }
  return index;
}
