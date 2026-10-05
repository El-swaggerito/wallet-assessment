import { Controller, Get, Param } from "@nestjs/common";
import { WalletsService } from "./wallets.service.js";

@Controller("wallets")
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get(":walletId")
  getWallet(@Param("walletId") walletId: string) {
    return this.walletsService.findOne(walletId);
  }
}
