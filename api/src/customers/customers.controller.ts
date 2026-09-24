import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { SubscriptionGuard } from '../subscription/subscription.guard';
import { assertPermission } from '../auth/permissions.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CreateEnrollmentCodeDto } from './dto/create-enrollment-code.dto';
import { RequestCommandDto } from './dto/request-command.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

// Customer management is tenant-wide only - a customer-scoped user has no
// business seeing or creating sibling customers, or minting agent tokens.
// Two different permission keys on this one controller: CRUD routes need
// 'customers', agent-token/enrollment-code routes need 'agent' (same key
// AgentDownloadController uses) - they're a conceptually separate module
// even though they happen to live under the same :id path today.
@UseGuards(UserAuthGuard, SubscriptionGuard)
@Controller('v1/customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  list(@Req() req: any) {
    assertPermission(req, 'customers');
    return this.customersService.list(req.tenantId);
  }

  @Post()
  async create(@Req() req: any, @Body() dto: CreateCustomerDto) {
    assertPermission(req, 'customers');
    const customer = await this.customersService.create(req.tenantId, dto.name);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'customer.create',
      targetType: 'Customer',
      targetId: customer.id,
      targetLabel: customer.name,
    });
    return customer;
  }

  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    assertPermission(req, 'customers');
    return this.customersService.get(req.tenantId, id);
  }

  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    assertPermission(req, 'customers');
    const customer = await this.customersService.update(req.tenantId, id, dto);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'customer.update',
      targetType: 'Customer',
      targetId: customer.id,
      targetLabel: customer.name,
      metadata: dto as Record<string, unknown>,
    });
    return customer;
  }

  @Get(':id/agent-tokens')
  listTokens(@Req() req: any, @Param('id') id: string) {
    assertPermission(req, 'agent');
    return this.customersService.listTokens(req.tenantId, id);
  }

  @Post(':id/agent-tokens/:tokenId/revoke')
  async revokeToken(@Req() req: any, @Param('id') id: string, @Param('tokenId') tokenId: string) {
    assertPermission(req, 'agent');
    const token = await this.customersService.revokeToken(req.tenantId, id, tokenId);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'agent_token.revoke',
      targetType: 'AgentToken',
      targetId: token.id,
      targetLabel: token.label ?? 'Sem rótulo',
      metadata: { customerId: id },
    });
    return token;
  }

  @Post(':id/agent-tokens/:tokenId/request-log')
  async requestLog(@Req() req: any, @Param('id') id: string, @Param('tokenId') tokenId: string) {
    assertPermission(req, 'agent');
    const token = await this.customersService.requestLog(req.tenantId, id, tokenId);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'agent_token.request_log',
      targetType: 'AgentToken',
      targetId: token.id,
      targetLabel: token.label ?? 'Sem rótulo',
      metadata: { customerId: id },
    });
    return token;
  }

  @Post(':id/agent-tokens/:tokenId/command')
  async requestCommand(
    @Req() req: any,
    @Param('id') id: string,
    @Param('tokenId') tokenId: string,
    @Body() dto: RequestCommandDto,
  ) {
    assertPermission(req, 'agent');
    const token = await this.customersService.requestCommand(req.tenantId, id, tokenId, dto.command);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'agent_token.command',
      targetType: 'AgentToken',
      targetId: token.id,
      targetLabel: token.label ?? 'Sem rótulo',
      metadata: { customerId: id, command: dto.command },
    });
    return token;
  }

  @Get(':id/agent-tokens/:tokenId/log')
  getLog(
    @Req() req: any,
    @Param('id') id: string,
    @Param('tokenId') tokenId: string,
    @Query('date') date?: string,
  ) {
    assertPermission(req, 'agent');
    return this.customersService.getLog(req.tenantId, id, tokenId, date);
  }

  @Get(':id/agent-enrollment-codes')
  listEnrollmentCodes(@Req() req: any, @Param('id') id: string) {
    assertPermission(req, 'agent');
    return this.customersService.listEnrollmentCodes(req.tenantId, id);
  }

  @Post(':id/agent-enrollment-codes')
  async createEnrollmentCode(@Req() req: any, @Param('id') id: string, @Body() dto: CreateEnrollmentCodeDto) {
    assertPermission(req, 'agent');
    const code = await this.customersService.createEnrollmentCode(req.tenantId, id, dto.label);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'enrollment_code.create',
      targetType: 'AgentEnrollmentCode',
      targetId: code.id,
      targetLabel: code.label ?? 'Sem rótulo',
      metadata: { customerId: id },
    });
    return code;
  }

  @Post(':id/agent-enrollment-codes/:codeId/revoke')
  async revokeEnrollmentCode(@Req() req: any, @Param('id') id: string, @Param('codeId') codeId: string) {
    assertPermission(req, 'agent');
    const code = await this.customersService.revokeEnrollmentCode(req.tenantId, id, codeId);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'enrollment_code.revoke',
      targetType: 'AgentEnrollmentCode',
      targetId: code.id,
      targetLabel: code.label ?? 'Sem rótulo',
      metadata: { customerId: id },
    });
    return code;
  }
}
