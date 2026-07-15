import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ACCESS_CORE_CLIENT } from '@diegowritescode/accesscore-sdk';
import { AppModule } from '../src/app.module';
import { JWKS_RESOLVER } from '../src/access/jwks-resolver';
import { createAccessTestKit } from './support/access';
import { createPepStub } from './support/pep';

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
  let bearer: string;
  let bearerOther: string;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgres://miniledger:miniledger@localhost:5433/miniledger';
    const kit = await createAccessTestKit();
    bearer = `Bearer ${await kit.mintToken()}`;
    bearerOther = `Bearer ${await kit.mintToken({ subject: 'user-2' })}`;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JWKS_RESOLVER)
      .useValue(kit.jwksResolver)
      .overrideProvider(ACCESS_CORE_CLIENT)
      .useValue(createPepStub().client)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const openAccount = async (): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', bearer)
      .send({ currency: 'USD' })
      .expect(201);
    return (response.body as AccountResponse).id;
  };

  const worldUsdId = async (): Promise<string> => {
    const response = await request(app.getHttpServer())
      .get('/accounts')
      .set('Authorization', bearer)
      .expect(200);
    const accounts = response.body as AccountResponse[];
    const world = accounts.find(
      (account) => account.type === 'system' && account.currency === 'USD',
    );
    if (!world) throw new Error('@world USD account must exist');
    return world.id;
  };

  const deposit = async (to: string, amount: string): Promise<void> => {
    const world = await worldUsdId();
    await request(app.getHttpServer())
      .post('/transfers')
      .set('Authorization', bearer)
      .send({ from: world, to, amount, currency: 'USD' })
      .expect(201);
  };

  it('rejects an unauthenticated transfer (401 problem+json)', async () => {
    await request(app.getHttpServer())
      .post('/transfers')
      .send({ from: randomUUID(), to: randomUUID(), amount: '1', currency: 'USD' })
      .expect(401)
      .expect('Content-Type', /application\/problem\+json/);
  });

  it('deposits from @world, then transfers between accounts', async () => {
    const world = await worldUsdId();
    const a = await openAccount();
    const b = await openAccount();

    const deposited = await request(app.getHttpServer())
      .post('/transfers')
      .set('Authorization', bearer)
      .send({ from: world, to: a, amount: '1000', currency: 'USD' })
      .expect(201);
    const credited = (deposited.body as TransferResponse).postings.find(
      (posting) => posting.accountId === a,
    );
    expect(credited?.amount).toBe('1000');
    expect(credited?.balanceAfter).toBe('1000');

    const transfer = await request(app.getHttpServer())
      .post('/transfers')
      .set('Authorization', bearer)
      .send({ from: a, to: b, amount: '300', currency: 'USD' })
      .expect(201);
    const transferBody = transfer.body as TransferResponse;
    const debited = transferBody.postings.find((posting) => posting.accountId === a);
    const received = transferBody.postings.find((posting) => posting.accountId === b);
    expect(debited?.balanceAfter).toBe('700');
    expect(received?.balanceAfter).toBe('300');
  });

  it('rejects a transfer whose source belongs to another owner (403 problem+json)', async () => {
    const a = await openAccount();
    const b = await openAccount();
    await deposit(a, '100');

    const response = await request(app.getHttpServer())
      .post('/transfers')
      .set('Authorization', bearerOther)
      .send({ from: a, to: b, amount: '10', currency: 'USD' })
      .expect(403)
      .expect('Content-Type', /application\/problem\+json/);
    expect((response.body as { detail: string }).detail).toBe('not_account_owner');
  });

  it('rejects an overdrawing transfer with 422 problem+json', async () => {
    const a = await openAccount();
    const b = await openAccount();
    await deposit(a, '100');

    const response = await request(app.getHttpServer())
      .post('/transfers')
      .set('Authorization', bearer)
      .send({ from: a, to: b, amount: '500', currency: 'USD' })
      .expect(422)
      .expect('Content-Type', /application\/problem\+json/);
    expect((response.body as { detail: string }).detail).toBe('insufficient_funds');
  });

  it('rejects a transfer referencing an unknown account with 404', async () => {
    const a = await openAccount();
    await deposit(a, '50');

    await request(app.getHttpServer())
      .post('/transfers')
      .set('Authorization', bearer)
      .send({
        from: a,
        to: '00000000-0000-4000-8000-000000000000',
        amount: '10',
        currency: 'USD',
      })
      .expect(404)
      .expect('Content-Type', /application\/problem\+json/);
  });

  it('replays a retried transfer that carries the same Idempotency-Key', async () => {
    const a = await openAccount();
    const b = await openAccount();
    await deposit(a, '1000');

    const idempotencyKey = randomUUID();
    const body = { from: a, to: b, amount: '200', currency: 'USD' };

    const first = await request(app.getHttpServer())
      .post('/transfers')
      .set('Authorization', bearer)
      .set('Idempotency-Key', idempotencyKey)
      .send(body)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/transfers')
      .set('Authorization', bearer)
      .set('Idempotency-Key', idempotencyKey)
      .send(body)
      .expect(201);

    const firstBody = first.body as TransferResponse;
    const secondBody = second.body as TransferResponse;
    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody.postings).toEqual(firstBody.postings);
  });

  it('rejects the same Idempotency-Key with a different body with 409', async () => {
    const a = await openAccount();
    const b = await openAccount();
    await deposit(a, '1000');

    const idempotencyKey = randomUUID();
    await request(app.getHttpServer())
      .post('/transfers')
      .set('Authorization', bearer)
      .set('Idempotency-Key', idempotencyKey)
      .send({ from: a, to: b, amount: '100', currency: 'USD' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/transfers')
      .set('Authorization', bearer)
      .set('Idempotency-Key', idempotencyKey)
      .send({ from: a, to: b, amount: '500', currency: 'USD' })
      .expect(409)
      .expect('Content-Type', /application\/problem\+json/);
  });
});
