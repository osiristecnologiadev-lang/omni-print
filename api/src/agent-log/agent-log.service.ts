import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AgentLogService {
  constructor(private readonly prisma: PrismaService) {}

  // "Pending" = a request exists and hasn't been satisfied by a newer
  // upload yet - checked on every one of the agent's own 2-minute ticks
  // (agent/internal/svc), so this stays a cheap single-row read.
  async hasPendingRequest(agentTokenId: string): Promise<boolean> {
    const token = await this.prisma.agentToken.findUnique({
      where: { id: agentTokenId },
      select: { logRequestedAt: true, logUploadedAt: true },
    });
    if (!token?.logRequestedAt) return false;
    return !token.logUploadedAt || token.logUploadedAt < token.logRequestedAt;
  }

  async recordUpload(agentTokenId: string, content: string) {
    return this.prisma.agentToken.update({
      where: { id: agentTokenId },
      data: { logContent: content, logUploadedAt: new Date() },
    });
  }
}
