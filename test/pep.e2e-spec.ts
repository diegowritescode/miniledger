import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ACCESS_CORE_CLIENT } from '@diegowritescode/accesscore-sdk';
import { AppModule } from '../src/app.module';
import { JWKS_RESOLVER } from '../src/access/jwks-resolver';
import { createAccessTestKit } from './support/access';
import { createPepStub, type PepStub } from './support/pep';

describe('Permission enforcement (e2e)', () => {
  let app: INestApplication;
  let bearer: string;
  let pep: PepStub;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgres://miniledger:miniledger@localhost:5433/miniledger';
    const kit = await createAccessTestKit();
    bearer = `Bearer ${await kit.mintToken()}`;
    pep = createPepStub();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JWKS_RESOLVER)
      .useValue(kit.jwksResolver)
      .overrideProvider(ACCESS_CORE_CLIENT)
      .useValue(pep.client)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const openAccount = () =>
    request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', bearer)
      .send({ currency: 'USD' });

  it('permits the operation when AccessCore grants the capability (201)', async () => {
    pep.permit();
    await openAccount().expect(201);
  });

  it('forbids the operation when AccessCore denies the capability (403 problem+json)', async () => {
    pep.deny();
    await openAccount()
      .expect(403)
      .expect('Content-Type', /application\/problem\+json/);
  });

  it('fails closed with 503 when the PDP is unavailable', async () => {
    pep.unavailable();
    await openAccount()
      .expect(503)
      .expect('Content-Type', /application\/problem\+json/);
  });
});
