import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsPositive,
  IsString,
} from "class-validator";

export class ProviderEventDto {
  @IsString()
  @IsNotEmpty()
  eventId!: string;

  @IsString()
  @IsNotEmpty()
  transactionRef!: string;

  @IsString()
  @IsNotEmpty()
  walletId!: string;

  @IsInt()
  @IsPositive()
  amountKobo!: number;

  @IsString()
  @IsIn(["NGN"])
  currency!: string;

  @IsString()
  @IsIn(["pending", "successful", "failed"])
  status!: "pending" | "successful" | "failed";
}
