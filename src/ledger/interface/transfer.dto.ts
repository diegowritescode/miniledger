import { z } from 'zod';

export const transferSchema = z.object({
  from: z.string().uuid(),
  to: z.string().uuid(),
  amount: z.string().regex(/^\d+$/),
  currency: z.string().min(1).max(8),
});

export type TransferDto = z.infer<typeof transferSchema>;
