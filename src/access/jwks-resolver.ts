import { type JWTVerifyGetKey } from 'jose';

export type JwksResolver = JWTVerifyGetKey;

export const JWKS_RESOLVER = Symbol('JWKS_RESOLVER');
