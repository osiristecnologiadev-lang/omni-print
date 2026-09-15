import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}

// Thin, provider-specific wrapper - not a generic multi-provider
// abstraction (no other provider is planned, and building one on
// spec would be exactly the kind of premature abstraction this
// project avoids elsewhere). Reused by anything that needs to send
// mail (today: the notifications digest; later: ticket activity,
// password reset - see the UX-audit punch list) rather than each
// feature calling Resend directly.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    // No key configured (local dev without one, or not set up yet) -
    // degrade to a logged no-op rather than throwing, so the rest of the
    // app (notification sync in particular, which runs on a cron
    // regardless of whether anyone's watching) keeps working.
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.from = process.env.EMAIL_FROM ?? 'OmniPrint <notificacoes@omniprint.app.br>';
  }

  async send(input: SendEmailInput): Promise<void> {
    if (!this.resend) {
      this.logger.warn(`RESEND_API_KEY not set - skipping email "${input.subject}" to ${input.to}`);
      return;
    }
    const { error } = await this.resend.emails.send({
      from: this.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    if (error) {
      // Never let a failed send take down the caller (the nightly
      // notification cron most importantly) - log and move on.
      this.logger.error(`failed to send email "${input.subject}" to ${input.to}: ${error.message}`);
    }
  }
}
