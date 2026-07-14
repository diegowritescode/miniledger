import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { type Request } from 'express';
import { jwtVerify } from 'jose';
import { type Env } from '../config/env';
import { ENV } from '../config/env.module';
import { ProblemException } from '../shared/http/problem-details';
import { JWKS_RESOLVER, type JwksResolver } from './jwks-resolver';
import { type Principal } from './principal';

type AuthenticatedRequest = Request & { principal?: Principal };

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    @Inject(JWKS_RESOLVER) private readonly jwks: JwksResolver,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.bearer(request.headers.authorization);
    if (!token) throw this.unauthenticated('a bearer access token is required');

    let subject: string | undefined;
    let claims: Record<string, unknown>;
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.env.ACCESSCORE_JWT_ISSUER,
        audience: this.env.ACCESSCORE_JWT_AUDIENCE,
        algorithms: ['EdDSA'],
        clockTolerance: this.env.ACCESSCORE_CLOCK_SKEW_SECONDS,
      });
      subject = payload.sub;
      claims = payload;
    } catch {
      throw this.unauthenticated('the access token is invalid or expired');
    }

    if (!subject) throw this.unauthenticated('the access token has no subject');

    request.principal = {
      subject,
      org: this.stringClaim(claims.org),
      sessionId: this.stringClaim(claims.sid),
      assuranceLevel: this.stringClaim(claims.aal),
    };
    return true;
  }

  private bearer(header: string | undefined): string | null {
    if (!header || !header.startsWith('Bearer ')) return null;
    return header.slice('Bearer '.length).trim() || null;
  }

  private stringClaim(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
  }

  private unauthenticated(detail: string): ProblemException {
    return new ProblemException({
      type: 'about:blank',
      title: 'Unauthenticated',
      status: 401,
      detail,
    });
  }
}
