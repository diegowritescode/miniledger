import { type OpenAPIObject } from '@nestjs/swagger';
import { type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

type BodySchema = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];

const toOpenApi = zodToJsonSchema as unknown as (
  schema: ZodTypeAny,
  options: { target: 'openApi3'; $refStrategy: 'none' },
) => BodySchema;

export function openApiSchema(schema: ZodTypeAny): BodySchema {
  return toOpenApi(schema, { target: 'openApi3', $refStrategy: 'none' });
}
