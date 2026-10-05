import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class WalletsService {
  constructor(private readonly prisma: PrismaService) {}

  async findOne(walletId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
      include: {
        transactions: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    if (!wallet) {
      throw new NotFoundException(`Wallet ${walletId} not found`);
    }

    return {
      walletId: wallet.id,
      customerId: wallet.customerId,
      currency: wallet.currency,
      availableBalanceKobo: wallet.availableBalanceKobo,
      transactions: wallet.transactions.map((transaction) => ({
        reference: transaction.transactionRef,
        amountKobo: transaction.amountKobo,
        currency: transaction.currency,
        status: transaction.status,
      })),
    };
  }
}
