import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
});

const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.wallet.upsert({
    where: { id: "W001" },
    update: {},
    create: {
      id: "W001",
      customerId: "C001",
      currency: "NGN",
      availableBalanceKobo: 0,
    },
  });

  console.log("Seeded wallet W001");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
