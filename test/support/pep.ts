import {
  type AccessCoreClient,
  type Decision,
  REASON_CODES,
} from '@diegowritescode/accesscore-sdk';

export interface PepStub {
  readonly client: AccessCoreClient;
  permit(): void;
  deny(code?: string): void;
  unavailable(): void;
}

export function createPepStub(): PepStub {
  let decision: Decision = { effect: 'permit', reasons: [] };
  const client: AccessCoreClient = { check: () => Promise.resolve(decision) };
  return {
    client,
    permit: () => {
      decision = { effect: 'permit', reasons: [] };
    },
    deny: (code = REASON_CODES.DEFAULT_DENY) => {
      decision = { effect: 'deny', reasons: [{ code, message: 'denied' }] };
    },
    unavailable: () => {
      decision = {
        effect: 'deny',
        reasons: [{ code: REASON_CODES.PDP_UNAVAILABLE, message: 'pdp down' }],
      };
    },
  };
}
