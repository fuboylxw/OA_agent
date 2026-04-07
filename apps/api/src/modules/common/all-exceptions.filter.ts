import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const traceId = (request as any).traceId || randomUUID();

    let status: number;
    let message: string;
    let error: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      message = typeof body === 'string' ? body : (body as any).message || exception.message;
      error = typeof body === 'string' ? body : (body as any).error || 'Error';
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = this.mapPrismaError(exception);
      status = mapped.status;
      message = mapped.message;
      error = mapped.error;
    } else if (exception instanceof Prisma.PrismaClientInitializationError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      message = '数据库连接不可用';
      error = 'Service Unavailable';
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = '请求数据格式错误';
      error = 'Bad Request';
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = '服务器内部错误';
      error = 'Internal Server Error';
    }

    // Log full details server-side, return sanitized response to client
    if (status >= 500) {
      this.logger.error(
        `[${traceId}] ${request.method} ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `[${traceId}] ${request.method} ${request.url} → ${status}: ${message}`,
      );
    }

    response.status(status).json({
      statusCode: status,
      error,
      message: Array.isArray(message) ? message : [message],
      traceId,
      timestamp: new Date().toISOString(),
    });
  }

  private mapPrismaError(err: Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        return { status: HttpStatus.CONFLICT, message: '数据已存在（唯一约束冲突）', error: 'Conflict' };
      case 'P2025':
        return { status: HttpStatus.NOT_FOUND, message: '请求的资源不存在', error: 'Not Found' };
      case 'P2003':
        return { status: HttpStatus.BAD_REQUEST, message: '关联数据不存在（外键约束）', error: 'Bad Request' };
      default:
        return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: '数据库操作失败', error: 'Internal Server Error' };
    }
  }
}
