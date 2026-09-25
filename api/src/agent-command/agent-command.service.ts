import { Injectable } from '@nestjs/common';
import { AgentCommandType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// A request the agent hasn't picked up within this window is treated as
// never delivered - no agent ever sees it, and the panel shows it as "não
// recebido" instead of pending forever. Generous next to the agent's
// 2-minute check so a brief network blip doesn't expire it, short enough
// that an agent that comes back online hours later doesn't suddenly
// restart itself on a request everyone already forgot about.
export const COMMAND_EXPIRY_MS = 30 * 60 * 1000;

@Injectable()
export class AgentCommandService {
  constructor(private readonly prisma: PrismaService) {}

  // Polled by the agent every 2 minutes (agent/internal/svc) - a single
  // indexed-by-id row read. requestedAt goes back to the agent verbatim so
  // its ack can be matched against exactly this request (see ack).
  async pendingFor(agentTokenId: string): Promise<{ command: AgentCommandType; requestedAt: string } | null> {
    const token = await this.prisma.agentToken.findUnique({
      where: { id: agentTokenId },
      select: { commandType: true, commandRequestedAt: true, commandAckedAt: true },
    });
    if (!token?.commandType || !token.commandRequestedAt || token.commandAckedAt) return null;
    if (Date.now() - token.commandRequestedAt.getTime() > COMMAND_EXPIRY_MS) return null;
    return { command: token.commandType, requestedAt: token.commandRequestedAt.toISOString() };
  }

  async discoveryRangesFor(customerId: string | null): Promise<string[]> {
    if (!customerId) return [];
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { discoveryRanges: true },
    });
    return customer?.discoveryRanges ?? [];
  }

  // Keyed on requestedAt, not just the token: if someone clicked a second
  // button while the agent was still working on the first, the first
  // command's late ack must not mark the newer request as done. Can be
  // called more than once for the same request (a "started" ack then the
  // final outcome) - ackedAt keeps the first time, result the latest.
  async ack(agentTokenId: string, requestedAt: string, result: string): Promise<boolean> {
    const at = new Date(requestedAt);
    if (Number.isNaN(at.getTime())) return false;
    const token = await this.prisma.agentToken.findFirst({
      where: { id: agentTokenId, commandRequestedAt: at },
      select: { commandAckedAt: true },
    });
    if (!token) return false;
    await this.prisma.agentToken.update({
      where: { id: agentTokenId },
      data: { commandAckedAt: token.commandAckedAt ?? new Date(), commandResult: result },
    });
    return true;
  }
}
