/**
 * 助手异常类
 * 定义各种业务异常
 */

import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODE, ERROR_MESSAGE } from '../constants/assistant.constants';

/**
 * 基础助手异常
 */
export class AssistantException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: any,
  ) {
    super({ code, message, details }, status);
  }
}

/**
 * 参数异常
 */
export class ParameterException extends AssistantException {
  constructor(message: string, details?: any) {
    super(ERROR_CODE.PARAMETER_INVALID, message, HttpStatus.BAD_REQUEST, details);
  }
}

/**
 * 参数必填异常
 */
export class ParameterRequiredException extends AssistantException {
  constructor(parameterName: string, details?: any) {
    super(
      ERROR_CODE.PARAMETER_REQUIRED,
      `${parameterName}${ERROR_MESSAGE[ERROR_CODE.PARAMETER_REQUIRED]}`,
      HttpStatus.BAD_REQUEST,
      details,
    );
  }
}

/**
 * 参数类型异常
 */
export class ParameterTypeException extends AssistantException {
  constructor(parameterName: string, expectedType: string, actualType: string) {
    super(
      ERROR_CODE.PARAMETER_TYPE_ERROR,
      `${parameterName}类型错误，期望${expectedType}，实际${actualType}`,
      HttpStatus.BAD_REQUEST,
      { parameterName, expectedType, actualType },
    );
  }
}

/**
 * 验证异常
 */
export class ValidationException extends AssistantException {
  constructor(message: string, details?: any) {
    super(ERROR_CODE.VALIDATION_FAILED, message, HttpStatus.BAD_REQUEST, details);
  }
}

/**
 * 流程异常
 */
export class ProcessException extends AssistantException {
  constructor(message: string, details?: any) {
    super(ERROR_CODE.PROCESS_EXECUTION_FAILED, message, HttpStatus.INTERNAL_SERVER_ERROR, details);
  }
}

/**
 * 流程不存在异常
 */
export class ProcessNotFoundException extends AssistantException {
  constructor(processCode: string) {
    super(
      ERROR_CODE.PROCESS_NOT_FOUND,
      `流程不存在: ${processCode}`,
      HttpStatus.NOT_FOUND,
      { processCode },
    );
  }
}

/**
 * 流程超时异常
 */
export class ProcessTimeoutException extends AssistantException {
  constructor(processId: string, timeoutMs: number) {
    super(
      ERROR_CODE.PROCESS_TIMEOUT,
      `流程执行超时: ${processId}`,
      HttpStatus.REQUEST_TIMEOUT,
      { processId, timeoutMs },
    );
  }
}

/**
 * 会话异常
 */
export class SessionException extends AssistantException {
  constructor(message: string, details?: any) {
    super(ERROR_CODE.SESSION_INVALID, message, HttpStatus.BAD_REQUEST, details);
  }
}

/**
 * 会话不存在异常
 */
export class SessionNotFoundException extends AssistantException {
  constructor(sessionId: string) {
    super(
      ERROR_CODE.SESSION_NOT_FOUND,
      `会话不存在: ${sessionId}`,
      HttpStatus.NOT_FOUND,
      { sessionId },
    );
  }
}

/**
 * 会话过期异常
 */
export class SessionExpiredException extends AssistantException {
  constructor(sessionId: string) {
    super(
      ERROR_CODE.SESSION_EXPIRED,
      `会话已过期: ${sessionId}`,
      HttpStatus.GONE,
      { sessionId },
    );
  }
}

/**
 * 用户异常
 */
export class UserException extends AssistantException {
  constructor(message: string, details?: any) {
    super(ERROR_CODE.USER_NOT_FOUND, message, HttpStatus.NOT_FOUND, details);
  }
}

/**
 * 用户不存在异常
 */
export class UserNotFoundException extends AssistantException {
  constructor(userId: string) {
    super(
      ERROR_CODE.USER_NOT_FOUND,
      `用户不存在: ${userId}`,
      HttpStatus.NOT_FOUND,
      { userId },
    );
  }
}

/**
 * 用户无权限异常
 */
export class UserUnauthorizedException extends AssistantException {
  constructor(userId: string, action: string, resource?: string) {
    super(
      ERROR_CODE.USER_UNAUTHORIZED,
      `用户无权限执行操作: ${action}`,
      HttpStatus.FORBIDDEN,
      { userId, action, resource },
    );
  }
}

/**
 * MCP异常
 */
export class MCPException extends AssistantException {
  constructor(message: string, details?: any) {
    super(ERROR_CODE.MCP_CALL_FAILED, message, HttpStatus.INTERNAL_SERVER_ERROR, details);
  }
}

/**
 * MCP工具不存在异常
 */
export class MCPToolNotFoundException extends AssistantException {
  constructor(toolName: string) {
    super(
      ERROR_CODE.MCP_TOOL_NOT_FOUND,
      `MCP工具不存在: ${toolName}`,
      HttpStatus.NOT_FOUND,
      { toolName },
    );
  }
}

/**
 * MCP超时异常
 */
export class MCPTimeoutException extends AssistantException {
  constructor(toolName: string, timeoutMs: number) {
    super(
      ERROR_CODE.MCP_TIMEOUT,
      `MCP调用超时: ${toolName}`,
      HttpStatus.REQUEST_TIMEOUT,
      { toolName, timeoutMs },
    );
  }
}

/**
 * 内部错误异常
 */
export class InternalErrorException extends AssistantException {
  constructor(message: string, details?: any) {
    super(ERROR_CODE.INTERNAL_ERROR, message, HttpStatus.INTERNAL_SERVER_ERROR, details);
  }
}

/**
 * 数据库异常
 */
export class DatabaseException extends AssistantException {
  constructor(message: string, details?: any) {
    super(ERROR_CODE.DATABASE_ERROR, message, HttpStatus.INTERNAL_SERVER_ERROR, details);
  }
}

/**
 * 网络异常
 */
export class NetworkException extends AssistantException {
  constructor(message: string, details?: any) {
    super(ERROR_CODE.NETWORK_ERROR, message, HttpStatus.SERVICE_UNAVAILABLE, details);
  }
}

/**
 * 异常工厂
 */
export class ExceptionFactory {
  /**
   * 创建参数异常
   */
  static createParameterException(parameterName: string, message?: string): ParameterException {
    return new ParameterException(message || `参数错误: ${parameterName}`);
  }

  /**
   * 创建验证异常
   */
  static createValidationException(errors: Array<{ field: string; message: string }>): ValidationException {
    const message = errors.map(e => `${e.field}: ${e.message}`).join('; ');
    return new ValidationException(message, { errors });
  }

  /**
   * 创建流程异常
   */
  static createProcessException(processCode: string, error: Error): ProcessException {
    return new ProcessException(`流程执行失败: ${processCode}`, {
      processCode,
      error: error.message,
      stack: error.stack,
    });
  }

  /**
   * 创建MCP异常
   */
  static createMCPException(toolName: string, error: Error): MCPException {
    return new MCPException(`MCP调用失败: ${toolName}`, {
      toolName,
      error: error.message,
      stack: error.stack,
    });
  }

  /**
   * 从错误创建异常
   */
  static fromError(error: Error): AssistantException {
    if (error instanceof AssistantException) {
      return error;
    }

    // 根据错误类型创建相应的异常
    if (error.message.includes('not found')) {
      return new InternalErrorException(error.message, { originalError: error.message });
    }

    if (error.message.includes('timeout')) {
      return new InternalErrorException(error.message, { originalError: error.message });
    }

    if (error.message.includes('permission') || error.message.includes('unauthorized')) {
      return new InternalErrorException(error.message, { originalError: error.message });
    }

    // 默认返回内部错误
    return new InternalErrorException(error.message, {
      originalError: error.message,
      stack: error.stack,
    });
  }
}

/**
 * 异常处理器
 */
export class ExceptionHandler {
  /**
   * 处理异常
   */
  static handle(error: Error): {
    code: string;
    message: string;
    status: number;
    details?: any;
  } {
    if (error instanceof AssistantException) {
      return {
        code: error.code,
        message: error.message,
        status: error.getStatus(),
        details: error.details,
      };
    }

    // 未知错误
    return {
      code: ERROR_CODE.INTERNAL_ERROR,
      message: error.message || ERROR_MESSAGE[ERROR_CODE.INTERNAL_ERROR],
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      details: {
        originalError: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
    };
  }

  /**
   * 格式化错误响应
   */
  static formatErrorResponse(error: Error): {
    success: false;
    error: {
      code: string;
      message: string;
      details?: any;
    };
    timestamp: string;
  } {
    const handled = this.handle(error);

    return {
      success: false,
      error: {
        code: handled.code,
        message: handled.message,
        details: handled.details,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 记录错误日志
   */
  static logError(error: Error, context?: string): void {
    const handled = this.handle(error);

    console.error(`[${context || 'AssistantException'}]`, {
      code: handled.code,
      message: handled.message,
      status: handled.status,
      details: handled.details,
      timestamp: new Date().toISOString(),
    });

    // 在生产环境中，这里应该发送到日志服务
    // 例如: Sentry, LogRocket, CloudWatch等
  }

  /**
   * 判断是否为可重试错误
   */
  static isRetryable(error: Error): boolean {
    if (error instanceof AssistantException) {
      const retryableCodes = [
        ERROR_CODE.MCP_TIMEOUT,
        ERROR_CODE.NETWORK_ERROR,
        ERROR_CODE.DATABASE_ERROR,
      ];
      return retryableCodes.includes(error.code as any);
    }

    // 网络相关错误通常可重试
    return error.message.includes('timeout') ||
           error.message.includes('network') ||
           error.message.includes('ECONNREFUSED') ||
           error.message.includes('ETIMEDOUT');
  }

  /**
   * 判断是否为用户错误
   */
  static isUserError(error: Error): boolean {
    if (error instanceof AssistantException) {
      const userErrorCodes = [
        ERROR_CODE.PARAMETER_REQUIRED,
        ERROR_CODE.PARAMETER_INVALID,
        ERROR_CODE.PARAMETER_TYPE_ERROR,
        ERROR_CODE.VALIDATION_FAILED,
        ERROR_CODE.SESSION_NOT_FOUND,
        ERROR_CODE.SESSION_EXPIRED,
        ERROR_CODE.USER_UNAUTHORIZED,
      ];
      return userErrorCodes.includes(error.code as any);
    }

    return false;
  }

  /**
   * 判断是否为系统错误
   */
  static isSystemError(error: Error): boolean {
    return !this.isUserError(error);
  }

  /**
   * 获取用户友好的错误消息
   */
  static getUserFriendlyMessage(error: Error): string {
    if (error instanceof AssistantException) {
      // 对于某些技术性错误，返回更友好的消息
      switch (error.code) {
        case ERROR_CODE.DATABASE_ERROR:
          return '系统繁忙，请稍后重试';
        case ERROR_CODE.NETWORK_ERROR:
          return '网络连接失败，请检查网络后重试';
        case ERROR_CODE.MCP_TIMEOUT:
          return '操作超时，请稍后重试';
        case ERROR_CODE.INTERNAL_ERROR:
          return '系统出现问题，请联系管理员';
        default:
          return error.message;
      }
    }

    return '操作失败，请稍后重试';
  }
}
