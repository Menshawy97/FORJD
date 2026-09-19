import { SetMetadata } from '@nestjs/common';

export const ALLOW_WITHOUT_DATE_OF_BIRTH = 'allowWithoutDateOfBirth';

/**
 * Marks a route (or a whole controller) as usable by an account that has not yet given a date
 * of birth (ADR-042). Everything else is refused by `JwtAuthGuard` until it has.
 *
 * The exceptions are exactly the routes a person needs in order to *finish* the age check or
 * leave: reading their own account, giving the date, uploading the avatar the same screen
 * offers, signing out, exporting their data and deleting the account.
 */
export const AllowWithoutDateOfBirth = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_WITHOUT_DATE_OF_BIRTH, true);
