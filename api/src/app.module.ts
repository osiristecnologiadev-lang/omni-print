import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { AuthModule } from './auth/auth.module';
import { IngestModule } from './ingest/ingest.module';
import { DevicesModule } from './devices/devices.module';
import { CustomersModule } from './customers/customers.module';
import { UsersModule } from './users/users.module';
import { PlatformModule } from './platform/platform.module';
import { ContractsModule } from './contracts/contracts.module';
import { InvoicesModule } from './invoices/invoices.module';
import { TenantModule } from './tenant/tenant.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TicketsModule } from './tickets/tickets.module';
import { AgentReleasesModule } from './agent-releases/agent-releases.module';
import { AgentEnrollmentModule } from './agent-enrollment/agent-enrollment.module';
import { SignupModule } from './signup/signup.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Powers InvoicesService's @Cron nightly invoice generation.
    ScheduleModule.forRoot(),
    // Global default: 60 req/min per IP. Login and ingest (both are
    // credential-guessing surfaces - password / agent token) set tighter
    // per-route limits with @Throttle - see auth.controller.ts and
    // ingest.controller.ts.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    PrismaModule,
    AuditLogModule,
    AuthModule,
    IngestModule,
    DevicesModule,
    CustomersModule,
    UsersModule,
    PlatformModule,
    ContractsModule,
    InvoicesModule,
    TenantModule,
    NotificationsModule,
    TicketsModule,
    AgentReleasesModule,
    AgentEnrollmentModule,
    SignupModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
