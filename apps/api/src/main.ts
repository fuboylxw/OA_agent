import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';
import helmet from 'helmet';
import compression = require('compression');
import { registerRuntimeDiagnosticsProcessHandlers } from '@uniflow/agent-kernel';
import { AllExceptionsFilter } from './modules/common/all-exceptions.filter';
import { LoggingInterceptor } from './modules/common/logging.interceptor';
import { getAuthSessionSecret } from './modules/common/auth-session-secret';

function shouldEnableHttpsOnlyHeaders() {
  const candidates = [
    process.env.PUBLIC_WEB_BASE_URL,
    process.env.PUBLIC_BASE_URL,
    process.env.PUBLIC_API_BASE_URL,
    process.env.API_BASE_URL,
  ];

  return candidates.some((value) => (value || '').trim().startsWith('https://'));
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  process.env.APP_RUNTIME = 'api';
  registerRuntimeDiagnosticsProcessHandlers('api');

  // Validate auth secret early — fail fast in production if misconfigured
  getAuthSessionSecret();

  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const captureRawBody = (req: any, _res: any, buffer: Buffer, encoding: BufferEncoding) => {
    req.rawBody = buffer.toString(encoding || 'utf8');
  };
  const enableHttpsOnlyHeaders = shouldEnableHttpsOnlyHeaders();

  // Security headers
  app.use(helmet({
    hsts: enableHttpsOnlyHeaders,
    contentSecurityPolicy: enableHttpsOnlyHeaders
      ? undefined
      : {
          useDefaults: true,
          directives: {
            upgradeInsecureRequests: null,
          },
        },
  }));

  // Response compression
  app.use(compression());

  // Body parser with 10mb limit for API doc uploads
  app.use(bodyParser.json({ limit: '10mb', verify: captureRawBody }));
  app.use(bodyParser.urlencoded({ limit: '10mb', extended: true, verify: captureRawBody }));

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global logging interceptor
  app.useGlobalInterceptors(new LoggingInterceptor());

  // CORS — restrict to known origins in production
  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const isProduction = process.env.NODE_ENV === 'production';
  app.enableCors({
    origin: allowedOrigins.length > 0
      ? allowedOrigins
      : isProduction
        ? false  // deny all cross-origin in production if not configured
        : true,  // allow all in development
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  });

  // API prefix
  app.setGlobalPrefix('api/v1');

  // Swagger documentation — disabled in production unless explicitly enabled
  const enableSwagger = process.env.ENABLE_SWAGGER === 'true';
  if (!isProduction || enableSwagger) {
    const config = new DocumentBuilder()
      .setTitle('UniFlow OA Copilot API')
      .setDescription('API for UniFlow OA Intelligent Office Assistant')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  // Graceful shutdown
  app.enableShutdownHooks();

  const port = process.env.API_PORT || 3001;
  const host = process.env.API_HOST || '0.0.0.0';
  await app.listen(port, host);

  const publicBaseUrl = (process.env.PUBLIC_API_BASE_URL || process.env.API_BASE_URL || '').replace(/\/+$/, '');
  if (publicBaseUrl) {
    logger.log(`API server running on ${publicBaseUrl}`);
    if (!isProduction || enableSwagger) {
      logger.log(`API docs available at ${publicBaseUrl}/api/docs`);
    }
  } else {
    logger.log(`API server listening on ${host}:${port}`);
    if (!isProduction || enableSwagger) {
      logger.log(`API docs available at /api/docs`);
    }
  }
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('Bootstrap failed', error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
