import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import * as aws from '@aws-sdk/client-ses';

/**
 * Email sender — Nodemailer over AWS SES. If SES isn't configured (no
 * region/from/credentials — the usual dev case) it logs and no-ops, so the app
 * and tests run without AWS credentials. When configured it sends via SES.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const region = this.config.get<string>('AWS_REGION');
    this.from = this.config.get<string>('SES_FROM_EMAIL', '');
    const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('AWS_SECRET_ACCESS_KEY');

    if (region && this.from && accessKeyId && secretAccessKey) {
      const ses = new aws.SES({ region, credentials: { accessKeyId, secretAccessKey } });
      // The SES transport option isn't in @types/nodemailer's TransportOptions.
      this.transporter = nodemailer.createTransport({
        SES: { ses, aws },
      } as unknown as nodemailer.TransportOptions);
    } else {
      this.transporter = null;
    }
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[email suppressed — SES not configured] to=${to} subject="${subject}"`);
      return;
    }
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, text: body });
    } catch (err) {
      // Email is best-effort; never let a delivery failure break the workflow.
      this.logger.error(`Failed to send email to ${to}: ${(err as Error).message}`);
    }
  }
}
