// Freezes `new Date()` and `Date.now()` so date-dependent tests behave the same on every day.
// Preloaded by `npm test` (node --import). Set ORG_TEST_NOW to an ISO local time to try another
// instant, or ORG_TEST_NOW=real to use the real clock.
const raw = process.env.ORG_TEST_NOW || '2026-06-17T10:30:00';
if (raw !== 'real') {
  const RealDate = Date;
  const fixed = new RealDate(raw).getTime();
  if (Number.isNaN(fixed)) throw new Error('ORG_TEST_NOW is not a date: ' + raw);
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
    static now() { return fixed; }
  }
  globalThis.Date = FixedDate;
}

// The Emacs oracles for the diary and sexp tests were made in this zone; the sun-related holidays follow the zone (tests of other zones set their own).
const { setHolidayZone } = await import('../../src/holidays.js');
setHolidayZone('America/New_York');
