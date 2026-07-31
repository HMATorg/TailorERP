import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrderEventsPublisher } from './order-events.publisher';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [InventoryModule, NotificationsModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderEventsPublisher],
  exports: [OrdersService, OrderEventsPublisher],
})
export class OrdersModule {}
