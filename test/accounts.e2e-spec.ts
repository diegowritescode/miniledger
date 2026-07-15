import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { JWKS_RESOLVER } from '../src/access/jwks-resolver';
import { createAccessTestKit } from './support/access';

interface AccountResponse {
  id: string;
  type: string;
  currency: string;
  overdraftFloor: string | null;
  createdAt: string;
}

describe('Accounts (e2e)', () => {
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
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects a request with no bearer token (401 problem+json)', async () => {
    await request(app.getHttpServer())
      .get('/accounts')
      .expect(401)
      .expect('Content-Type', /application\/problem\+json/);
  });

  it('POST /accounts -> 201 opens a user account', async () => {
    const response = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', bearer)
      .send({ currency: 'USD' })
      .expect(201);

    const body = response.body as AccountResponse;
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.type).toBe('user');
    expect(body.currency).toBe('USD');
    expect(body.overdraftFloor).toBe('0');
    expect(typeof body.createdAt).toBe('string');
  });

  it('GET /accounts/:id -> 200 returns the account', async () => {
    const created = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', bearer)
      .send({ currency: 'EUR' })
      .expect(201);
    const id = (created.body as AccountResponse).id;

    const response = await request(app.getHttpServer())
      .get(`/accounts/${id}`)
      .set('Authorization', bearer)
      .expect(200);

    expect((response.body as AccountResponse).id).toBe(id);
    expect((response.body as AccountResponse).currency).toBe('EUR');
  });

  it('GET /accounts/:id -> 404 problem+json for an unknown id', async () => {
    const response = await request(app.getHttpServer())
      .get(`/accounts/${randomUUID()}`)
      .set('Authorization', bearer)
      .expect(404)
      .expect('Content-Type', /application\/problem\+json/);

    expect((response.body as { status: number }).status).toBe(404);
  });

  it('POST /accounts -> 422 problem+json for an unknown currency', async () => {
    const response = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', bearer)
      .send({ currency: 'ZZZ' })
      .expect(422)
      .expect('Content-Type', /application\/problem\+json/);

    expect((response.body as { status: number }).status).toBe(422);
  });

  it('POST /accounts -> 422 problem+json for an invalid body', async () => {
    await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', bearer)
      .send({ currency: 123 })
      .expect(422)
      .expect('Content-Type', /application\/problem\+json/);
  });

  it('GET /accounts -> 200 lists accounts including @world', async () => {
    const response = await request(app.getHttpServer())
      .get('/accounts')
      .set('Authorization', bearer)
      .expect(200);

    const body = response.body as AccountResponse[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.some((account) => account.type === 'system')).toBe(true);
  });

  it('GET /accounts/:id -> 404 when the account belongs to another owner', async () => {
    const created = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', bearer)
      .send({ currency: 'USD' })
      .expect(201);
    const id = (created.body as AccountResponse).id;

    await request(app.getHttpServer())
      .get(`/accounts/${id}`)
      .set('Authorization', bearerOther)
      .expect(404)
      .expect('Content-Type', /application\/problem\+json/);
  });

  it("GET /accounts omits another owner's account but keeps system accounts", async () => {
    const created = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', bearer)
      .send({ currency: 'USD' })
      .expect(201);
    const id = (created.body as AccountResponse).id;

    const response = await request(app.getHttpServer())
      .get('/accounts')
      .set('Authorization', bearerOther)
      .expect(200);

    const body = response.body as AccountResponse[];
    expect(body.some((account) => account.id === id)).toBe(false);
    expect(body.some((account) => account.type === 'system')).toBe(true);
  });
});
