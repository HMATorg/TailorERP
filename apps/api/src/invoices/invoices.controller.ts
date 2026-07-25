import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentStoreId, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../auth/auth.types';
import { InvoicesService } from './invoices.service';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermissions('view_orders')
  list(@CurrentStoreId() storeId: string) {
    return this.invoices.listForStore(storeId);
  }

  /** Creates the invoice for an order (idempotent). */
  @Post('orders/:orderId')
  @RequirePermissions('process_payments')
  create(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.invoices.createForOrder(orderId, principal.sub);
  }

  @Get(':id/download')
  @RequirePermissions('view_orders')
  @Header('Content-Type', 'application/pdf')
  async download(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, filename } = await this.invoices.renderPdf(principal.orgId!, id);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return new StreamableFile(buffer);
  }

  /** Short-lived S3 link, for sharing rather than downloading inline. */
  @Get(':id/link')
  @RequirePermissions('view_orders')
  async link(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { url: await this.invoices.getDownloadUrl(principal.orgId!, id) };
  }
}
