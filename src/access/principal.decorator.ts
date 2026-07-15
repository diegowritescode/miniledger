import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { type Principal } from './principal';

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal | undefined => {
    const request = context.switchToHttp().getRequest<{ principal?: Principal }>();
    return request.principal;
  },
);
