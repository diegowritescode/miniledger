import { Module } from '@nestjs/common';
import {
  ACCESS_CORE_CLIENT,
  type AccessCoreClient,
  AccessCorePermissionGuard,
  createClient,
} from '@diegowritescode/accesscore-sdk';
import { createRemoteJWKSet } from 'jose';
import { type Env } from '../config/env';
import { ENV } from '../config/env.module';
import { AccessTokenGuard } from './access-token.guard';
import { JWKS_RESOLVER, type JwksResolver } from './jwks-resolver';

@Module({
  providers: [
    {
      provide: ACCESS_CORE_CLIENT,
      inject: [ENV],
      useFactory: (env: Env): AccessCoreClient =>
        createClient({
          baseUrl: env.ACCESSCORE_BASE_URL,
          timeoutMs: env.ACCESSCORE_CHECK_TIMEOUT_MS,
        }),
    },
    {
      provide: JWKS_RESOLVER,
      inject: [ENV],
      useFactory: (env: Env): JwksResolver => createRemoteJWKSet(new URL(env.ACCESSCORE_JWKS_URL)),
    },
    AccessTokenGuard,
    AccessCorePermissionGuard,
  ],
  exports: [ACCESS_CORE_CLIENT, JWKS_RESOLVER, AccessTokenGuard, AccessCorePermissionGuard],
})
export class AccessModule {}
