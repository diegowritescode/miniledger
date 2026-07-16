import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { setupOpenApi } from '../src/openapi';

interface OpenApiDoc {
  info: { title: string; version: string };
  paths: Record<string, unknown>;
  components?: { securitySchemes?: Record<string, unknown> };
}

describe('OpenAPI (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgres://miniledger:miniledger@localhost:5433/miniledger';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupOpenApi(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves the OpenAPI document at /docs-json', async () => {
    const response = await request(app.getHttpServer()).get('/docs-json').expect(200);
    const doc = response.body as OpenApiDoc;

    expect(doc.info.title).toBe('MiniLedger API');
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/transfers', '/accounts']));
    expect(doc.components?.securitySchemes).toHaveProperty('access-token');
  });
});
