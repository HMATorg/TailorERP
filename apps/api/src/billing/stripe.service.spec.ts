import 'reflect-metadata';
import { ServiceUnavailableException } from '@nestjs/common';
import type Stripe from 'stripe';
import { StripeService } from './stripe.service';

/** Builds a Stripe.Subscription shaped like API 2026-06-24 (period on items). */
function subscriptionFixture(overrides: {
  status?: Stripe.Subscription.Status;
  /** null clears the metadata key; omitting it keeps the default */
  organizationId?: string | null;
  planId?: string | null;
  priceId?: string;
  cancelAtPeriodEnd?: boolean;
  withPeriod?: boolean;
}): Stripe.Subscription {
  const {
    status = 'active',
    priceId = 'price_monthly_pro',
    cancelAtPeriodEnd = false,
    withPeriod = true,
  } = overrides;
  // Destructuring defaults would resurrect an explicit `undefined`, so these
  // two are resolved by checking whether the key was supplied at all.
  const organizationId =
    'organizationId' in overrides ? overrides.organizationId : 'org-1';
  const planId = 'planId' in overrides ? overrides.planId : 'plan-1';

  return {
    id: 'sub_123',
    status,
    cancel_at_period_end: cancelAtPeriodEnd,
    trial_end: null,
    metadata: {
      ...(organizationId ? { organizationId } : {}),
      ...(planId ? { planId } : {}),
    },
    items: {
      data: [
        {
          price: { id: priceId },
          ...(withPeriod
            ? { current_period_start: 1_800_000_000, current_period_end: 1_802_678_400 }
            : {}),
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

describe('StripeService', () => {
  let prisma: {
    subscriptionPlan: { findFirst: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock };
    organizationSubscription: { upsert: jest.Mock; findUnique: jest.Mock };
    organization: { findUnique: jest.Mock; update: jest.Mock };
    user: { findFirst: jest.Mock };
  };
  let featureGate: { invalidate: jest.Mock };
  let audit: { log: jest.Mock };
  let service: StripeService;

  beforeEach(() => {
    prisma = {
      subscriptionPlan: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
      organizationSubscription: { upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn() },
      organization: { findUnique: jest.fn(), update: jest.fn() },
      user: { findFirst: jest.fn() },
    };
    featureGate = { invalidate: jest.fn().mockResolvedValue(undefined) };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new StripeService(
      prisma as never,
      { get: jest.fn(), getOrThrow: jest.fn() } as never,
      featureGate as never,
      audit as never,
    );
  });

  /** handleEvent is public; syncSubscription is reached through it. */
  const send = (subscription: Stripe.Subscription, type = 'customer.subscription.updated') =>
    service.handleEvent({ type, data: { object: subscription } } as unknown as Stripe.Event);

  it('refuses to operate when Stripe is not configured', async () => {
    // The org exists, so we get past the lookup and hit the missing client
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      name: 'Org',
      stripeCustomerId: null,
    });
    prisma.user.findFirst.mockResolvedValue({ email: 'hq@example.test' });

    // onModuleInit never ran, so no Stripe client exists
    await expect(service.createPortalSession('org-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(service.isEnabled()).toBe(false);
  });

  it('upserts the subscription and invalidates the feature cache', async () => {
    await send(subscriptionFixture({}));

    expect(prisma.organizationSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1' } }),
    );
    const { update } = prisma.organizationSubscription.upsert.mock.calls[0][0];
    expect(update.status).toBe('active');
    expect(update.stripeSubscriptionId).toBe('sub_123');
    expect(update.currentPeriodStart).toEqual(new Date(1_800_000_000 * 1000));
    expect(update.currentPeriodEnd).toEqual(new Date(1_802_678_400 * 1000));
    expect(featureGate.invalidate).toHaveBeenCalledWith('org-1');
  });

  describe('status mapping', () => {
    const cases: [Stripe.Subscription.Status, string][] = [
      ['trialing', 'trialing'],
      ['active', 'active'],
      ['past_due', 'past_due'],
      ['unpaid', 'past_due'],
      ['canceled', 'cancelled'],
      ['incomplete_expired', 'cancelled'],
      ['incomplete', 'suspended'],
      ['paused', 'suspended'],
    ];

    it.each(cases)('maps Stripe "%s" to "%s"', async (stripeStatus, expected) => {
      await send(subscriptionFixture({ status: stripeStatus }));
      expect(prisma.organizationSubscription.upsert.mock.calls[0][0].update.status).toBe(expected);
    });
  });

  it('ignores a subscription with no organizationId metadata', async () => {
    await send(subscriptionFixture({ organizationId: null }));
    expect(prisma.organizationSubscription.upsert).not.toHaveBeenCalled();
    expect(featureGate.invalidate).not.toHaveBeenCalled();
  });

  it('falls back to matching the plan by price id when planId metadata is absent', async () => {
    prisma.subscriptionPlan.findFirst.mockResolvedValue({ id: 'plan-from-price' });

    await send(subscriptionFixture({ planId: null, priceId: 'price_yearly_ent' }));

    expect(prisma.subscriptionPlan.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { stripeMonthlyPriceId: 'price_yearly_ent' },
          { stripeYearlyPriceId: 'price_yearly_ent' },
        ],
      },
    });
    expect(prisma.organizationSubscription.upsert.mock.calls[0][0].update.planId).toBe(
      'plan-from-price',
    );
  });

  it('skips the write when no plan can be resolved', async () => {
    prisma.subscriptionPlan.findFirst.mockResolvedValue(null);
    await send(subscriptionFixture({ planId: null }));
    expect(prisma.organizationSubscription.upsert).not.toHaveBeenCalled();
  });

  it('skips the write when the subscription carries no billing period', async () => {
    await send(subscriptionFixture({ withPeriod: false }));
    expect(prisma.organizationSubscription.upsert).not.toHaveBeenCalled();
  });

  it('carries cancel_at_period_end through', async () => {
    await send(subscriptionFixture({ cancelAtPeriodEnd: true }));
    expect(prisma.organizationSubscription.upsert.mock.calls[0][0].update.cancelAtPeriodEnd).toBe(
      true,
    );
  });

  it('acknowledges but does not act on unrelated events', async () => {
    const result = await service.handleEvent({
      type: 'payment_intent.succeeded',
      data: { object: {} },
    } as unknown as Stripe.Event);

    expect(result.handled).toBe(false);
    expect(prisma.organizationSubscription.upsert).not.toHaveBeenCalled();
  });

  it('records an audit entry for every sync', async () => {
    await send(subscriptionFixture({}));
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        action: 'billing.subscription_synced',
        actorType: 'system',
      }),
    );
  });

  describe('listInvoices (PA-6)', () => {
    it('returns an empty list without calling Stripe when the org has no customer yet', async () => {
      prisma.organization.findUnique.mockResolvedValue({ stripeCustomerId: null });
      const result = await service.listInvoices('org-1');
      expect(result).toEqual([]);
    });

    it('maps the Stripe invoice list shape into the response the platform-admin UI reads', async () => {
      prisma.organization.findUnique.mockResolvedValue({ stripeCustomerId: 'cus_123' });
      const list = jest.fn().mockResolvedValue({
        data: [
          {
            id: 'in_1',
            number: 'INV-0001',
            status: 'paid',
            amount_due: 0,
            amount_paid: 49900,
            currency: 'sar',
            created: 1_800_000_000,
            hosted_invoice_url: 'https://stripe.example/inv_1',
            invoice_pdf: 'https://stripe.example/inv_1.pdf',
          },
        ],
      });
      // Real Stripe client only exists after onModuleInit finds a secret key,
      // which these unit tests never run — inject a fake client directly
      // rather than exercising module bootstrap for one method.
      (service as unknown as { stripe: { invoices: { list: typeof list } } }).stripe = {
        invoices: { list },
      };

      const result = await service.listInvoices('org-1', 5);

      expect(list).toHaveBeenCalledWith({ customer: 'cus_123', limit: 5 });
      expect(result).toEqual([
        {
          id: 'in_1',
          number: 'INV-0001',
          status: 'paid',
          amountDue: 0,
          amountPaid: 49900,
          currency: 'sar',
          created: new Date(1_800_000_000 * 1000),
          hostedInvoiceUrl: 'https://stripe.example/inv_1',
          invoicePdf: 'https://stripe.example/inv_1.pdf',
        },
      ]);
    });
  });

  describe('getOwnSubscription / listPublicPlans (D-062 tenant self-serve)', () => {
    it('reads the subscription scoped to exactly the given org, with its plan', async () => {
      const sub = { organizationId: 'org-1', status: 'active', plan: { code: 'pro' } };
      prisma.organizationSubscription.findUnique.mockResolvedValue(sub);

      const result = await service.getOwnSubscription('org-1');

      expect(prisma.organizationSubscription.findUnique).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
        include: { plan: true },
      });
      expect(result).toBe(sub);
    });

    it('returns null when the org has no subscription row yet', async () => {
      prisma.organizationSubscription.findUnique.mockResolvedValue(null);
      expect(await service.getOwnSubscription('org-1')).toBeNull();
    });

    it('lists only public plans — a tenant must never self-serve into a custom/enterprise-only plan', async () => {
      prisma.subscriptionPlan.findMany.mockResolvedValue([{ code: 'basic' }, { code: 'pro' }]);

      const result = await service.listPublicPlans();

      expect(prisma.subscriptionPlan.findMany).toHaveBeenCalledWith({
        where: { isPublic: true },
        orderBy: { maxStores: 'asc' },
      });
      expect(result).toEqual([{ code: 'basic' }, { code: 'pro' }]);
    });
  });

  describe('createCheckoutSession / createPortalSession — caller-supplied redirects (D-062)', () => {
    beforeEach(() => {
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Org',
        stripeCustomerId: 'cus_123',
      });
      (service as unknown as { config: { get: jest.Mock } }).config = {
        get: jest.fn().mockReturnValue('http://localhost:5175'),
      };
    });

    it('defaults to the platform-admin tenant page and actorType platform_admin when not overridden', async () => {
      prisma.subscriptionPlan.findUnique.mockResolvedValue({
        code: 'pro',
        stripeMonthlyPriceId: 'price_1',
      });
      const create = jest.fn().mockResolvedValue({ id: 'cs_1', url: 'https://stripe.example/checkout' });
      (service as unknown as { stripe: { checkout: { sessions: { create: typeof create } } } }).stripe = {
        checkout: { sessions: { create } },
      };

      await service.createCheckoutSession({
        organizationId: 'org-1',
        planCode: 'pro',
        interval: 'monthly',
        actorId: 'actor-1',
      });

      const args = create.mock.calls[0][0];
      expect(args.success_url).toContain('/tenants/org-1?checkout=success');
      expect(args.cancel_url).toContain('/tenants/org-1?checkout=cancelled');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ actorType: 'platform_admin' }));
    });

    it('uses the caller-supplied URLs and actorType when a tenant self-serves', async () => {
      prisma.subscriptionPlan.findUnique.mockResolvedValue({
        code: 'pro',
        stripeMonthlyPriceId: 'price_1',
      });
      const create = jest.fn().mockResolvedValue({ id: 'cs_1', url: 'https://stripe.example/checkout' });
      (service as unknown as { stripe: { checkout: { sessions: { create: typeof create } } } }).stripe = {
        checkout: { sessions: { create } },
      };

      await service.createCheckoutSession({
        organizationId: 'org-1',
        planCode: 'pro',
        interval: 'monthly',
        actorId: 'actor-1',
        actorType: 'staff',
        successUrl: 'https://admin.example/billing?checkout=success',
        cancelUrl: 'https://admin.example/billing?checkout=cancelled',
      });

      const args = create.mock.calls[0][0];
      expect(args.success_url).toBe('https://admin.example/billing?checkout=success');
      expect(args.cancel_url).toBe('https://admin.example/billing?checkout=cancelled');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ actorType: 'staff' }));
    });

    it('portal defaults to the platform-admin tenant page when no returnUrl is given', async () => {
      const create = jest.fn().mockResolvedValue({ url: 'https://stripe.example/portal' });
      (service as unknown as { stripe: { billingPortal: { sessions: { create: typeof create } } } }).stripe = {
        billingPortal: { sessions: { create } },
      };

      await service.createPortalSession('org-1');

      expect(create.mock.calls[0][0].return_url).toContain('/tenants/org-1');
    });

    it('portal uses the caller-supplied returnUrl when given', async () => {
      const create = jest.fn().mockResolvedValue({ url: 'https://stripe.example/portal' });
      (service as unknown as { stripe: { billingPortal: { sessions: { create: typeof create } } } }).stripe = {
        billingPortal: { sessions: { create } },
      };

      await service.createPortalSession('org-1', 'https://admin.example/billing');

      expect(create.mock.calls[0][0].return_url).toBe('https://admin.example/billing');
    });
  });
});
