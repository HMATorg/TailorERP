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
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { IsIn, IsString } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
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
 * Tenant self-serve billing — the same Stripe flows as BillingController above,
 * scoped to the caller's own org (principal.orgId, no :id param) instead of
 * PlatformAdminGuard. Mirrors zatca.controller.ts's onboarding routes: org-wide
 * setting, hq_admin only, via the ordinary manage_organization permission.
 */
@Controller('billing')
export class TenantBillingController {
  constructor(
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
  ) {}

  private adminAppUrl(): string {
    return this.config.get<string>('ADMIN_APP_URL', 'http://localhost:5173');
  }

  @Get('plans')
  @RequirePermissions('manage_organization')
  plans() {
    return this.stripe.listPublicPlans();
  }

  @Get('subscription')
  @RequirePermissions('manage_organization')
  subscription(@CurrentUser() principal: AccessTokenPayload) {
    return this.stripe.getOwnSubscription(principal.orgId!);
  }

  @Post('checkout')
  @RequirePermissions('manage_organization')
  checkout(@CurrentUser() principal: AccessTokenPayload, @Body() dto: CheckoutDto) {
    const baseUrl = this.adminAppUrl();
    return this.stripe.createCheckoutSession({
      organizationId: principal.orgId!,
      planCode: dto.planCode,
      interval: dto.interval,
      actorId: principal.sub,
      actorType: 'staff',
      successUrl: `${baseUrl}/billing?checkout=success`,
      cancelUrl: `${baseUrl}/billing?checkout=cancelled`,
    });
  }

  @Post('portal')
  @RequirePermissions('manage_organization')
  portal(@CurrentUser() principal: AccessTokenPayload) {
    return this.stripe.createPortalSession(principal.orgId!, `${this.adminAppUrl()}/billing`);
  }

  @Get('invoices')
  @RequirePermissions('manage_organization')
  invoices(@CurrentUser() principal: AccessTokenPayload, @Query('limit') limit?: string) {
    return this.stripe.listInvoices(principal.orgId!, limit ? Number(limit) : undefined);
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
