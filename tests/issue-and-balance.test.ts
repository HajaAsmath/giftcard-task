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
