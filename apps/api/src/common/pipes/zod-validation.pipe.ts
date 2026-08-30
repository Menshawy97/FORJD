import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodType, ZodTypeDef } from 'zod';

/**
 * Bridges Zod (the project's validation default) to Nest's pipe contract, so the wire
 * contract in @forjd/contracts is the single source of truth for both shape and types.
 *
 * **Two type parameters, not one.** This used to take `ZodSchema<T>`, which is
 * `ZodType<T, ZodTypeDef, T>` — a schema whose parsed output is the same shape as its input.
 * That held for as long as the pipe was only ever applied to `@Body`, where JSON has already
 * produced correctly-typed values. It stops holding the moment a schema transforms: a query
 * string is all strings, so `exerciseListQuerySchema` uses `z.coerce.number()` for `limit`
 * and `.default(50)` for its absence, which makes the input `string | undefined` where the
 * output is `number`. Inferring the input separately accepts such a schema without weakening
 * the output type the controller receives.
 *
 * `transform` still takes `unknown` — what a schema declares as its input type is a statement
 * about what it can parse, not a promise about what arrives over the wire.
 */
export class ZodValidationPipe<TOutput, TInput = unknown>
  implements PipeTransform<unknown, TOutput>
{
  constructor(private readonly schema: ZodType<TOutput, ZodTypeDef, TInput>) {}

  transform(value: unknown): TOutput {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.error.flatten().fieldErrors,
      });
    }

    return result.data;
  }
}
