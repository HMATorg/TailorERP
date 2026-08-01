import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { AuditService } from '../audit/audit.service';
import { FeatureGateService } from '../platform/feature-gate.service';
import { PrismaService } from '../prisma/prisma.service';

/** Stripe subscription lifecycle → organization_subscriptions (TRD §8.2). */
@Injectable()
export class StripeService implements OnModuleInit {
  private readonly logger = new Logger(StripeService.name);
  private stripe?: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly featureGate: FeatureGateService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!key) {
      this.logger.warn('STRIPE_SECRET_KEY not set — billing endpoints will return 503');
      return;
    }
    // Pin nothing: the SDK's default pinned version matches its typings.
    this.stripe = new Stripe(key);
  }

  isEnabled(): boolean {
    return this.stripe !== undefined;
  }

  private client(): Stripe {
    if (!this.stripe) {
      throw new ServiceUnavailableException('Billing is not configured on this environment');
    }
    return this.stripe;
  }

  /** Reuses the tenant's Stripe Customer, creating one on first use. */
  private async ensureCustomer(organizationId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, stripeCustomerId: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    if (org.stripeCustomerId) return org.stripeCustomerId;

    // Find the HQ admin so invoices reach a real person
    const hqAdmin = await this.prisma.user.findFirst({
      where: { organizationId, orgRole: 'hq_admin', isActive: true },
      select: { email: true, fullName: true },
      orderBy: { createdAt: 'asc' },
    });

    const customer = await this.client().customers.create({
      name: org.name,
      email: hqAdmin?.email,
      metadata: { organizationId: org.id },
    });
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { stripeCustomerId: customer.id },
    });
    return customer.id;
  }

  /**
   * Hosted Checkout session for a plan (PA-6). `successUrl`/`cancelUrl`/`actorType`
   * default to the platform-admin-mediated flow (redirects into apps/platform-admin,
   * audited as `platform_admin`); a tenant self-serve caller passes its own return
   * URLs (back into apps/admin) and `actorType: 'staff'` instead.
   */
  async createCheckoutSession(params: {
    organizationId: string;
    planCode: string;
    interval: 'monthly' | 'yearly';
    actorId: string;
    actorType?: 'staff' | 'platform_admin';
    successUrl?: string;
    cancelUrl?: string;
  }) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { code: params.planCode },
    });
    if (!plan) throw new BadRequestException(`Unknown plan code '${params.planCode}'`);

    const priceId =
      params.interval === 'yearly' ? plan.stripeYearlyPriceId : plan.stripeMonthlyPriceId;
    if (!priceId) {
      throw new BadRequestException(
        `Plan '${plan.code}' has no Stripe ${params.interval} price configured`,
      );
    }

    const customerId = await this.ensureCustomer(params.organizationId);
    const baseUrl = this.config.get<string>('PLATFORM_APP_URL', 'http://localhost:5175');

    const session = await this.client().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: params.successUrl ?? `${baseUrl}/tenants/${params.organizationId}?checkout=success`,
      cancel_url: params.cancelUrl ?? `${baseUrl}/tenants/${params.organizationId}?checkout=cancelled`,
      // Echoed back on the webhook so we can map the subscription to a tenant
      subscription_data: {
        metadata: { organizationId: params.organizationId, planId: plan.id },
      },
      metadata: { organizationId: params.organizationId, planId: plan.id },
    });

    await this.audit.log({
      organizationId: params.organizationId,
      actorUserId: params.actorId,
      actorType: params.actorType ?? 'platform_admin',
      action: 'billing.checkout_created',
      entityType: 'organization',
      entityId: params.organizationId,
      newValue: { plan: plan.code, interval: params.interval },
    });
    return { url: session.url, sessionId: session.id };
  }

  /**
   * Stripe-hosted billing portal for self-service plan changes (TRD §8.2).
   * `returnUrl` defaults to the platform-admin tenant-detail page; a tenant
   * self-serve caller passes its own admin-app URL instead.
   */
  async createPortalSession(organizationId: string, returnUrl?: string) {
    const customerId = await this.ensureCustomer(organizationId);
    const baseUrl = this.config.get<string>('PLATFORM_APP_URL', 'http://localhost:5175');
    const session = await this.client().billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl ?? `${baseUrl}/tenants/${organizationId}`,
    });
    return { url: session.url };
  }

  /**
   * Recent invoices for the tenant's Stripe customer (PA-6). An org that has
   * never gone through checkout/portal has no `stripeCustomerId` yet — that's
   * not an error, it genuinely has no invoices, so this returns an empty list
   * rather than 404ing (mirrors `ensureCustomer`'s "create on first use"
   * philosophy: no customer yet is a normal state, not a fault).
   */
  async listInvoices(organizationId: string, limit = 10) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { stripeCustomerId: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    if (!org.stripeCustomerId) return [];

    const invoices = await this.client().invoices.list({
      customer: org.stripeCustomerId,
      limit: Math.min(100, Math.max(1, limit)),
    });
    return invoices.data.map((inv) => ({
      id: inv.id,
      number: inv.number,
      status: inv.status,
      amountDue: inv.amount_due,
      amountPaid: inv.amount_paid,
      currency: inv.currency,
      created: new Date(inv.created * 1000),
      hostedInvoiceUrl: inv.hosted_invoice_url,
      invoicePdf: inv.invoice_pdf,
    }));
  }

  /** The calling org's own subscription, for tenant self-serve billing. */
  async getOwnSubscription(organizationId: string) {
    return this.prisma.organizationSubscription.findUnique({
      where: { organizationId },
      include: { plan: true },
    });
  }

  /** Plans a tenant is allowed to self-serve into — excludes custom/enterprise-only plans. */
  listPublicPlans() {
    return this.prisma.subscriptionPlan.findMany({
      where: { isPublic: true },
      orderBy: { maxStores: 'asc' },
    });
  }

  verifyWebhook(rawBody: Buffer, signature: string): Stripe.Event {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) {
      throw new ServiceUnavailableException('STRIPE_WEBHOOK_SECRET not configured');
    }
    return this.client().webhooks.constructEvent(rawBody, signature, secret);
  }

  /**
   * Applies a Stripe event to our records. Only subscription-shaped events are
   * handled; anything else is acknowledged and ignored so Stripe stops retrying.
   */
  async handleEvent(event: Stripe.Event): Promise<{ handled: boolean }> {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.syncSubscription(event.data.object as Stripe.Subscription);
        return { handled: true };

      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        // Since API 2025-xx the link lives under parent.subscription_details
        const linked = invoice.parent?.subscription_details?.subscription;
        const subscriptionId = typeof linked === 'string' ? linked : linked?.id;
        if (subscriptionId) {
          const subscription = await this.client().subscriptions.retrieve(subscriptionId);
          await this.syncSubscription(subscription);
        }
        return { handled: true };
      }

      default:
        this.logger.debug(`Ignoring unhandled Stripe event ${event.type}`);
        return { handled: false };
    }
  }

  /** Maps Stripe's status vocabulary onto ours. */
  private mapStatus(status: Stripe.Subscription.Status) {
    switch (status) {
      case 'trialing':
        return 'trialing' as const;
      case 'active':
        return 'active' as const;
      case 'past_due':
      case 'unpaid':
        return 'past_due' as const;
      case 'canceled':
      case 'incomplete_expired':
        return 'cancelled' as const;
      default:
        return 'suspended' as const;
    }
  }

  private async syncSubscription(subscription: Stripe.Subscription): Promise<void> {
    const organizationId = subscription.metadata?.organizationId;
    if (!organizationId) {
      this.logger.warn(
        `Stripe subscription ${subscription.id} has no organizationId metadata — skipping`,
      );
      return;
    }

    // Prefer the plan recorded at checkout; fall back to matching the price
    let planId: string | undefined = subscription.metadata?.planId;
    if (!planId) {
      const priceId = subscription.items.data[0]?.price.id;
      const plan = priceId
        ? await this.prisma.subscriptionPlan.findFirst({
            where: {
              OR: [{ stripeMonthlyPriceId: priceId }, { stripeYearlyPriceId: priceId }],
            },
          })
        : null;
      planId = plan?.id;
    }
    if (!planId) {
      this.logger.warn(`Cannot resolve a plan for subscription ${subscription.id}`);
      return;
    }

    // The billing period moved onto subscription items in recent API versions;
    // a single-price subscription carries it on its only item.
    const item = subscription.items.data[0];
    const periodStart = item?.current_period_start;
    const periodEnd = item?.current_period_end;
    if (!periodStart || !periodEnd) {
      this.logger.warn(`Subscription ${subscription.id} has no billing period — skipping`);
      return;
    }

    const status = this.mapStatus(subscription.status);
    const data = {
      planId,
      status,
      stripeSubscriptionId: subscription.id,
      currentPeriodStart: new Date(periodStart * 1000),
      currentPeriodEnd: new Date(periodEnd * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      ...(subscription.trial_end ? { trialEndsAt: new Date(subscription.trial_end * 1000) } : {}),
    };

    await this.prisma.organizationSubscription.upsert({
      where: { organizationId },
      update: data,
      create: { organizationId, ...data },
    });

    // Entitlements changed — drop the cached feature set immediately
    await this.featureGate.invalidate(organizationId);

    await this.audit.log({
      organizationId,
      actorType: 'system',
      action: 'billing.subscription_synced',
      entityType: 'organization_subscription',
      entityId: subscription.id,
      newValue: { status, stripeStatus: subscription.status, planId },
    });
    this.logger.log(`Synced subscription ${subscription.id} for org ${organizationId} → ${status}`);
  }
}
