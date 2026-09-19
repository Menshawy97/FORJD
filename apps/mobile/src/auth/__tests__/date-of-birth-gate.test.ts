import {
  dateOfBirthProvided,
  getDateOfBirthNeeded,
  requireDateOfBirth,
  resetDateOfBirthGate,
  subscribeToDateOfBirthGate,
} from '../date-of-birth-gate';

describe('date-of-birth gate', () => {
  beforeEach(() => resetDateOfBirthGate());

  it('starts with nothing required', () => {
    expect(getDateOfBirthNeeded()).toBe(false);
  });

  it('flips to required when the server or a profile read says the date is missing', () => {
    requireDateOfBirth();

    expect(getDateOfBirthNeeded()).toBe(true);
  });

  it('clears once the date has been given', () => {
    requireDateOfBirth();
    dateOfBirthProvided();

    expect(getDateOfBirthNeeded()).toBe(false);
  });

  it('notifies subscribers only when the value actually changes', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToDateOfBirthGate(listener);

    requireDateOfBirth();
    requireDateOfBirth();
    dateOfBirthProvided();

    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('stops notifying after unsubscribe', () => {
    const listener = jest.fn();
    subscribeToDateOfBirthGate(listener)();

    requireDateOfBirth();

    expect(listener).not.toHaveBeenCalled();
  });

  it('resets on sign-out so the next account starts clean', () => {
    requireDateOfBirth();
    resetDateOfBirthGate();

    expect(getDateOfBirthNeeded()).toBe(false);
  });
});
