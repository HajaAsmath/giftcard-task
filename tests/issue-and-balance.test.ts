import { fixtureLine, get, Harness, send, startHarness } from './harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });

test('issuing a gift card makes its balance available', async () => {
  const issued = await send(h.baseUrl, fixtureLine(3));
  expect(issued.status).toBe(201);

  const balance = await get(h.baseUrl, '/cards/6036280000001001/balance');
  expect(balance.status).toBe(200);
  expect(balance.json).toMatchObject({ card_number: '6036280000001001', balance_minor: 10000, currency: 'AUD' });
});

test('a card number with spaces identifies the same gift card', async () => {
  const balance = await get(h.baseUrl, '/cards/' + encodeURIComponent('6036 2800 0000 1001') + '/balance');
  expect(balance.status).toBe(200);
  expect(balance.json).toMatchObject({ card_number: '6036280000001001', balance_minor: 10000 });
});

test('checking the balance of an unknown gift card is a 404', async () => {
  const balance = await get(h.baseUrl, '/cards/6036280000009999/balance');
  expect(balance.status).toBe(404);
  expect(balance.json).toEqual({ error: { code: 'card_not_found', message: expect.any(String) } });
});

test('expiry is the end of the issuing store\'s local date 36 months after the local sale date', async () => {
  // Line 1: sold 2023-09-20 12:00 in Sydney (AEST, +10) -> expires end of 2026-09-20 Sydney time.
  expect((await send(h.baseUrl, fixtureLine(1))).status).toBe(201);
  const balance = await get(h.baseUrl, '/cards/6036280000001002/balance');
  expect(balance.json).toMatchObject({ issuing_store_id: 's2', balance_minor: 5000, expires_at: '2026-09-20T13:59:59.999Z' });
});

test('a sale just after local midnight belongs to the new local date', async () => {
  // Line 23: 2026-09-30T14:30Z is 00:30 on 1 October in Sydney (AEST, +10), so it expires end of 2029-10-01 (still AEST; DST starts 7 Oct).
  expect((await send(h.baseUrl, fixtureLine(23))).status).toBe(201);
  const balance = await get(h.baseUrl, '/cards/6036280000001007/balance');
  expect(balance.json).toMatchObject({ expires_at: '2029-10-01T13:59:59.999Z' });
});
