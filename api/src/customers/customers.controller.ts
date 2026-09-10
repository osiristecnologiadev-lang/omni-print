import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { UserAuthGuard } from '../auth/user-auth.guard';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CreateTokenDto } from './dto/create-token.dto';
import { CreateEnrollmentCodeDto } from './dto/create-enrollment-code.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

// Customer management is tenant-wide only - a customer-scoped user has no
// business seeing or creating sibling customers, or minting agent tokens.
@UseGuards(UserAuthGuard)
@Controller('v1/customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  list(@Req() req: any) {
    this.assertTenantWide(req.customerId);
    return this.customersService.list(req.tenantId);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateCustomerDto) {
    this.assertTenantWide(req.customerId);
    return this.customersService.create(req.tenantId, dto.name);
  }

  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    this.assertTenantWide(req.customerId);
    return this.customersService.get(req.tenantId, id);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    this.assertTenantWide(req.customerId);
    return this.customersService.update(req.tenantId, id, dto);
  }

  @Get(':id/agent-tokens')
  listTokens(@Req() req: any, @Param('id') id: string) {
    this.assertTenantWide(req.customerId);
    return this.customersService.listTokens(req.tenantId, id);
  }

  @Post(':id/agent-tokens')
  createToken(@Req() req: any, @Param('id') id: string, @Body() dto: CreateTokenDto) {
    this.assertTenantWide(req.customerId);
    return this.customersService.createToken(req.tenantId, id, dto.label);
  }

  @Post(':id/agent-tokens/:tokenId/revoke')
  revokeToken(@Req() req: any, @Param('id') id: string, @Param('tokenId') tokenId: string) {
    this.assertTenantWide(req.customerId);
    return this.customersService.revokeToken(req.tenantId, id, tokenId);
  }

  @Get(':id/agent-enrollment-codes')
  listEnrollmentCodes(@Req() req: any, @Param('id') id: string) {
    this.assertTenantWide(req.customerId);
    return this.customersService.listEnrollmentCodes(req.tenantId, id);
  }

  @Post(':id/agent-enrollment-codes')
  createEnrollmentCode(@Req() req: any, @Param('id') id: string, @Body() dto: CreateEnrollmentCodeDto) {
    this.assertTenantWide(req.customerId);
    return this.customersService.createEnrollmentCode(req.tenantId, id, dto.label);
  }

  @Post(':id/agent-enrollment-codes/:codeId/revoke')
  revokeEnrollmentCode(@Req() req: any, @Param('id') id: string, @Param('codeId') codeId: string) {
    this.assertTenantWide(req.customerId);
    return this.customersService.revokeEnrollmentCode(req.tenantId, id, codeId);
  }

  private assertTenantWide(customerId: string | null) {
    if (customerId) {
      throw new ForbiddenException('only tenant-wide users can do this');
    }
  }
}
