/**
 * Whether a row stamped with `rowAccountId` belongs to the signed-in `accountId` (whole-app review
 * 8.5, L3-1). Shared by the strength and run stores, which is why it lives in its own module rather
 * than in either of them (they already import each other).
 *
 * Nobody signed in owns nothing. A row with no account predates the v4 migration and is claimed by
 * whoever is signed in, which is what every row did before -- only existing dev installs have any.
 */
export function belongsToAccount(rowAccountId: string | null, accountId: string | null): boolean {
  if (accountId === null) return false;
  return rowAccountId === null || rowAccountId === accountId;
}
