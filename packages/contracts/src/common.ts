import { z } from 'zod';

/* ------------------------------------------------------------------------------------------
 * Lists
 * ---------------------------------------------------------------------------------------- */

/**
 * The house envelope for every list endpoint, starting with exercises (Phase 2, Phase E).
 * Before this, every endpoint in /api/v1 returned a single object and there was no
 * pagination anywhere — so this shape is being chosen once, deliberately, rather than
 * re-invented per endpoint later.
 *
 * **Cursor, not page number.** Offset pagination re-reads the skipped rows on every page and
 * silently shifts its window when a row is inserted or removed mid-scroll: the reader sees a
 * duplicate or misses an item, and neither shows up as an error. A keyset cursor names the
 * last row seen, so the next page starts exactly where the previous one stopped regardless
 * of what changed in between.
 *
 * **`nextCursor` is required and nullable, never optional.** `null` means "this was the last
 * page" — a positive statement the client can act on. An omitted field would make "no more
 * results" and "the server forgot to send it" the same value on the wire, and a paging loop
 * that treats absence as end-of-list would silently truncate somebody's exercise library the
 * first time a serialiser dropped an undefined key.
 *
 * **No total count.** Counting the full match set costs a second query on every page for a
 * number that is stale before it is rendered, and nothing in the design displays one. Adding
 * a field later is a compatible change; removing one is not (rule 7).
 *
 * The cursor is opaque by contract: clients echo it back and never construct or parse one.
 * Its encoding is an API implementation detail and is free to change without a contract
 * version, which is only true for as long as nothing outside the API reads it.
 */
export const listResponseSchema = <TItem extends z.ZodTypeAny>(itemSchema: TItem) =>
  z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().nullable(),
  });
