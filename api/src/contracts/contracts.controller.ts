import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ContractsService } from './contracts.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';

// Contract management is tenant-wide only - it's the outsourcing company's
// commercial terms with its own client, not something that client's own
// (read-only) login should see or touch.
@UseGuards(UserAuthGuard)
@Controller('v1/customers/:customerId/contracts')
export class ContractsController {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  list(@Req() req: any, @Param('customerId') customerId: string) {
    this.assertTenantWide(req.customerId);
    return this.contractsService.list(req.tenantId, customerId);
  }

  @Get('active')
  getActive(@Req() req: any, @Param('customerId') customerId: string) {
    this.assertTenantWide(req.customerId);
    return this.contractsService.getActive(req.tenantId, customerId);
  }

  @Post()
  async create(@Req() req: any, @Param('customerId') customerId: string, @Body() dto: CreateContractDto) {
    this.assertTenantWide(req.customerId);
    const contract = await this.contractsService.create(req.tenantId, customerId, dto);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'contract.create',
      targetType: 'Contract',
      targetId: contract.id,
      targetLabel: `Contrato ${contract.pricingModel}`,
      metadata: { customerId },
    });
    return contract;
  }

  @Patch(':contractId')
  async update(
    @Req() req: any,
    @Param('customerId') customerId: string,
    @Param('contractId') contractId: string,
    @Body() dto: UpdateContractDto,
  ) {
    this.assertTenantWide(req.customerId);
    const contract = await this.contractsService.update(req.tenantId, customerId, contractId, dto);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'contract.update',
      targetType: 'Contract',
      targetId: contract.id,
      targetLabel: `Contrato ${contract.pricingModel}`,
      metadata: { customerId },
    });
    return contract;
  }

  @Post(':contractId/cancel')
  async cancel(@Req() req: any, @Param('customerId') customerId: string, @Param('contractId') contractId: string) {
    this.assertTenantWide(req.customerId);
    const contract = await this.contractsService.cancel(req.tenantId, customerId, contractId);
    await this.auditLog.log({
      tenantId: req.tenantId,
      actorType: 'USER',
      actorId: req.userId,
      actorLabel: req.userEmail,
      action: 'contract.cancel',
      targetType: 'Contract',
      targetId: contract.id,
      targetLabel: `Contrato ${contract.pricingModel}`,
      metadata: { customerId },
    });
    return contract;
  }

  @Get('billing')
  billing(
    @Req() req: any,
    @Param('customerId') customerId: string,
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
  ) {
    this.assertTenantWide(req.customerId);
    return this.contractsService.calculateBilling(req.tenantId, customerId, year, month);
  }

  // "Guaranteed so far this month" - the still-open current period, not a
  // past/closed one like billing above. Route sits before ':contractId'-style
  // params wouldn't apply here since this whole path is a static suffix, no
  // ambiguity with the other routes on this controller.
  @Get('billing/current')
  currentBilling(@Req() req: any, @Param('customerId') customerId: string) {
    this.assertTenantWide(req.customerId);
    return this.contractsService.currentPeriodPreview(req.tenantId, customerId);
  }

  private assertTenantWide(customerId: string | null) {
    if (customerId) {
      throw new ForbiddenException('only tenant-wide users can do this');
    }
  }
}
