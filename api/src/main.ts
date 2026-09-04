import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';

// Prisma returns BigInt for bigint columns (page_count, uptime_ticks, ...),
// and native JSON.stringify has no idea how to serialize a BigInt - it
// throws. Rather than manually converting every response field, teach
// BigInt how to serialize itself, once, globally: as a string, since a page
// count can in principle exceed Number's safe integer range.
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Standard security response headers (X-Content-Type-Options,
  // X-Frame-Options, etc.) - this API never serves HTML of its own (JSON,
  // PDFs, agent binaries only), so helmet's default CSP is harmless here
  // and left at its default rather than tuned per-route.
  app.use(helmet());

  // The dashboard (web/) calls this API from a browser on a different
  // origin. CORS_ORIGIN (comma-separated if there's ever more than one
  // real origin) locks this down in production; left unset, it stays wide
  // open, which is fine for local dev where the origin varies by machine/port.
  const corsOrigin = process.env.CORS_ORIGIN;
  app.enableCors(corsOrigin ? { origin: corsOrigin.split(',').map((o) => o.trim()) } : undefined);

  // Raw full-MIB capture (see agent's full_raw_capture) can push a batch
  // well past Express's 100kb default body limit.
  app.use(json({ limit: '10mb' }));

  // whitelist strips unrecognized fields; forbidNonWhitelisted goes further
  // and rejects the whole request when one shows up - a client sending a
  // field no DTO expects is far more likely a bug (or a probe) than
  // something to quietly ignore.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  console.log(`OmniPrint API listening on :${port}`);
}

bootstrap();
