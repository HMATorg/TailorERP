import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { BillingController, StripeWebhookController, TenantBillingController } from './billing.controller';
import type { AccessTokenPayload } from '../auth/auth.types';

/**
 * BillingController + StripeWebhookController (D-060/PA-6) — thin
 * delegation to StripeService, already covered end-to-end in
 * `stripe.service.spec.ts`. Worth locking in here: the webhook route's
 * "no rawBody or no signature ⇒ 400 before touching Stripe" guard, since
 * that's the actual authentication boundary for an unauthenticated route.
 */
function buildBillingController() {
  const stripe = {
    createCheckoutSession: jest.fn(),
    createPortalSession: jest.fn(),
    listInvoices: jest.fn(),
    verifyWebhook: jest.fn(),
    handleEvent: jest.fn(),
  };
  const controller = new BillingController(stripe as never);
  const principal = { sub: 'actor-1', typ: 'platform' } as AccessTokenPayload;
  return { controller, stripe, principal };
}

describe('BillingController', () => {
  it('checkout forwards org id, plan code, interval, and actor id', () => {
    const { controller, stripe, principal } = build();
    controller.checkout(principal, 'org-1', { planCode: 'pro', interval: 'monthly' });
    expect(stripe.createCheckoutSession).toHaveBeenCalledWith({
      organizationId: 'org-1',
      planCode: 'pro',
      interval: 'monthly',
      actorId: 'actor-1',
    });
  });

  it('portal forwards the org id', () => {
    const { controller, stripe } = build();
    controller.portal('org-1');
    expect(stripe.createPortalSession).toHaveBeenCalledWith('org-1');
  });

  it('invoices forwards the org id and coerces the limit query string to a number', () => {
    const { controller, stripe } = build();
    controller.invoices('org-1', '25');
    expect(stripe.listInvoices).toHaveBeenCalledWith('org-1', 25);
  });

  it('invoices leaves limit undefined so the service default applies', () => {
    const { controller, stripe } = build();
    controller.invoices('org-1', undefined);
    expect(stripe.listInvoices).toHaveBeenCalledWith('org-1', undefined);
  });

  function build() {
    return buildBillingController();
  }
});

/**
 * TenantBillingController (D-062) — the tenant self-serve counterpart to
 * BillingController above: same Stripe flows, scoped to the caller's own
 * org (principal.orgId) instead of a route param + PlatformAdminGuard.
 * Worth locking in specifically: it always operates on the CALLER's org,
 * never a param an attacker could swap for another tenant's, and it passes
 * its own admin-app return URLs plus actorType 'staff' rather than the
 * platform-admin defaults.
 */
describe('TenantBillingController', () => {
  function build() {
    const stripe = {
      createCheckoutSession: jest.fn(),
      createPortalSession: jest.fn(),
      listInvoices: jest.fn(),
      listPublicPlans: jest.fn(),
      getOwnSubscription: jest.fn(),
    };
    const config = { get: jest.fn().mockReturnValue('https://admin.example') };
    const controller = new TenantBillingController(stripe as never, config as never);
    const principal = { sub: 'user-1', typ: 'staff', orgId: 'org-caller' } as AccessTokenPayload;
    return { controller, stripe, principal };
  }

  it('plans delegates with no args', () => {
    const { controller, stripe } = build();
    controller.plans();
    expect(stripe.listPublicPlans).toHaveBeenCalledWith();
  });

  it('subscription reads the caller\'s own org, never a param', () => {
    const { controller, stripe, principal } = build();
    controller.subscription(principal);
    expect(stripe.getOwnSubscription).toHaveBeenCalledWith('org-caller');
  });

  it('checkout scopes to the caller\'s org, tags actorType staff, and points back at the admin app', () => {
    const { controller, stripe, principal } = build();
    controller.checkout(principal, { planCode: 'pro', interval: 'monthly' });
    expect(stripe.createCheckoutSession).toHaveBeenCalledWith({
      organizationId: 'org-caller',
      planCode: 'pro',
      interval: 'monthly',
      actorId: 'user-1',
      actorType: 'staff',
      successUrl: 'https://admin.example/billing?checkout=success',
      cancelUrl: 'https://admin.example/billing?checkout=cancelled',
    });
  });

  it('portal scopes to the caller\'s org and returns to the admin app, not the platform-admin default', () => {
    const { controller, stripe, principal } = build();
    controller.portal(principal);
    expect(stripe.createPortalSession).toHaveBeenCalledWith('org-caller', 'https://admin.example/billing');
  });

  it('invoices scopes to the caller\'s org and coerces the limit query string', () => {
    const { controller, stripe, principal } = build();
    controller.invoices(principal, '5');
    expect(stripe.listInvoices).toHaveBeenCalledWith('org-caller', 5);
  });
});

describe('StripeWebhookController', () => {
  function build() {
    const stripe = { verifyWebhook: jest.fn(), handleEvent: jest.fn() };
    const controller = new StripeWebhookController(stripe as never);
    return { controller, stripe };
  }

  it('rejects with 400 before touching Stripe when the raw body is missing', async () => {
    const { controller, stripe } = build();
    const req = { rawBody: undefined } as never;
    await expect(controller.receive(req, 'sig')).rejects.toBeInstanceOf(BadRequestException);
    expect(stripe.verifyWebhook).not.toHaveBeenCalled();
  });

  it('rejects with 400 before touching Stripe when the signature header is missing', async () => {
    const { controller, stripe } = build();
    const req = { rawBody: Buffer.from('{}') } as unknown as Request;
    await expect(controller.receive(req as never, undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(stripe.verifyWebhook).not.toHaveBeenCalled();
  });

  it('verifies then handles the event, returning received:true merged with the handler result', async () => {
    const { controller, stripe } = build();
    const rawBody = Buffer.from('{"id":"evt_1"}');
    const req = { rawBody } as unknown as Request;
    stripe.verifyWebhook.mockReturnValue({ id: 'evt_1', type: 'invoice.paid' });
    stripe.handleEvent.mockResolvedValue({ processed: true });

    const result = await controller.receive(req as never, 'valid-sig');

    expect(stripe.verifyWebhook).toHaveBeenCalledWith(rawBody, 'valid-sig');
    expect(stripe.handleEvent).toHaveBeenCalledWith({ id: 'evt_1', type: 'invoice.paid' });
    expect(result).toEqual({ received: true, processed: true });
  });
});
