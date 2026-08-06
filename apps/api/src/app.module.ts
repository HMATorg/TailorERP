import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { AppointmentsModule } from './appointments/appointments.module';
import { AuditModule } from './audit/audit.module';
import { ButtonsModule } from './buttons/buttons.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { LedgerModule } from './ledger/ledger.module';
import { PosModule } from './pos/pos.module';
import { WorkshopModule } from './workshop/workshop.module';
import { ZatcaModule } from './zatca/zatca.module';
import { BillingModule } from './billing/billing.module';
import { CustomerModule } from './customer-api/customer.module';
import { CustomersModule } from './customers/customers.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PlatformModule } from './platform/platform.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { InventoryModule } from './inventory/inventory.module';
import { InvoicesModule } from './invoices/invoices.module';
import { OrdersModule } from './orders/orders.module';
import { OrganizationModule } from './organization/organization.module';
import { StorageModule } from './storage/storage.module';
import { StoresModule } from './stores/stores.module';
import { TeamModule } from './team/team.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    PrismaModule,
    RedisModule,
    CommonModule,
    AuditModule,
    StorageModule,
    AuthModule,
    ButtonsModule,
    StoresModule,
    TeamModule,
    InventoryModule,
    InvoicesModule,
    OrdersModule,
    AppointmentsModule,
    CustomerModule,
    CustomersModule,
    OrganizationModule,
    DashboardModule,
    NotificationsModule,
    PlatformModule,
    BillingModule,
    LedgerModule,
    PosModule,
    WorkshopModule,
    ZatcaModule,
    HealthModule,
  ],
})
export class AppModule {}
