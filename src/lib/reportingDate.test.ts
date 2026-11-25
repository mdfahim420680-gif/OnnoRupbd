import test from 'node:test';
import assert from 'node:assert/strict';
import { getReportingDateKey, getReportingMonthKey } from './reportingDate';

test('reporting date keys use store timezone instead of UTC date slicing', () => {
  assert.equal(
    getReportingDateKey('2026-11-16T20:30:00Z', 'Asia/Dhaka'),
    '2026-11-17',
  );
  assert.equal(
    getReportingDateKey('2026-11-16T20:30:00Z', 'UTC'),
    '2026-11-16',
  );
  assert.equal(
    getReportingMonthKey('2026-12-31T20:30:00Z', 'Asia/Dhaka'),
    '2027-01',
  );
});
