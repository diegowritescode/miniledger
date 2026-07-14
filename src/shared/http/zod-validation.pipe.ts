import { type PipeTransform } from '@nestjs/common';
import { type ZodType } from 'zod';
import { ProblemException } from './problem-details';

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new ProblemException({
        type: 'about:blank',
        title: 'Validation failed',
        status: 422,
        detail: parsed.error.issues.map((issue) => issue.message).join('; '),
      });
    }
    return parsed.data;
  }
}
