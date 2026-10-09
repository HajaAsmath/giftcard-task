import { parseAmountToCents } from '../src/money';

test.each([
  ['8.29', 829], // parseFloat('8.29') * 100 is 828.9999999999999
  ['24.99', 2499],
  ['25.01', 2501],
  ['5', 500],
  ['5.5', 550],
  ['0.05', 5],
  ['0.5', 50],
  ['1000000.00', 100000000],
])('%s is %i cents', (raw, cents) => {
  expect(parseAmountToCents(raw)).toBe(cents);
});

test.each(['', ' ', '8.299', '8.', '.5', '-1', '+1', '1,000', '1e3', ' 8.29', '8.29 ', 'abc', '8,29', '9007199254740993.00'])(
  '"%s" is refused as invalid_amount',
  (raw) => {
    expect(() => parseAmountToCents(raw)).toThrow(expect.objectContaining({ status: 400, code: 'invalid_amount' }));
  },
);
