import { ConflictException, ForbiddenException } from '@nestjs/common';

import { AgeGateService } from './age-gate.service';

/**
 * ADR-042. The date of birth is asked once. Under 16, the account is deleted -- completely,
 * through the same path as the user's own deletion -- and the caller is told why. An account
 * that already has a date of birth is never deleted or changed by this route.
 */
describe('AgeGateService', () => {
  const target = { userId: 'user-1', email: 'a@example.com', externalId: 'ext-1' };
  const today = new Date(2026, 8, 19); // 19 September 2026, local

  function build(existingDateOfBirth: string | null = null) {
    const usersRepository = {
      findProfile: jest.fn().mockResolvedValue({ userId: 'user-1', dateOfBirth: existingDateOfBirth }),
      updateProfile: jest.fn().mockResolvedValue({}),
      recordAudit: jest.fn().mockResolvedValue(undefined),
    };
    const deletion = { deleteAccount: jest.fn().mockResolvedValue(undefined) };
    const identities = { markDateOfBirthSet: jest.fn() };
    const service = new AgeGateService(usersRepository as never, deletion as never, identities as never);

    return { service, usersRepository, deletion, identities };
  }

  it('stores the date of birth for someone who is 16 or older', async () => {
    const { service, usersRepository, deletion } = build();

    await service.setDateOfBirth(target, '2010-09-19', today);

    expect(usersRepository.updateProfile).toHaveBeenCalledWith('user-1', { dateOfBirth: '2010-09-19' });
    expect(deletion.deleteAccount).not.toHaveBeenCalled();
  });

  it('lets the account through immediately by marking it on the identity cache', async () => {
    const { service, identities } = build();

    await service.setDateOfBirth(target, '1990-01-01', today);

    expect(identities.markDateOfBirthSet).toHaveBeenCalledWith('ext-1', 'a@example.com');
  });

  it('records that a date was given, but never the date itself, in the audit trail', async () => {
    const { service, usersRepository } = build();

    await service.setDateOfBirth(target, '1990-01-01', today);

    expect(usersRepository.recordAudit).toHaveBeenCalledWith('user-1', 'profile.date_of_birth_set');
  });

  it('deletes the whole account and refuses with code "underage" for someone under 16', async () => {
    const { service, deletion, usersRepository } = build();

    const attempt = service.setDateOfBirth(target, '2010-09-20', today);

    await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
    await expect(attempt).rejects.toMatchObject({ response: { code: 'underage' } });
    expect(deletion.deleteAccount).toHaveBeenCalledWith(target);
    expect(usersRepository.updateProfile).not.toHaveBeenCalled();
  });

  it('treats the 16th birthday itself as old enough', async () => {
    const { service, deletion } = build();

    await service.setDateOfBirth(target, '2010-09-19', today);

    expect(deletion.deleteAccount).not.toHaveBeenCalled();
  });

  it('does nothing further if the account vanished mid-request (a concurrent under-age answer deleted it)', async () => {
    const { service, usersRepository, identities } = build();
    usersRepository.updateProfile.mockResolvedValue(null);

    await expect(service.setDateOfBirth(target, '1990-01-01', today)).resolves.toBeUndefined();

    expect(usersRepository.recordAudit).not.toHaveBeenCalled();
    expect(identities.markDateOfBirthSet).not.toHaveBeenCalled();
  });

  it('is a no-op when the same date is sent again (a retry after a later step failed)', async () => {
    const { service, usersRepository, deletion } = build('1990-01-01');

    await expect(service.setDateOfBirth(target, '1990-01-01', today)).resolves.toBeUndefined();

    expect(usersRepository.updateProfile).not.toHaveBeenCalled();
    expect(deletion.deleteAccount).not.toHaveBeenCalled();
  });

  it('refuses a different date once one is on file, and never deletes an existing account for it', async () => {
    const { service, deletion } = build('1990-01-01');

    await expect(service.setDateOfBirth(target, '2015-01-01', today)).rejects.toBeInstanceOf(ConflictException);

    expect(deletion.deleteAccount).not.toHaveBeenCalled();
  });
});
