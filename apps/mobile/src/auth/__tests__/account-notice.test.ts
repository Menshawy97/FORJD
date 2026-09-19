import { consumeUnderageNotice, setUnderageNotice } from '../account-notice';

describe('underage notice', () => {
  it('is off until an under-age sign-up has just been turned away', () => {
    expect(consumeUnderageNotice()).toBe(false);
  });

  it('is read once, then forgotten, so a later unrelated visit to welcome never replays it', () => {
    setUnderageNotice();

    expect(consumeUnderageNotice()).toBe(true);
    expect(consumeUnderageNotice()).toBe(false);
  });
});
