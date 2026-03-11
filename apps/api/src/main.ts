import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const captureRawBody = (req: any, _res: any, buffer: Buffer, encoding: BufferEncoding) => {
    req.rawBody = buffer.toString(encoding || 'utf8');
  };

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

  // CORS
  app.enableCors();

  // API prefix
  app.setGlobalPrefix('api/v1');

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('UniFlow OA Copilot API')
    .setDescription('API for UniFlow OA Intelligent Office Assistant')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const logger = new Logger('Bootstrap');
  const port = process.env.API_PORT || 3001;
  await app.listen(port);
  logger.log(`API server running on http://localhost:${port}`);
  logger.log(`API docs available at http://localhost:${port}/api/docs`);
}

bootstrap();
