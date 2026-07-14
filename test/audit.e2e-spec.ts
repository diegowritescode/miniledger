import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

interface AccountResponse {
  id: string;
  type: string;
  currency: string;
}

interface AccountAuditResponse {
  accountId: string;
  postingCount: number;
  balance: string;
  chainValid: boolean;
  headMatches: boolean;
  reconciled: boolean;
  brokenAtSeq: number | null;
}

interface ConservationResponse {
  conserved: boolean;
  byCurrency: { currency: string; total: string }[];
}

describe('Audit (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgres://miniledger:miniledger@localhost:5433/miniledger';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const openAccount = async (): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/accounts')
      .send({ currency: 'USD' })
      .expect(201);
    return (response.body as AccountResponse).id;
  };

  const worldUsdId = async (): Promise<string> => {
    const response = await request(app.getHttpServer()).get('/accounts').expect(200);
    const accounts = response.body as AccountResponse[];
    const world = accounts.find(
      (account) => account.type === 'system' && account.currency === 'USD',
    );
    if (!world) throw new Error('@world USD account must exist');
    return world.id;
  };

  it('GET /audit/accounts/:id -> 200 a valid report for a funded account', async () => {
    const world = await worldUsdId();
    const a = await openAccount();
    const b = await openAccount();
    await request(app.getHttpServer())
      .post('/transfers')
      .send({ from: world, to: a, amount: '1000', currency: 'USD' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/transfers')
      .send({ from: a, to: b, amount: '300', currency: 'USD' })
      .expect(201);

    const response = await request(app.getHttpServer()).get(`/audit/accounts/${a}`).expect(200);
    const body = response.body as AccountAuditResponse;
    expect(body.accountId).toBe(a);
    expect(body.postingCount).toBe(2);
    expect(body.balance).toBe('700');
    expect(body.chainValid).toBe(true);
    expect(body.headMatches).toBe(true);
    expect(body.reconciled).toBe(true);
    expect(body.brokenAtSeq).toBeNull();
  });

  it('GET /audit/accounts/:id -> 404 problem+json for an unknown account', async () => {
    const response = await request(app.getHttpServer())
      .get(`/audit/accounts/${randomUUID()}`)
      .expect(404)
      .expect('Content-Type', /application\/problem\+json/);
    expect((response.body as { status: number }).status).toBe(404);
  });

  it('GET /audit/conservation -> 200 reports conserved money', async () => {
    const world = await worldUsdId();
    const a = await openAccount();
    await request(app.getHttpServer())
      .post('/transfers')
      .send({ from: world, to: a, amount: '250', currency: 'USD' })
      .expect(201);

    const response = await request(app.getHttpServer()).get('/audit/conservation').expect(200);
    const body = response.body as ConservationResponse;
    expect(body.conserved).toBe(true);
    expect(body.byCurrency.every((entry) => entry.total === '0')).toBe(true);
  });
});
