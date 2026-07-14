import { type ExecutionContext } from '@nestjs/common';
import { createAccessTestKit, type AccessTestKit } from '../../test/support/access';
import { type Env } from '../config/env';
import { ProblemException } from '../shared/http/problem-details';
import { AccessTokenGuard } from './access-token.guard';
import { type Principal } from './principal';

const env = {
  ACCESSCORE_JWT_ISSUER: 'https://auth.accesscore.dev',
  ACCESSCORE_JWT_AUDIENCE: 'accesscore',
  ACCESSCORE_CLOCK_SKEW_SECONDS: 30,
} as unknown as Env;

interface TestRequest {
  headers: { authorization?: string };
  principal?: Principal;
}

const contextFor = (request: TestRequest): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe('AccessTokenGuard', () => {
  let kit: AccessTestKit;
  let guard: AccessTokenGuard;

  beforeAll(async () => {
    kit = await createAccessTestKit();
    guard = new AccessTokenGuard(kit.jwksResolver, env);
  });

  it('accepts a valid token and attaches the principal', async () => {
    const token = await kit.mintToken({ subject: 'user-42', org: 'org-9' });
    const request: TestRequest = { headers: { authorization: `Bearer ${token}` } };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.principal).toEqual({
      subject: 'user-42',
      org: 'org-9',
      sessionId: 'session-1',
      assuranceLevel: 'aal1',
    });
  });

  it('rejects a request with no bearer token', async () => {
    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toBeInstanceOf(
      ProblemException,
    );
  });

  it('rejects a non-bearer authorization header', async () => {
    const request: TestRequest = { headers: { authorization: 'Basic abc' } };
    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(ProblemException);
  });

  it('rejects a malformed token', async () => {
    const request: TestRequest = { headers: { authorization: 'Bearer not-a-jwt' } };
    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(ProblemException);
  });

  it('rejects a token from the wrong issuer', async () => {
    const token = await kit.mintToken({ issuer: 'https://evil.example' });
    const request: TestRequest = { headers: { authorization: `Bearer ${token}` } };
    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(ProblemException);
  });

  it('rejects a token for the wrong audience', async () => {
    const token = await kit.mintToken({ audience: 'someone-else' });
    const request: TestRequest = { headers: { authorization: `Bearer ${token}` } };
    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(ProblemException);
  });

  it('rejects an expired token', async () => {
    const token = await kit.mintToken({ expiresIn: '-1h' });
    const request: TestRequest = { headers: { authorization: `Bearer ${token}` } };
    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(ProblemException);
  });
});
