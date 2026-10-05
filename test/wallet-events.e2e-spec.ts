import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

describe("Wallet events (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.providerEvent.deleteMany();
    await prisma.transaction.deleteMany();
    await prisma.wallet.deleteMany();

    await prisma.wallet.create({
      data: {
        id: "W001",
        customerId: "C001",
        currency: "NGN",
        availableBalanceKobo: 0,
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("handles the required wallet event scenarios", async () => {
    // 1. Pending T001
    await request(app.getHttpServer())
      .post("/provider/events")
      .send({
        eventId: "E001",
        transactionRef: "T001",
        walletId: "W001",
        amountKobo: 250000,
        currency: "NGN",
        status: "pending",
      })
      .expect(201)
      .expect({
        accepted: true,
        duplicate: false,
        result: "RECORDED_PENDING",
        transactionStatus: "pending",
      });

    let walletResponse = await request(app.getHttpServer())
      .get("/wallets/W001")
      .expect(200);

    expect(walletResponse.body.availableBalanceKobo).toBe(0);
    expect(walletResponse.body.transactions).toHaveLength(1);
    expect(walletResponse.body.transactions[0]).toEqual({
      reference: "T001",
      amountKobo: 250000,
      currency: "NGN",
      status: "pending",
    });

    // 2. Successful T001
    await request(app.getHttpServer())
      .post("/provider/events")
      .send({
        eventId: "E002",
        transactionRef: "T001",
        walletId: "W001",
        amountKobo: 250000,
        currency: "NGN",
        status: "successful",
      })
      .expect(201);

    walletResponse = await request(app.getHttpServer())
      .get("/wallets/W001")
      .expect(200);

    expect(walletResponse.body.availableBalanceKobo).toBe(250000);
    expect(walletResponse.body.transactions).toHaveLength(1);
    expect(walletResponse.body.transactions[0].status).toBe("successful");

    // 3. Replay same successful eventId
    await request(app.getHttpServer())
      .post("/provider/events")
      .send({
        eventId: "E002",
        transactionRef: "T001",
        walletId: "W001",
        amountKobo: 250000,
        currency: "NGN",
        status: "successful",
      })
      .expect(201)
      .expect({
        accepted: true,
        duplicate: true,
        result: "CREDITED",
      });

    // 4. New eventId for same successful transaction
    await request(app.getHttpServer())
      .post("/provider/events")
      .send({
        eventId: "E003",
        transactionRef: "T001",
        walletId: "W001",
        amountKobo: 250000,
        currency: "NGN",
        status: "successful",
      })
      .expect(201);

    walletResponse = await request(app.getHttpServer())
      .get("/wallets/W001")
      .expect(200);

    expect(walletResponse.body.availableBalanceKobo).toBe(250000);
    expect(walletResponse.body.transactions).toHaveLength(1);

    // 5. Failed T002
    await request(app.getHttpServer())
      .post("/provider/events")
      .send({
        eventId: "E004",
        transactionRef: "T002",
        walletId: "W001",
        amountKobo: 100000,
        currency: "NGN",
        status: "failed",
      })
      .expect(201);

    walletResponse = await request(app.getHttpServer())
      .get("/wallets/W001")
      .expect(200);

    expect(walletResponse.body.availableBalanceKobo).toBe(250000);
    expect(walletResponse.body.transactions).toHaveLength(2);

    // 6. Late pending event for successful T001
    await request(app.getHttpServer())
      .post("/provider/events")
      .send({
        eventId: "E005",
        transactionRef: "T001",
        walletId: "W001",
        amountKobo: 250000,
        currency: "NGN",
        status: "pending",
      })
      .expect(201);

    walletResponse = await request(app.getHttpServer())
      .get("/wallets/W001")
      .expect(200);

    expect(walletResponse.body.availableBalanceKobo).toBe(250000);
    expect(walletResponse.body.transactions[0].status).toBe("successful");

    // 7. Negative amount
    await request(app.getHttpServer())
      .post("/provider/events")
      .send({
        eventId: "E006",
        transactionRef: "T003",
        walletId: "W001",
        amountKobo: -100000,
        currency: "NGN",
        status: "successful",
      })
      .expect(400);

    // 8. Conflicting amount for T001
    await request(app.getHttpServer())
      .post("/provider/events")
      .send({
        eventId: "E007",
        transactionRef: "T001",
        walletId: "W001",
        amountKobo: 300000,
        currency: "NGN",
        status: "successful",
      })
      .expect(409);

    walletResponse = await request(app.getHttpServer())
      .get("/wallets/W001")
      .expect(200);

    expect(walletResponse.body.availableBalanceKobo).toBe(250000);
  });

  it("rejects an unknown wallet", async () => {
    await request(app.getHttpServer())
      .post("/provider/events")
      .send({
        eventId: "E100",
        transactionRef: "T100",
        walletId: "W999",
        amountKobo: 100000,
        currency: "NGN",
        status: "successful",
      })
      .expect(404);
  });

  it("rejects unsupported currency", async () => {
    await request(app.getHttpServer())
      .post("/provider/events")
      .send({
        eventId: "E101",
        transactionRef: "T101",
        walletId: "W001",
        amountKobo: 100000,
        currency: "USD",
        status: "successful",
      })
      .expect(400);
  });

  it("rejects a reused eventId with conflicting details", async () => {
    await request(app.getHttpServer())
      .post("/provider/events")
      .send({
        eventId: "E200",
        transactionRef: "T200",
        walletId: "W001",
        amountKobo: 100000,
        currency: "NGN",
        status: "pending",
      })
      .expect(201);

    await request(app.getHttpServer())
      .post("/provider/events")
      .send({
        eventId: "E200",
        transactionRef: "T200",
        walletId: "W001",
        amountKobo: 200000,
        currency: "NGN",
        status: "pending",
      })
      .expect(409);
  });

  it("credits a transaction when the first event is successful", async () => {
    await request(app.getHttpServer())
      .post("/provider/events")
      .send({
        eventId: "E300",
        transactionRef: "T300",
        walletId: "W001",
        amountKobo: 50000,
        currency: "NGN",
        status: "successful",
      })
      .expect(201);

    const walletResponse = await request(app.getHttpServer())
      .get("/wallets/W001")
      .expect(200);

    expect(walletResponse.body.availableBalanceKobo).toBe(50000);
    expect(walletResponse.body.transactions).toHaveLength(1);
    expect(walletResponse.body.transactions[0]).toEqual({
      reference: "T300",
      amountKobo: 50000,
      currency: "NGN",
      status: "successful",
    });
  });

  it("does not allow a failed transaction to become successful later", async () => {
    await request(app.getHttpServer())
      .post("/provider/events")
      .send({
        eventId: "E400",
        transactionRef: "T400",
        walletId: "W001",
        amountKobo: 75000,
        currency: "NGN",
        status: "failed",
      })
      .expect(201);

    const lateSuccess = await request(app.getHttpServer())
      .post("/provider/events")
      .send({
        eventId: "E401",
        transactionRef: "T400",
        walletId: "W001",
        amountKobo: 75000,
        currency: "NGN",
        status: "successful",
      })
      .expect(201);

    expect(lateSuccess.body.result).toBe("IGNORED_TERMINAL_STATE");
    expect(lateSuccess.body.transactionStatus).toBe("failed");

    const walletResponse = await request(app.getHttpServer())
      .get("/wallets/W001")
      .expect(200);

    expect(walletResponse.body.availableBalanceKobo).toBe(0);
    expect(walletResponse.body.transactions[0].status).toBe("failed");
  });

});
