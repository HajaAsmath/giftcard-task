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
