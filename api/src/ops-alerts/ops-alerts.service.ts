import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { escapeHtml } from '../common/html.util';

const COOLDOWN_MS = 5 * 60_000;

// Plain-language label + a one-line explanation of what being alerted from
// this source actually means - added after the user pointed out the raw
// "erro em produção (web)" subject didn't say what kind of problem this
// even was. Falls back to the raw source string for anything not listed
// here (better an unfamiliar label than a silently dropped alert).
const SOURCE_INFO: Record<string, { label: string; explanation: string }> = {
  api: {
    label: 'API (erro de servidor)',
    explanation:
      'Uma requisição ao servidor da API falhou de um jeito inesperado (erro HTTP 500 ou pior) - ' +
      'não é um erro de validação normal (senha errada, campo faltando), é algo que o código não previu.',
  },
  web: {
    label: 'Painel (site)',
    explanation:
      'Uma página do painel do OmniPrint travou ao renderizar para um usuário - a pessoa provavelmente viu uma ' +
      'tela de erro genérica em vez do conteúdo esperado.',
  },
  'db-backup': {
    label: 'Backup diário do banco de dados',
    explanation:
      'O backup noturno do banco de produção (Postgres para o Cloudflare R2) não foi concluído com sucesso - ' +
      'a rotina normal é ficar em silêncio quando funciona; este e-mail só chega quando ela falha.',
  },
};

function sourceInfo(source: string): { label: string; explanation: string } {
  return SOURCE_INFO[source] ?? { label: source, explanation: 'Origem não catalogada - ver detalhes técnicos abaixo.' };
}

function formatNow(): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date());
}

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

  // source is a free label, not a fixed union - SOURCE_INFO above is the
  // list of ones with a real explanation on file; anything else still
  // sends (with a generic explanation) rather than being silently dropped,
  // since a new/unlisted source is exactly the kind of alert worth seeing.
  async notify(source: string, message: string, detail?: string): Promise<void> {
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

    const { label, explanation } = sourceInfo(source);
    const subject = `OmniPrint: problema em produção - ${label}`;
    const bodyText = [
      `Origem: ${label}`,
      `Quando: ${formatNow()} (horário de São Paulo)`,
      '',
      explanation,
      '',
      `O que foi reportado:`,
      message,
      ...(detail ? ['', 'Detalhes técnicos (stack trace):', detail] : []),
    ].join('\n');
    const bodyHtml = `
      <p><strong>Origem:</strong> ${escapeHtml(label)}</p>
      <p><strong>Quando:</strong> ${escapeHtml(formatNow())} (horário de São Paulo)</p>
      <p>${escapeHtml(explanation)}</p>
      <p><strong>O que foi reportado:</strong></p>
      <pre style="white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:13px;">${escapeHtml(message)}</pre>
      ${
        detail
          ? `<p><strong>Detalhes técnicos (stack trace):</strong></p>
      <pre style="white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:12px;color:#666;">${escapeHtml(detail)}</pre>`
          : ''
      }
    `;
    // Best-effort - an alerting mechanism failing must never itself throw
    // or otherwise interfere with the request that triggered it.
    await this.emailService
      .send({ to, subject, text: bodyText, html: bodyHtml })
      .catch((err) => this.logger.error('failed to send ops alert email', err as Error));
  }
}
