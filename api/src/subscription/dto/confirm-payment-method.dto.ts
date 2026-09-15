import { IsString, MinLength } from 'class-validator';

export class ConfirmPaymentMethodDto {
  @IsString()
  @MinLength(1)
  paymentMethodId: string;
}
