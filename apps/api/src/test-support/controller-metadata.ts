import { GUARDS_METADATA, ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { RouteParamtypes } from "@nestjs/common/enums/route-paramtypes.enum";

/**
 * Lightweight reflection helpers for controller unit specs (R16 / H11).
 *
 * These read the same Nest metadata the framework itself reads at bootstrap time
 * (`@UseGuards`, `@Body`/`@Query` param pipes) so a spec can assert "the guard is really
 * there" and "the right schema is really wired" without spinning up a full
 * `Test.createTestingModule` / HTTP server. A dropped `@UseGuards` or a copy-pasted schema
 * from a sibling route shows up here in milliseconds.
 */

/** Any controller (or guard) class -- a constructor, never a plain callable. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a class reference is intentionally untyped here; every call site passes a concrete controller/guard class.
export type ClassType = abstract new (...args: any[]) => unknown;

type RouteArgEntry = { index: number; pipes: unknown[] };
type RouteArgsMetadata = Record<string, RouteArgEntry>;

/** Guards applied at the class level via `@UseGuards(...)` on the controller itself. */
export function getClassGuards(controller: ClassType): ClassType[] {
  return Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
}

/** Guards applied at the method level via `@UseGuards(...)` on a single route handler. */
export function getMethodGuards(controller: ClassType, methodName: string): ClassType[] {
  const handler = (controller as unknown as { prototype: Record<string, object> }).prototype[methodName];
  if (!handler) {
    return [];
  }
  return Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
}

/** True if the guard is applied at the class level, the method level, or both. */
export function isGuarded(controller: ClassType, methodName: string, guard: ClassType): boolean {
  return getClassGuards(controller).includes(guard) || getMethodGuards(controller, methodName).includes(guard);
}

function getRouteArgs(controller: ClassType, methodName: string): RouteArgsMetadata {
  return Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, methodName) ?? {};
}

function getParamPipes(controller: ClassType, methodName: string, paramType: RouteParamtypes): unknown[] {
  const args = getRouteArgs(controller, methodName);
  const entry = Object.entries(args).find(([key]) => key.startsWith(`${paramType}:`));
  return entry ? entry[1].pipes : [];
}

/** The Zod schema instance bound to the `@Body(new ZodValidationPipe(schema))` param, if any. */
export function getBodySchema(controller: ClassType, methodName: string): unknown {
  return findZodSchema(getParamPipes(controller, methodName, RouteParamtypes.BODY));
}

/** The Zod schema instance bound to the `@Query(new ZodValidationPipe(schema))` param, if any. */
export function getQuerySchema(controller: ClassType, methodName: string): unknown {
  return findZodSchema(getParamPipes(controller, methodName, RouteParamtypes.QUERY));
}

function findZodSchema(pipes: unknown[]): unknown {
  const pipe = pipes.find((candidate) => candidate !== null && typeof candidate === "object" && "schema" in candidate);
  return pipe ? (pipe as { schema: unknown }).schema : undefined;
}
