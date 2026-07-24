import { createHmac, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

interface WaStatusUpdate {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp?: string;
  errors?: { title?: string }[];
}

/**
 * Meta webhook receiver (TRD §8.1): GET for subscription verification,
 * POST for delivery/read receipts. Signature verified via x-hub-signature-256.
 */
@Public()
@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    if (
      mode === 'subscribe' &&
      token === this.config.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN')
    ) {
      return challenge;
    }
    throw new ForbiddenException('Verification failed');
  }

  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() body: unknown,
  ) {
    this.verifySignature(req.rawBody, signature);

    const payload = body as {
      entry?: { changes?: { value?: { statuses?: WaStatusUpdate[] } }[] }[];
    };
    const statuses =
      payload.entry?.flatMap((e) =>
        e.changes?.flatMap((c) => c.value?.statuses ?? []) ?? [],
      ) ?? [];

    for (const status of statuses) {
      const data: Record<string, unknown> = { status: status.status };
      if (status.status === 'delivered') data.deliveredAt = new Date();
      if (status.status === 'read') data.readAt = new Date();
      if (status.status === 'failed') {
        data.errorMessage = status.errors?.[0]?.title ?? 'delivery failed';
      }
      await this.prisma.whatsappMessage.updateMany({
        where: { waMessageId: status.id },
        data,
      });
    }
    return { received: statuses.length };
  }

  private verifySignature(rawBody: Buffer | undefined, signature: string | undefined) {
    const secret = this.config.get<string>('WHATSAPP_APP_SECRET');
    if (!secret) return; // dev mode without an app secret
    if (!rawBody || !signature?.startsWith('sha256=')) {
      throw new BadRequestException('Missing webhook signature');
    }
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const provided = signature.slice(7);
    if (
      expected.length !== provided.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
    ) {
      throw new ForbiddenException('Invalid webhook signature');
    }
  }
}
