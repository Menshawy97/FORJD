import { decodeWorkoutTemplateCursor, encodeWorkoutTemplateCursor } from "./workout-cursor";

/** Mirrors exercise-cursor.spec.ts exactly -- same shape, same opaque-not-secret contract. */
describe("workout template cursor", () => {
  const cursor = { name: "Upper Push", id: "11111111-1111-4111-8111-111111111111" };

  it("round-trips a cursor", () => {
    expect(decodeWorkoutTemplateCursor(encodeWorkoutTemplateCursor(cursor))).toEqual(cursor);
  });

  it("encodes to a URL-safe string with no padding or query-hostile characters", () => {
    const encoded = encodeWorkoutTemplateCursor(cursor);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("round-trips a name with characters a URL would otherwise mangle", () => {
    const awkward = { name: 'Push "Day" + Core / 50%', id: cursor.id };

    expect(decodeWorkoutTemplateCursor(encodeWorkoutTemplateCursor(awkward))).toEqual(awkward);
  });

  it("round-trips a non-ASCII name", () => {
    const accented = { name: "Étirement du psoas", id: cursor.id };

    expect(decodeWorkoutTemplateCursor(encodeWorkoutTemplateCursor(accented))).toEqual(accented);
  });

  it("rejects a string that is not base64 at all", () => {
    expect(decodeWorkoutTemplateCursor("not a cursor!!")).toBeNull();
  });

  it("rejects base64 that does not decode to JSON", () => {
    expect(decodeWorkoutTemplateCursor(Buffer.from("nonsense").toString("base64url"))).toBeNull();
  });

  it("rejects JSON that is not a cursor object", () => {
    expect(decodeWorkoutTemplateCursor(Buffer.from("[1,2,3]").toString("base64url"))).toBeNull();
  });

  it("rejects a cursor missing its name", () => {
    const forged = Buffer.from(JSON.stringify({ id: cursor.id })).toString("base64url");

    expect(decodeWorkoutTemplateCursor(forged)).toBeNull();
  });

  it("rejects a cursor whose id is not a uuid", () => {
    const forged = Buffer.from(JSON.stringify({ name: "x", id: "not-a-uuid" })).toString(
      "base64url",
    );

    expect(decodeWorkoutTemplateCursor(forged)).toBeNull();
  });

  it("rejects a cursor whose name is not a string", () => {
    const forged = Buffer.from(JSON.stringify({ name: 42, id: cursor.id })).toString("base64url");

    expect(decodeWorkoutTemplateCursor(forged)).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(decodeWorkoutTemplateCursor("")).toBeNull();
  });
});
