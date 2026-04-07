import { Injectable, Logger } from '@nestjs/common';

const TOKEN_BLACKLIST_PREFIX = 'token:blacklist:';

/**
 * In-memory session blacklist for token revocation.
 * Entries expire automatically via a cleanup interval.
 * Note: cleared on process restart — acceptable for session revocation use case
 * since tokens also expire naturally via their TTL.
 */
@Injectable()
export class SessionBlacklistService {
  private readonly logger = new Logger('SessionBlacklist');
  private readonly store = new Map<string, number>(); // key → expiry timestamp (ms)

  constructor() {
    // Cleanup expired entries every 10 minutes
    setInterval(() => this.cleanup(), 10 * 60 * 1000).unref();
  }

  async revoke(token: string, expiresInSeconds: number): Promise<void> {
    const key = this.buildKey(token);
    const expiresAt = Date.now() + Math.max(expiresInSeconds, 1) * 1000;
    this.store.set(key, expiresAt);
    this.logger.log(`Token revoked, TTL=${expiresInSeconds}s`);
  }

  async isRevoked(token: string): Promise<boolean> {
    const key = this.buildKey(token);
    const expiresAt = this.store.get(key);
    if (expiresAt === undefined) return false;
    if (Date.now() > expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  private buildKey(token: string): string {
    const suffix = token.length > 16 ? token.slice(-16) : token;
    return `${TOKEN_BLACKLIST_PREFIX}${suffix}`;
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, expiresAt] of this.store) {
      if (now > expiresAt) this.store.delete(key);
    }
  }
}
