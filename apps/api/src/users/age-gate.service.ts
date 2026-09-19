import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { isOldEnough, MINIMUM_AGE_YEARS } from '@forjd/domain';

import { IdentityCache } from '../auth/guards/identity-cache';
import { AccountDeletionService } from './account-deletion.service';
import { UsersRepository } from './users.repository';

export interface AccountTarget {
  userId: string;
  email: string;
  externalId: string | null;
}

/**
 * ADR-042 -- the minimum-age check. A person gives their date of birth once, right after
 * signing up (by email or with Google/Apple). Under `MINIMUM_AGE_YEARS`, the account is
 * deleted completely -- through `AccountDeletionService`, the same path as a user deleting
 * their own account, so nothing is left behind -- and the caller is told why.
 *
 * Two safety rules keep this from becoming a way to hurt an existing account: once a date of
 * birth is on file it is never changed here (a different date is a 409), and it is never the
 * trigger for deleting an account that already passed the check.
 */
@Injectable()
export class AgeGateService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly accountDeletion: AccountDeletionService,
    private readonly identities: IdentityCache,
  ) {}

  async setDateOfBirth(target: AccountTarget, dateOfBirth: string, today: Date = new Date()): Promise<void> {
    const existing = (await this.usersRepository.findProfile(target.userId))?.dateOfBirth ?? null;

    if (existing !== null) {
      if (existing === dateOfBirth) {
        return;
      }
      throw new ConflictException('A date of birth is already on file.');
    }

    if (!isOldEnough(dateOfBirth, today)) {
      await this.accountDeletion.deleteAccount(target);
      throw new ForbiddenException({
        statusCode: 403,
        code: 'underage',
        message: `You must be at least ${MINIMUM_AGE_YEARS} years old to use FORJD. Your account has been removed.`,
      });
    }

    await this.usersRepository.updateProfile(target.userId, { dateOfBirth });
    // The date itself is personal data; the audit trail records only that it was given.
    await this.usersRepository.recordAudit(target.userId, 'profile.date_of_birth_set');
    if (target.externalId) {
      this.identities.markDateOfBirthSet(target.externalId, target.email);
    }
  }
}
