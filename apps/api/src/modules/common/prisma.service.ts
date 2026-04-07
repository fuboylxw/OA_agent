import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Prisma');

  constructor() {
    const isProduction = process.env.NODE_ENV === 'production';
    super({
      log: isProduction
        ? [{ emit: 'event', level: 'query' }, { emit: 'stdout', level: 'error' }]
        : [{ emit: 'event', level: 'query' }, 'info', 'warn', 'error'],
    });
  }

  async onModuleInit() {
    // Log slow queries (> 200ms)
    (this as any).$on('query', (e: any) => {
      if (e.duration > 200) {
        this.logger.warn(`Slow query (${e.duration}ms): ${e.query}`);
      }
    });

    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
