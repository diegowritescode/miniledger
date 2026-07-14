export interface Principal {
  readonly subject: string;
  readonly org: string | null;
  readonly sessionId: string | null;
  readonly assuranceLevel: string | null;
}
