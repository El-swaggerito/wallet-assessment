import { Module } from "@nestjs/common";
import { PrismaModule } from "./prisma/prisma.module.js";
import { ProviderModule } from "./provider/provider.module.js";
import { WalletsModule } from "./wallets/wallets.module.js";

@Module({
  imports: [PrismaModule, ProviderModule, WalletsModule],
})
export class AppModule {}
