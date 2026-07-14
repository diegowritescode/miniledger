import { Module } from '@nestjs/common';
import {
  ACCESS_CORE_CLIENT,
  type AccessCoreClient,
  AccessCorePermissionGuard,
  createClient,
} from '@diegowritescode/accesscore-sdk';
import { type Env } from '../config/env';
import { ENV } from '../config/env.module';

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
    AccessCorePermissionGuard,
  ],
  exports: [ACCESS_CORE_CLIENT, AccessCorePermissionGuard],
})
export class AccessModule {}
