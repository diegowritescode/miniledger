import { z } from 'zod';

export const statementQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.coerce.number().int().nonnegative().optional(),
});

export type StatementQuery = z.infer<typeof statementQuerySchema>;
