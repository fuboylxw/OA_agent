import { createHash } from 'crypto';
import { Logger, UnauthorizedException } from '@nestjs/common';

const MIN_SECRET_LENGTH = 32;
let startupValidated = false;

export function getAuthSessionSecret() {
  const secret = process.env.AUTH_SESSION_SECRET || process.env.JWT_SECRET;
  if (secret) {
    // Validate secret strength in production on first call
    if (!startupValidated && process.env.NODE_ENV === 'production') {
      startupValidated = true;
      if (secret.length < MIN_SECRET_LENGTH) {
        const logger = new Logger('AuthSessionSecret');
        logger.error(
          `AUTH_SESSION_SECRET is too short (${secret.length} chars). ` +
          `Production requires at least ${MIN_SECRET_LENGTH} characters. ` +
          `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
        );
        throw new Error('AUTH_SESSION_SECRET does not meet minimum length requirement for production');
      }
      if (secret === 'change-me-in-production' || secret === 'CHANGE_ME_TO_RANDOM_32_CHAR_STRING') {
        throw new Error('AUTH_SESSION_SECRET is still set to the placeholder value. Change it before deploying to production.');
      }
    }
    return secret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new UnauthorizedException('服务端未配置 AUTH_SESSION_SECRET');
  }

  const fallbackSeed = createHash('sha256')
    .update(process.cwd())
    .update(process.env.DEFAULT_TENANT_ID || '')
    .digest('hex');

  return `dev-session-secret-${fallbackSeed}`;
}
