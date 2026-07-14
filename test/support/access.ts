import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';

const ISSUER = 'https://auth.accesscore.dev';
const AUDIENCE = 'accesscore';

export interface MintOptions {
  readonly subject?: string;
  readonly org?: string;
  readonly issuer?: string;
  readonly audience?: string;
  readonly expiresIn?: string;
}

export interface AccessTestKit {
  readonly jwksResolver: JWTVerifyGetKey;
  mintToken(options?: MintOptions): Promise<string>;
}

export async function createAccessTestKit(): Promise<AccessTestKit> {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { extractable: true });
  const jwk = await exportJWK(publicKey);
  const jwksResolver = createLocalJWKSet({
    keys: [{ ...jwk, kid: 'test-key', alg: 'EdDSA', use: 'sig' }],
  });

  const mintToken = (options: MintOptions = {}): Promise<string> =>
    new SignJWT({ sid: 'session-1', aal: 'aal1', org: options.org ?? 'org-1' })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'test-key', typ: 'JWT' })
      .setIssuer(options.issuer ?? ISSUER)
      .setAudience(options.audience ?? AUDIENCE)
      .setSubject(options.subject ?? 'user-1')
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? '15m')
      .sign(privateKey);

  return { jwksResolver, mintToken };
}
