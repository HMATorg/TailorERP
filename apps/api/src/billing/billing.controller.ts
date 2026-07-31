import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { IsIn, IsString } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import {
  PlatformAdminGuard,
  RequireAdminLevel,
} from '../auth/guards/platform-admin.guard';
import type { AccessTokenPayload } from '../auth/auth.types';
import { StripeService } from './stripe.service';

class CheckoutDto {
  @IsString()
  planCode: string;

  @IsIn(['monthly', 'yearly'])
  interval: 'monthly' | 'yearly';
}

@Controller('admin/billing')
@UseGuards(PlatformAdminGuard)
export class BillingController {
  constructor(private readonly stripe: StripeService) {}

  @Post('organizations/:id/checkout')
  @RequireAdminLevel('super_admin', 'billing')
  checkout(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CheckoutDto,
  ) {
    return this.stripe.createCheckoutSession({
      organizationId: id,
      planCode: dto.planCode,
      interval: dto.interval,
      actorId: principal.sub,
    });
  }

  @Post('organizations/:id/portal')
  @RequireAdminLevel('super_admin', 'billing')
  portal(@Param('id', ParseUUIDPipe) id: string) {
    return this.stripe.createPortalSession(id);
  }

  @Get('organizations/:id/invoices')
  @RequireAdminLevel('super_admin', 'billing')
  invoices(@Param('id', ParseUUIDPipe) id: string, @Query('limit') limit?: string) {
    return this.stripe.listInvoices(id, limit ? Number(limit) : undefined);
  }
}

/**
 * Stripe calls this unauthenticated; the signature IS the authentication.
 * Always 200 on a verified event so Stripe stops retrying, even if we ignore it.
 */
@Public()
@Controller('webhooks/stripe')
export class StripeWebhookController {
  constructor(private readonly stripe: StripeService) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    if (!req.rawBody || !signature) {
      throw new BadRequestException('Missing Stripe signature');
    }
    const event = this.stripe.verifyWebhook(req.rawBody, signature);
    const result = await this.stripe.handleEvent(event);
    return { received: true, ...result };
  }
}
