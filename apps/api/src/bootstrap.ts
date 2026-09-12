import { INestApplication, ValidationPipe } from '@nestjs/common';
import compression from 'compression';
import helmet from 'helmet';

/**
 * Bootstrap hardening applied in every environment (R9 / H14 part 1): security headers,
 * response compression, and a global validation safety net. Extracted into its own testable
 * function -- same reasoning as `applyCors` (`cors.ts`) -- because `main.ts`'s `bootstrap()`
 * is a fire-and-forget async function that calls `NestFactory.create` and `app.listen`, which
 * Jest cannot import and exercise against a real `INestApplication` without also starting a
 * real HTTP listener.
 *
 * Order in `main.ts`: `configureApp` runs before `applyCors`. Nothing here depends on CORS
 * being applied first, and `crossOriginResourcePolicy` is set explicitly below rather than
 * left at helmet's default specifically because of how `applyCors` behaves.
 */
export function configureApp(app: INestApplication): void {
  app.use(
    helmet({
      // `cors.ts`'s `applyCors` deliberately reflects any origin (`origin: true`) because
      // this API authenticates with a Bearer token, not a cookie -- there is no ambient
      // credential for a hostile page to ride, so a browser fetch from another origin (the
      // Expo web preview, `exp://`) is meant to succeed. Helmet's 'same-origin' default for
      // Cross-Origin-Resource-Policy would have a browser block that cross-origin response
      // body regardless, silently undoing `applyCors`'s intent.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(compression());

  // Additive to, never a replacement for, the per-route `ZodValidationPipe` usage
  // (`common/pipes/zod-validation.pipe.ts`) that is this codebase's actual validation
  // mechanism. This is a safety net for a route that might someday forget its Zod pipe.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
}
