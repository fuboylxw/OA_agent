import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const traceId = randomUUID();
    (request as any).traceId = traceId;

    const { method, url } = request;
    const userId = (request as any).authClaims?.userId || '-';
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - start;
          this.logger.log(
            `[${traceId}] ${method} ${url} → ${response.statusCode} ${duration}ms user=${userId}`,
          );
        },
        error: () => {
          const duration = Date.now() - start;
          this.logger.warn(
            `[${traceId}] ${method} ${url} → ERR ${duration}ms user=${userId}`,
          );
        },
      }),
    );
  }
}
