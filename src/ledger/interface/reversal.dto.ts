import { z } from 'zod';

export const reversalSchema = z.object({
  transactionId: z.string().uuid(),
});

export type ReversalDto = z.infer<typeof reversalSchema>;
