import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret } from './crypto.util';

interface SendTemplateParams {
  organizationId: string;
  storeId: string;
  customerId: string;
  orderId?: string;
  toPhone: string;
  templateName: string;
  language: string;
  bodyVariables: string[];
  messageType: string;
}

/**
 * WhatsApp Business Cloud API client (TRD §8.1). Each store has its own
 * phone number ID + encrypted access token. In development (or when a store
 * has no credentials) the send is simulated and logged as 'sent'.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async sendTemplate(params: SendTemplateParams): Promise<void> {
    const record = await this.prisma.whatsappMessage.create({
      data: {
        organizationId: params.organizationId,
        storeId: params.storeId,
        customerId: params.customerId,
        orderId: params.orderId,
        messageType: params.messageType,
        payload: {
          template: params.templateName,
          language: params.language,
          variables: params.bodyVariables,
          to: params.toPhone,
        },
      },
    });

    const store = await this.prisma.store.findUnique({
      where: { id: params.storeId },
      select: { whatsappPhoneNumberId: true, whatsappAccessTokenEncrypted: true },
    });

    if (!store?.whatsappPhoneNumberId || !store.whatsappAccessTokenEncrypted) {
      this.logger.warn(
        `Store ${params.storeId} has no WhatsApp credentials — simulating send of '${params.templateName}' to ${params.toPhone}`,
      );
      await this.prisma.whatsappMessage.update({
        where: { id: record.id },
        data: { status: 'sent', sentAt: new Date(), waMessageId: `simulated-${record.id}` },
      });
      return;
    }

    try {
      const token = decryptSecret(
        store.whatsappAccessTokenEncrypted,
        this.config.getOrThrow<string>('TOKEN_ENCRYPTION_KEY'),
      );
      const base = this.config.get('WHATSAPP_API_BASE', 'https://graph.facebook.com/v18.0');
      const response = await fetch(`${base}/${store.whatsappPhoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: params.toPhone,
          type: 'template',
          template: {
            name: params.templateName,
            language: { code: params.language },
            components: [
              {
                type: 'body',
                parameters: params.bodyVariables.map((text) => ({ type: 'text', text })),
              },
            ],
          },
        }),
      });
      const body = (await response.json()) as {
        messages?: { id: string }[];
        error?: { message: string };
      };
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }
      await this.prisma.whatsappMessage.update({
        where: { id: record.id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          waMessageId: body.messages?.[0]?.id,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`WhatsApp send failed: ${message}`);
      await this.prisma.whatsappMessage.update({
        where: { id: record.id },
        data: { status: 'failed', errorMessage: message },
      });
      // TODO: fallback chain → web push → SMS (PRD §4.4)
      throw err;
    }
  }
}
