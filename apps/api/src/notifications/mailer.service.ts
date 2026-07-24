import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * SMTP mailer (TRD §8.3 — SES/SendGrid in production).
 * Without SMTP_HOST configured, messages are logged instead of sent so local
 * development and CI never attempt real delivery.
 */
@Injectable()
export class MailerService implements OnModuleInit {
  private readonly logger = new Logger(MailerService.name);
  private transporter?: Transporter;
  private from = 'Tailonix <no-reply@tailonix.com>';

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const host = this.config.get<string>('SMTP_HOST');
    this.from = this.config.get<string>('MAIL_FROM', this.from);
    if (!host) {
      this.logger.warn('SMTP_HOST not set — emails will be logged, not sent');
      return;
    }
    this.transporter = nodemailer.createTransport({
      host,
      port: Number(this.config.get('SMTP_PORT', 587)),
      secure: this.config.get('SMTP_SECURE') === 'true',
      auth: this.config.get<string>('SMTP_USER')
        ? {
            user: this.config.getOrThrow<string>('SMTP_USER'),
            pass: this.config.getOrThrow<string>('SMTP_PASSWORD'),
          }
        : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[DEV EMAIL] to=${message.to} subject="${message.subject}"`);
      return;
    }
    try {
      await this.transporter.sendMail({ from: this.from, ...message });
    } catch (err) {
      this.logger.error(`Email to ${message.to} failed: ${(err as Error).message}`);
      throw err;
    }
  }
}
