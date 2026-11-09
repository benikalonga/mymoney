import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeFee, customerRate, price, toUsd } from './pricing';
import { nextRunDate } from './schedule';

const noFee = { percentBps: 0, flatUsd: 0 };

test('same-currency transfers have a rate of exactly 1', () => {
  const p = price({ sendAmount: 12345, sendPerUsd: 18.2, receivePerUsd: 18.2, spreadBps: 100, fee: noFee, sameCurrency: true });
  assert.deepEqual(p, { sendAmount: 12345, receiveAmount: 12345, fee: 0, rate: 1, total: 12345 });
});

test('the spread always favours the platform', () => {
  const mid = 129 / 18.2;
  assert.ok(customerRate(18.2, 129, 100, false) < mid);
});

test('receive amounts round down, and send amounts round up', () => {
  const fromSend = price({ sendAmount: 1001, sendPerUsd: 1, receivePerUsd: 1.5, spreadBps: 0, fee: noFee, sameCurrency: false });
  assert.equal(fromSend.receiveAmount, 1501);
  const fromReceive = price({ receiveAmount: 1000, sendPerUsd: 3, receivePerUsd: 1, spreadBps: 0, fee: noFee, sameCurrency: false });
  assert.equal(fromReceive.sendAmount, 3000);
  const roundsUp = price({ receiveAmount: 1000, sendPerUsd: 1, receivePerUsd: 3, spreadBps: 0, fee: noFee, sameCurrency: false });
  assert.equal(roundsUp.sendAmount, 334);
});

test('fees combine percent and a flat amount converted to the send currency', () => {
  assert.equal(computeFee(10_000, 18, { percentBps: 100, flatUsd: 100 }), 100 + 1800);
  assert.equal(computeFee(1, 1, { percentBps: 150, flatUsd: 0 }), 1);
});

test('total is amount plus fee', () => {
  const p = price({ sendAmount: 10_000, sendPerUsd: 1, receivePerUsd: 1, spreadBps: 0, fee: { percentBps: 150, flatUsd: 0 }, sameCurrency: true });
  assert.equal(p.total, 10_150);
});

test('USD value conversion', () => assert.equal(toUsd(18_200, 18.2), 1000));

test('monthly schedules keep their anchor day through short months', () => {
  const feb = nextRunDate(new Date('2027-01-31T08:00:00Z'), 'monthly', 31);
  assert.equal(feb.toISOString(), '2027-02-28T08:00:00.000Z');
  assert.equal(nextRunDate(feb, 'monthly', 31).toISOString(), '2027-03-31T08:00:00.000Z');
});

test('monthly schedules roll over the year', () => {
  assert.equal(nextRunDate(new Date('2026-12-15T08:00:00Z'), 'monthly', 15).toISOString(), '2027-01-15T08:00:00.000Z');
});

test('weekly schedules move seven days', () => {
  assert.equal(nextRunDate(new Date('2027-03-01T08:00:00Z'), 'weekly', 1).toISOString(), '2027-03-08T08:00:00.000Z');
});
