import { Controller, Get, Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

@Controller()
@SkipThrottle()
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get('health')
  liveness(): { status: string; uptime: number } {
    return { status: 'ok', uptime: Math.floor(process.uptime()) };
  }

  @Get('ready')
  async readiness(): Promise<{ status: string }> {
    await this.pool.query('SELECT 1');
    return { status: 'ready' };
  }
}
