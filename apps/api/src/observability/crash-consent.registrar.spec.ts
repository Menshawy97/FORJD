import { PrivacyService } from '../privacy/privacy.service';
import { CrashConsentRegistrar } from './crash-consent.registrar';
import { currentCrashConsentLookup, markCrashSubject, registerCrashConsentLookup } from './crash-subject';

describe('CrashConsentRegistrar', () => {
  afterEach(() => registerCrashConsentLookup(null));

  const registrarFor = (crashDiagnostics: boolean) => {
    const privacy = { get: jest.fn().mockResolvedValue({ crashDiagnostics }) };
    return { privacy, registrar: new CrashConsentRegistrar(privacy as unknown as PrivacyService) };
  };

  it('answers from the live privacy setting once the module starts', async () => {
    const { privacy, registrar } = registrarFor(true);

    registrar.onModuleInit();

    await expect(currentCrashConsentLookup()?.('user-1')).resolves.toBe(true);
    expect(privacy.get).toHaveBeenCalledWith('user-1');
  });

  it('answers false for a user who turned crash diagnostics off', async () => {
    const { registrar } = registrarFor(false);

    registrar.onModuleInit();

    await expect(currentCrashConsentLookup()?.('user-1')).resolves.toBe(false);
  });

  it('withdraws the lookup on shutdown, so a late crash fails closed', () => {
    const { registrar } = registrarFor(true);
    registrar.onModuleInit();

    registrar.onModuleDestroy();

    expect(currentCrashConsentLookup()).toBeNull();
  });
});

describe('markCrashSubject', () => {
  it('records only the user id on the scope', () => {
    const scope = { setUser: jest.fn() };

    markCrashSubject('user-1', scope);

    expect(scope.setUser).toHaveBeenCalledWith({ id: 'user-1' });
  });
});
