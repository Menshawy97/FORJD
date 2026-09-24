/**
 * The test date read off an InBody sheet, as a local calendar day, or null when it is not a
 * real date. The confirm screen falls back to today on null -- a device test once showed
 * "NaN/NaN/NaN" there, from a sheet that prints its date as "2025.08.02".
 *
 * Parsed by hand rather than `new Date(text)`: that reads "2025-08-02" as UTC midnight, which is
 * the previous day anywhere west of Greenwich, and cannot read the dotted form at all.
 */
export function parseSheetDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const match = raw.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}
