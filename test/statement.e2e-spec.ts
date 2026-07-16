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

interface StatementResponse {
  entries: { seq: number; transactionId: string; amount: string; balanceAfter: string }[];
  nextCursor: number | null;
}

describe('Account statement (e2e)', () => {
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
    const world = (response.body as AccountResponse[]).find(
      (account) => account.type === 'system' && account.currency === 'USD',
    );
    if (!world) throw new Error('@world USD account must exist');
    return world.id;
  };

  const transfer = async (from: string, to: string, amount: string): Promise<void> => {
    await request(app.getHttpServer())
      .post('/transfers')
      .set('Authorization', bearer)
      .send({ from, to, amount, currency: 'USD' })
      .expect(201);
  };

  it('returns the account history in seq order and paginates with a cursor', async () => {
    const world = await worldUsdId();
    const a = await openAccount();
    const b = await openAccount();
    await transfer(world, a, '1000');
    await transfer(a, b, '300');
    await transfer(a, b, '200');

    const full = await request(app.getHttpServer())
      .get(`/accounts/${a}/statement`)
      .set('Authorization', bearer)
      .expect(200);
    const fullBody = full.body as StatementResponse;
    expect(fullBody.entries.map((entry) => entry.amount)).toEqual(['1000', '-300', '-200']);
    expect(fullBody.entries[fullBody.entries.length - 1]?.balanceAfter).toBe('500');
    expect(fullBody.nextCursor).toBeNull();

    const firstPage = await request(app.getHttpServer())
      .get(`/accounts/${a}/statement`)
      .query({ limit: 2 })
      .set('Authorization', bearer)
      .expect(200);
    const firstBody = firstPage.body as StatementResponse;
    expect(firstBody.entries).toHaveLength(2);
    expect(firstBody.nextCursor).not.toBeNull();

    const secondPage = await request(app.getHttpServer())
      .get(`/accounts/${a}/statement`)
      .query({ limit: 2, cursor: firstBody.nextCursor })
      .set('Authorization', bearer)
      .expect(200);
    expect((secondPage.body as StatementResponse).entries).toHaveLength(1);
  });

  it("returns 404 for another owner's statement", async () => {
    const world = await worldUsdId();
    const a = await openAccount();
    await transfer(world, a, '100');

    await request(app.getHttpServer())
      .get(`/accounts/${a}/statement`)
      .set('Authorization', bearerOther)
      .expect(404)
      .expect('Content-Type', /application\/problem\+json/);
  });
});
