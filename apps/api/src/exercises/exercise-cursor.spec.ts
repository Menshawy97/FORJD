import { decodeExerciseCursor, encodeExerciseCursor } from "./exercise-cursor";

/**
 * The cursor is opaque on the wire but is not a secret and is not tamper-proof -- it names a
 * position in a list the caller is already allowed to read, so forging one buys nothing that
 * a different `q` would not. What it must do is survive a round trip through a URL intact,
 * and refuse anything it did not produce rather than passing rubbish into a SQL comparison.
 */
describe("exercise cursor", () => {
  const cursor = { name: "Barbell Bench Press", id: "11111111-1111-4111-8111-111111111111" };

  it("round-trips a cursor", () => {
    expect(decodeExerciseCursor(encodeExerciseCursor(cursor))).toEqual(cursor);
  });

  /**
   * Base64url, not base64. A `+` in a plain-base64 cursor is a space once it has been through
   * a query string, and the cursor comes back as something that no longer decodes -- an
   * intermittent 400 that only appears for certain names.
   */
  it("encodes to a URL-safe string with no padding or query-hostile characters", () => {
    const encoded = encodeExerciseCursor(cursor);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("round-trips a name with characters a URL would otherwise mangle", () => {
    const awkward = { name: 'Farmer’s Walk / "Heavy" +50%', id: cursor.id };

    expect(decodeExerciseCursor(encodeExerciseCursor(awkward))).toEqual(awkward);
  });

  it("round-trips a non-ASCII name", () => {
    const accented = { name: "Étirement du psoas", id: cursor.id };

    expect(decodeExerciseCursor(encodeExerciseCursor(accented))).toEqual(accented);
  });

  it("rejects a string that is not base64 at all", () => {
    expect(decodeExerciseCursor("not a cursor!!")).toBeNull();
  });

  it("rejects base64 that does not decode to JSON", () => {
    expect(decodeExerciseCursor(Buffer.from("nonsense").toString("base64url"))).toBeNull();
  });

  it("rejects JSON that is not a cursor object", () => {
    expect(decodeExerciseCursor(Buffer.from("[1,2,3]").toString("base64url"))).toBeNull();
  });

  it("rejects a cursor missing its name", () => {
    const forged = Buffer.from(JSON.stringify({ id: cursor.id })).toString("base64url");

    expect(decodeExerciseCursor(forged)).toBeNull();
  });

  /**
   * The id reaches a `::uuid` cast in the keyset comparison. A non-uuid there is a Postgres
   * cast error, which surfaces as a 500 -- so it is rejected here, where it becomes the 400
   * it actually is.
   */
  it("rejects a cursor whose id is not a uuid", () => {
    const forged = Buffer.from(JSON.stringify({ name: "x", id: "not-a-uuid" })).toString(
      "base64url",
    );

    expect(decodeExerciseCursor(forged)).toBeNull();
  });

  it("rejects a cursor whose name is not a string", () => {
    const forged = Buffer.from(JSON.stringify({ name: 42, id: cursor.id })).toString("base64url");

    expect(decodeExerciseCursor(forged)).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(decodeExerciseCursor("")).toBeNull();
  });
});
