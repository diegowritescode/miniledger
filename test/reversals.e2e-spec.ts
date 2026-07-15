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

describe('Reversals (e2e)', () => {
  let app: INestApplication;
  let bearer: string;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgres://miniledger:miniledger@localhost:5433/miniledger';
    const kit = await createAccessTestKit();
    bearer = `Bearer ${await kit.mintToken()}`;
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

  const transfer = async (from: string, to: string, amount: string): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/transfers')
      .set('Authorization', bearer)
      .send({ from, to, amount, currency: 'USD' })
      .expect(201);
    return (response.body as TransferResponse).id;
  };

  it('rejects an unauthenticated reversal (401 problem+json)', async () => {
    await request(app.getHttpServer())
      .post('/reversals')
      .send({ transactionId: randomUUID() })
      .expect(401)
      .expect('Content-Type', /application\/problem\+json/);
  });

  it('reverses a transfer (201), then rejects a second reversal with 409, and 404 for unknown', async () => {
    const world = await worldUsdId();
    const a = await openAccount();
    const b = await openAccount();
    await transfer(world, a, '1000');
    const transferId = await transfer(a, b, '300');

    const reversed = await request(app.getHttpServer())
      .post('/reversals')
      .set('Authorization', bearer)
      .send({ transactionId: transferId })
      .expect(201);
    const body = reversed.body as TransferResponse;
    const credited = body.postings.find((posting) => posting.accountId === a);
    const debited = body.postings.find((posting) => posting.accountId === b);
    expect(credited?.amount).toBe('300');
    expect(credited?.balanceAfter).toBe('1000');
    expect(debited?.amount).toBe('-300');
    expect(debited?.balanceAfter).toBe('0');

    await request(app.getHttpServer())
      .post('/reversals')
      .set('Authorization', bearer)
      .send({ transactionId: transferId })
      .expect(409)
      .expect('Content-Type', /application\/problem\+json/);

    await request(app.getHttpServer())
      .post('/reversals')
      .set('Authorization', bearer)
      .send({ transactionId: randomUUID() })
      .expect(404)
      .expect('Content-Type', /application\/problem\+json/);
  });
});
