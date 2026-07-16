import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

@ApiTags('health')
@Controller()
@SkipThrottle()
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness probe (open)' })
  liveness(): { status: string; uptime: number } {
    return { status: 'ok', uptime: Math.floor(process.uptime()) };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — pings Postgres (open)' })
  async readiness(): Promise<{ status: string }> {
    await this.pool.query('SELECT 1');
    return { status: 'ready' };
  }
}
