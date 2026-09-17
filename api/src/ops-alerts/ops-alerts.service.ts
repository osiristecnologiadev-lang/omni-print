import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { escapeHtml } from '../common/html.util';

const COOLDOWN_MS = 5 * 60_000;

// Deliberately simple, not per-error-signature dedup like the Notification
// model - a single "is something broken right now" cooldown across every
// source (api's own unhandled exceptions AND web's, via the webhook below)
// is enough for a first alarm; a real error storm would otherwise flood
// the inbox, which is worse than missing a few duplicate alerts.
@Injectable()
export class OpsAlertService {
  private readonly logger = new Logger(OpsAlertService.name);
  private lastSentAt = 0;

  constructor(private readonly emailService: EmailService) {}

  async notify(source: 'api' | 'web', message: string, detail?: string): Promise<void> {
    const to = process.env.OPS_ALERT_EMAIL;
    if (!to) {
      this.logger.warn(`OPS_ALERT_EMAIL not set - would have alerted (${source}): ${message}`);
      return;
    }

    const now = Date.now();
    if (now - this.lastSentAt < COOLDOWN_MS) {
      this.logger.warn(`ops alert suppressed by cooldown (${source}): ${message}`);
      return;
    }
    this.lastSentAt = now;

    const subject = `OmniPrint: erro em produção (${source})`;
    const bodyText = [message, detail].filter(Boolean).join('\n\n');
    // Best-effort - an alerting mechanism failing must never itself throw
    // or otherwise interfere with the request that triggered it.
    await this.emailService
      .send({
        to,
        subject,
        text: bodyText,
        html: `<pre style="white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:13px;">${escapeHtml(bodyText)}</pre>`,
      })
      .catch((err) => this.logger.error('failed to send ops alert email', err as Error));
  }
}
