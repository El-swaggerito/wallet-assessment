import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { ProviderEventDto } from "./dto/provider-event.dto.js";

@Injectable()
export class ProviderService {
  constructor(private readonly prisma: PrismaService) {}

  async processEvent(event: ProviderEventDto) {
    const existingEvent = await this.prisma.providerEvent.findUnique({
      where: { eventId: event.eventId },
    });

    if (existingEvent) {
      const conflicts =
        existingEvent.transactionRef !== event.transactionRef ||
        existingEvent.walletId !== event.walletId ||
        existingEvent.amountKobo !== event.amountKobo ||
        existingEvent.currency !== event.currency;

      if (conflicts) {
        throw new ConflictException(
          "eventId has already been used with different transaction details",
        );
      }

      return {
        accepted: true,
        duplicate: true,
        result: existingEvent.result,
      };
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { id: event.walletId },
    });

    if (!wallet) {
      throw new NotFoundException(`Wallet ${event.walletId} not found`);
    }

    const existingTransaction = await this.prisma.transaction.findUnique({
      where: { transactionRef: event.transactionRef },
    });

    if (existingTransaction) {
      const conflicts =
        existingTransaction.walletId !== event.walletId ||
        existingTransaction.amountKobo !== event.amountKobo ||
        existingTransaction.currency !== event.currency;

      if (conflicts) {
        throw new ConflictException(
          "transactionRef has already been used with different transaction details",
        );
      }

      if (
        existingTransaction.status === "successful" ||
        existingTransaction.status === "failed"
      ) {
        await this.prisma.providerEvent.create({
          data: {
            eventId: event.eventId,
            transactionRef: event.transactionRef,
            walletId: event.walletId,
            amountKobo: event.amountKobo,
            currency: event.currency,
            status: event.status,
            result: "IGNORED_TERMINAL_STATE",
          },
        });

        return {
          accepted: true,
          duplicate: false,
          result: "IGNORED_TERMINAL_STATE",
          transactionStatus: existingTransaction.status,
        };
      }

      if (existingTransaction.status === "pending") {
        if (event.status === "pending") {
          await this.prisma.providerEvent.create({
            data: {
              eventId: event.eventId,
              transactionRef: event.transactionRef,
              walletId: event.walletId,
              amountKobo: event.amountKobo,
              currency: event.currency,
              status: event.status,
              result: "NO_STATE_CHANGE",
            },
          });

          return {
            accepted: true,
            duplicate: false,
            result: "NO_STATE_CHANGE",
            transactionStatus: "pending",
          };
        }

        return this.prisma.$transaction(async (tx) => {
          const transaction = await tx.transaction.update({
            where: { transactionRef: event.transactionRef },
            data: {
              status: event.status,
            },
          });

          if (event.status === "successful") {
            await tx.wallet.update({
              where: { id: event.walletId },
              data: {
                availableBalanceKobo: {
                  increment: event.amountKobo,
                },
              },
            });
          }

          await tx.providerEvent.create({
            data: {
              eventId: event.eventId,
              transactionRef: event.transactionRef,
              walletId: event.walletId,
              amountKobo: event.amountKobo,
              currency: event.currency,
              status: event.status,
              result:
                event.status === "successful"
                  ? "CREDITED"
                  : "MARKED_FAILED",
            },
          });

          return {
            accepted: true,
            duplicate: false,
            result:
              event.status === "successful"
                ? "CREDITED"
                : "MARKED_FAILED",
            transactionStatus: transaction.status,
          };
        });
      }
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.transaction.create({
        data: {
          transactionRef: event.transactionRef,
          walletId: event.walletId,
          amountKobo: event.amountKobo,
          currency: event.currency,
          status: event.status,
        },
      });

      if (event.status === "successful") {
        await tx.wallet.update({
          where: { id: event.walletId },
          data: {
            availableBalanceKobo: {
              increment: event.amountKobo,
            },
          },
        });
      }

      const result =
        event.status === "successful"
          ? "CREDITED"
          : event.status === "failed"
            ? "MARKED_FAILED"
            : "RECORDED_PENDING";

      await tx.providerEvent.create({
        data: {
          eventId: event.eventId,
          transactionRef: event.transactionRef,
          walletId: event.walletId,
          amountKobo: event.amountKobo,
          currency: event.currency,
          status: event.status,
          result,
        },
      });

      return {
        accepted: true,
        duplicate: false,
        result,
        transactionStatus: event.status,
      };
    });
  }
}
