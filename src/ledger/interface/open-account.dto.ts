import { z } from 'zod';

export const openAccountSchema = z.object({
  currency: z.string().min(1).max(8),
});

export type OpenAccountDto = z.infer<typeof openAccountSchema>;
