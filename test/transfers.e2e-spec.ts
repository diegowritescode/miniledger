import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

interface AccountResponse {
  id: string;
  type: string;
  currency: string;
}

interface PostingResponse {
  accountId: string;
  amount: string;
  balanceAfter: string;
}

interface TransferResponse {
  id: string;
  currency: string;
  postings: PostingResponse[];
}

describe('Transfers (e2e)', () => {
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

  it('deposits from @world, then transfers between accounts', async () => {
    const world = await worldUsdId();
    const a = await openAccount();
    const b = await openAccount();

    const deposit = await request(app.getHttpServer())
      .post('/transfers')
      .send({ from: world, to: a, amount: '1000', currency: 'USD' })
      .expect(201);
    const depositBody = deposit.body as TransferResponse;
    const credited = depositBody.postings.find((posting) => posting.accountId === a);
    expect(credited?.amount).toBe('1000');
    expect(credited?.balanceAfter).toBe('1000');

    const transfer = await request(app.getHttpServer())
      .post('/transfers')
      .send({ from: a, to: b, amount: '300', currency: 'USD' })
      .expect(201);
    const transferBody = transfer.body as TransferResponse;
    const debited = transferBody.postings.find((posting) => posting.accountId === a);
    const received = transferBody.postings.find((posting) => posting.accountId === b);
    expect(debited?.balanceAfter).toBe('700');
    expect(received?.balanceAfter).toBe('300');
  });

  it('rejects an overdrawing transfer with 422 problem+json', async () => {
    const world = await worldUsdId();
    const a = await openAccount();
    const b = await openAccount();
    await request(app.getHttpServer())
      .post('/transfers')
      .send({ from: world, to: a, amount: '100', currency: 'USD' })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/transfers')
      .send({ from: a, to: b, amount: '500', currency: 'USD' })
      .expect(422)
      .expect('Content-Type', /application\/problem\+json/);
    expect((response.body as { detail: string }).detail).toBe('insufficient_funds');
  });

  it('rejects a transfer referencing an unknown account with 404', async () => {
    const world = await worldUsdId();
    const a = await openAccount();
    await request(app.getHttpServer())
      .post('/transfers')
      .send({ from: world, to: a, amount: '50', currency: 'USD' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/transfers')
      .send({
        from: a,
        to: '00000000-0000-4000-8000-000000000000',
        amount: '10',
        currency: 'USD',
      })
      .expect(404)
      .expect('Content-Type', /application\/problem\+json/);
  });
});
