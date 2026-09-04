import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { ContractPricingModel } from './create-contract.dto';

// Only the currently-active contract can be edited in place (fixing a typo,
// adjusting a date) - renegotiating terms, including switching pricing
// model, should go through ContractsService.create instead, which preserves
// history. See Contract's comment in prisma/schema.prisma. Every field is
// optional here (a PATCH), so there's no per-model @ValidateIf like
// CreateContractDto - whatever's sent is validated for shape and written
// as-is.
export class UpdateContractDto {
  @IsOptional()
  @IsEnum(ContractPricingModel)
  pricingModel?: ContractPricingModel;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  billingDay?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fixedFee?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  includedPagesMono?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  includedPagesColor?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  overagePriceMono?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  overagePriceColor?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pricePerPageMono?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pricePerPageColor?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minimumPagesMono?: number;

  @IsOptional()
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
