import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export enum ContractPricingModel {
  FLAT_RATE = 'FLAT_RATE',
  ALLOWANCE_PLUS_OVERAGE = 'ALLOWANCE_PLUS_OVERAGE',
  PER_PAGE = 'PER_PAGE',
}

// Which fields are required depends on pricingModel - see the enum's
// counterpart comment on the Contract model in prisma/schema.prisma for
// what each model means. @ValidateIf keeps that conditional requirement
// enforced at the API boundary rather than trusting the frontend form to
// only submit the relevant fields.
export class CreateContractDto {
  @IsEnum(ContractPricingModel)
  pricingModel: ContractPricingModel;

  @IsDateString()
  startDate: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  billingDay: number;

  // FLAT_RATE: required, the whole bill. ALLOWANCE_PLUS_OVERAGE: required,
  // the base fee. PER_PAGE: optional extra fixed charge on top of usage.
  @ValidateIf((o) => o.pricingModel !== ContractPricingModel.PER_PAGE)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fixedFee?: number;

  @ValidateIf((o) => o.pricingModel === ContractPricingModel.ALLOWANCE_PLUS_OVERAGE)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  includedPagesMono?: number;

  @ValidateIf((o) => o.pricingModel === ContractPricingModel.ALLOWANCE_PLUS_OVERAGE)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  includedPagesColor?: number;

  @ValidateIf((o) => o.pricingModel === ContractPricingModel.ALLOWANCE_PLUS_OVERAGE)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  overagePriceMono?: number;

  @ValidateIf((o) => o.pricingModel === ContractPricingModel.ALLOWANCE_PLUS_OVERAGE)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  overagePriceColor?: number;

  @ValidateIf((o) => o.pricingModel === ContractPricingModel.PER_PAGE)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pricePerPageMono?: number;

  @ValidateIf((o) => o.pricingModel === ContractPricingModel.PER_PAGE)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pricePerPageColor?: number;

  @ValidateIf((o) => o.pricingModel === ContractPricingModel.PER_PAGE)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minimumPagesMono?: number;

  @ValidateIf((o) => o.pricingModel === ContractPricingModel.PER_PAGE)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minimumPagesColor?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  setupFee?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  earlyTerminationFee?: number;

  @IsOptional()
  @IsString()
  adjustmentIndex?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
