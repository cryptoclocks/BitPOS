// Local-only W02 UI journey. Synthetic sessions/payment seam; commands and UI are real.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdtemp,
  readFile,
  writeFile,
  unlink,
  realpath,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import pg from "pg";
import { assertLocalFoodFixture } from "./fixture/assert-local";
import { staffToken } from "../../tests/backend-table-fixture";
const OWN = process.env.BITPOS_OWN_FOOD_FIXTURE === "1"; // own disposable stack (API 3001, DB 55440), never the W01 fixture
const privateRoot = join(homedir(), (OWN?".local/share/bitpos-own-food-fixture":".local/share/bitpos-w01-fixture"));
const adb = "/Users/cryptoclock/Library/Android/sdk/platform-tools/adb";
const flutter = "/Users/cryptoclock/development/flutter/bin/flutter";
const stamp = () =>
  new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
type Call = (
  path: string,
  method?: string,
  body?: unknown,
  token?: string,
  status?: number,
) => Promise<any>;
type Actor = {
  account: string;
  session: string;
  device: string;
  access: string;
  refresh: string;
};
type Journey = {
  purpose: "BITPOS_W02_JOINED_UI";
  base: string;
  merchant: string;
  branch: string;
  product: string;
  policy: string;
  driver: string;
  grant: string;
  customer: Actor;
  driverActor: Actor;
  dispatcher: Actor;
  merchantToken: string;
  orderId?: string;
  shipmentId?: string;
  offerId?: string;
  assignmentId?: string;
  generation?: string;
  leaseGeneration?: string;
  stage: string;
  checks: string[];
  startedAt: string;
};
async function save(dir: string, state: Journey) {
  await writeFile(join(dir, "state.json"), JSON.stringify(state), {
    mode: 0o600,
  });
}
export async function prepareJoinedFoodUi(c: {
  db: pg.Client;
  call: Call;
  base: string;
  merchant: string;
  branch: string;
  product: string;
  policy: string;
  driver: string;
  grant: string;
  customerToken: string;
  customerRefresh: string;
  driverActor: Actor;
  dispatcher: Actor;
  merchantToken: string;
}) {
  await assertLocalFoodFixture(c.db);
  assert.equal(new URL(c.base).origin, (OWN?"http://127.0.0.1:3001":"http://127.0.0.1:3046"));
  const customer = (
    await c.db.query(
      "SELECT id,account_id,device_id FROM bitpos.mobile_sessions WHERE access_hash=$1",
      [createHash("sha256").update(c.customerToken).digest("hex")],
    )
  ).rows[0];
  assert.ok(customer);
  await c.call(
    "/api/mobile/v1/account/addresses",
    "POST",
    {
      idempotencyKey: randomUUID(),
      address: {
        label: "W02 joined fixture",
        recipientName: "Synthetic recipient",
        phone: "+66900000001",
        addressText: "W02 synthetic destination",
        instructions: "LOCAL FIXTURE ONLY",
        latitudeE7: 137560001,
        longitudeE7: 1005018001,
      },
    },
    c.customerToken,
  );
  await c.db.query(
    "UPDATE bitpos.mobile_accounts SET locale='en' WHERE id=$1",
    [customer.account_id],
  );
  // Deterministic discovery for this private local fixture, not a global catalog mutation.
  await c.db.query(
    "UPDATE bitpos.marketplace_branches SET name='W02 joined food fixture',name_en='W02 joined food fixture' WHERE merchant_id=$1 AND id=$2",
    [c.merchant, c.branch],
  );
  const dir = await mkdtemp(join(privateRoot, "joined-ui-"));
  const state: Journey = {
    purpose: "BITPOS_W02_JOINED_UI",
    base: c.base,
    merchant: c.merchant,
    branch: c.branch,
    product: c.product,
    policy: c.policy,
    driver: c.driver,
    grant: c.grant,
    customer: {
      account: customer.account_id,
      session: customer.id,
      device: customer.device_id,
      access: c.customerToken,
      refresh: c.customerRefresh,
    },
    driverActor: c.driverActor,
    dispatcher: c.dispatcher,
    merchantToken: c.merchantToken,
    stage: "PREPARED",
    checks: [],
    startedAt: new Date().toISOString(),
  };
  await save(dir, state);
  console.log(
    JSON.stringify({
      status: "PREPARED_NOT_ACCEPTANCE",
      privateDirectory: dir,
      merchantId: c.merchant,
      branchId: c.branch,
      productId: c.product,
      fixture: true,
    }),
  );
}
async function main() {
  const [action, directory, ...extra] = process.argv.slice(2);
  assert.ok(
    action && directory && !extra.length,
    "action and private journey directory required",
  );
  const dir = await realpath(directory),
    root = await realpath(privateRoot);
  assert.ok(
    dir.startsWith(root + "/joined-ui-") && resolve(dir) === dir,
    "Owned local journey directory only",
  );
  const state: Journey = JSON.parse(
    await readFile(join(dir, "state.json"), "utf8"),
  );
  assert.equal(state.purpose, "BITPOS_W02_JOINED_UI");
  assert.equal(state.base, (OWN?"http://127.0.0.1:3001":"http://127.0.0.1:3046"));
  const db = new pg.Client({
    connectionString:
      (OWN?"postgresql://cryptoclock@127.0.0.1:55440/bitpos_delivery_fixture":"postgresql://cryptoclock@127.0.0.1:55446/bitpos_w01_fixture"),
  });
  await db.connect();
  await assertLocalFoodFixture(db);
  const call: Call = async (
    path,
    method = "GET",
    body,
    token,
    status = 200,
  ) => {
    const response = await fetch(state.base + path, {
      method,
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status, status, method + " " + path);
    return response.json();
  };
  const ownOrder = async () => {
    assert.ok(state.orderId);
    const row = (
      await db.query(
        "SELECT o.id,o.merchant_id,a.source_account_id FROM bitpos.orders o JOIN bitpos.order_authority a ON (a.merchant_id,a.order_id)=(o.merchant_id,o.id) WHERE o.id=$1",
        [state.orderId],
      )
    ).rows[0];
    assert.ok(row);
    assert.equal(row.merchant_id, state.merchant);
    assert.equal(row.source_account_id, state.customer.account);
  };
  async function mintCurrentOwnerMerchantFixtureToken(token: string) {
    const credential = (
      await db.query(
        "SELECT s.user_id,s.expires_at>clock_timestamp() AS unexpired,m.role AS current_role FROM bitpos.sessions s LEFT JOIN bitpos.members m ON m.merchant_id=s.merchant_id AND m.user_id=s.user_id WHERE s.merchant_id=$1 AND s.token_hash=$2",
        [
          state.merchant,
          createHash("sha256").update(token).digest("hex"),
        ],
      )
    ).rows[0];
    assert.ok(credential, "Existing merchant fixture credential required");
    assert.equal(
      credential.current_role,
      "owner",
      "Current merchant membership must remain owner",
    );
    if (credential.unexpired) return token;
    const renewed = randomBytes(32).toString("base64url");
    await db.query(
      "INSERT INTO bitpos.sessions(token_hash,user_id,merchant_id,role,expires_at) VALUES($1,$2,$3,'owner',clock_timestamp()+interval '1 hour')",
      [
        createHash("sha256").update(renewed).digest("hex"),
        credential.user_id,
        state.merchant,
      ],
    );
    return renewed;
  }
  async function renewExpiredMerchantFixtureToken() {
    state.merchantToken = await mintCurrentOwnerMerchantFixtureToken(
      state.merchantToken,
    );
    await save(dir, state);
  }
  function selectOriginalOwnedFoodCommand(candidates: Array<Record<string, string>>) {
    assert.equal(
      candidates.length,
      1,
      "Recovery requires exactly one owned online order",
    );
    const original = candidates[0];
    if (state.orderId != null) {
      assert.equal(
        original.id,
        state.orderId,
        "Recovery must retain its known original order",
      );
    } else {
      state.orderId = original.id;
    }
    return {
      branchId: original.branch_id,
      quoteId: original.quote_id,
      priceVersion: original.price_version_id,
      idempotencyKey: original.idempotency_key,
    };
  }
  async function originalOwnedFoodCommand() {
    const candidates = (
      await db.query(
        "SELECT o.id,o.idempotency_key,a.quote_id,q.price_version_id,f.branch_id FROM bitpos.orders o JOIN bitpos.order_authority a ON (a.merchant_id,a.order_id)=(o.merchant_id,o.id) JOIN bitpos.order_quotes q ON (q.merchant_id,q.id)=(o.merchant_id,a.quote_id) JOIN bitpos.online_food_orders f ON (f.merchant_id,f.order_id)=(o.merchant_id,o.id) WHERE o.merchant_id=$1 AND f.account_id=$2 ORDER BY o.id",
        [state.merchant, state.customer.account],
      )
    ).rows;
    return selectOriginalOwnedFoodCommand(candidates);
  }
  async function command(binary: string, args: string[], cwd?: string) {
    const child = spawn(binary, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    child.stdout.on("data", (data) => output.push(data));
    let errors = "";
    child.stderr.on("data", (data) => (errors += String(data)));
    const [code] = await once(child, "exit");
    assert.equal(code, 0, binary + " failed: " + errors.slice(-1000));
    return Buffer.concat(output);
  }
  async function native(
    app: "customer" | "driver",
    stage: string,
    extraConfig: Record<string, string> = {},
    onReady?: () => Promise<void>,
  ) {
    const actor = app === "customer" ? state.customer : state.driverActor;
    const row = (
      await db.query(
        "SELECT access_expires_at,refresh_expires_at FROM bitpos.mobile_sessions WHERE id=$1 AND revoked_at IS NULL",
        [actor.session],
      )
    ).rows[0];
    assert.ok(row, "Current fixture session required");
    const config = {
      BITPOS_FIXTURE: "true",
      BITPOS_MOBILE_API: (OWN?"http://10.0.2.2:3001/api/mobile/v1/":"http://10.0.2.2:3046/api/mobile/v1/"),
      BITPOS_TEST_SESSION_BASE64: Buffer.from(
        JSON.stringify({
          accountId: actor.account,
          sessionId: actor.session,
          accessToken: actor.access,
          refreshToken: actor.refresh,
          accessExpiresAt: row.access_expires_at,
          refreshExpiresAt: row.refresh_expires_at,
        }),
      ).toString("base64"),
      BITPOS_TEST_DEVICE_ID: actor.device,
      BITPOS_TEST_BRANCH_ID: state.branch,
      BITPOS_TEST_PRODUCT_ID: state.product,
      BITPOS_TEST_ORDER_ID: state.orderId ?? "",
      BITPOS_TEST_ASSIGNMENT_ID: state.assignmentId ?? "",
      BITPOS_TEST_OFFER_ID: state.offerId ?? "",
      [app === "customer"
        ? "BITPOS_TEST_CUSTOMER_STAGE"
        : "BITPOS_TEST_DRIVER_STAGE"]: stage,
      ...extraConfig,
    };
    const path = join(dir, app + "-config.json");
    await writeFile(path, JSON.stringify(config), { mode: 0o600 });
    try {
      const child = spawn(
        flutter,
        [
          "test",
          "integration_test/food_joined_journey_test.dart",
          "-d",
          "emulator-5554",
          "--dart-define-from-file=" + path,
          "--no-enable-impeller",
          "--no-uninstall",
        ],
        { cwd: "apps/mobile-" + app, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "",
        started = false,
        ready = Promise.resolve(),
        readyError: unknown;
      const observe = (data: Buffer) => {
        output += String(data);
        process.stdout.write(data);
        if (
          onReady &&
          !started &&
          output.includes("BITPOS_JOINED_DRIVER_READY")
        ) {
          started = true;
          ready = onReady().catch((error) => {
            readyError = error;
          });
        }
      };
      child.stdout.on("data", observe);
      child.stderr.on("data", observe);
      const [code] = await once(child, "exit");
      await ready;
      if (readyError) throw readyError;
      if (output.includes("BITPOS_JOINED_SESSION_EXPORTED")) {
        const sessionPath = "code_cache/bitpos-joined-session.json";
        const rotated = JSON.parse(
          (
            await command(adb, [
              "-s",
              "emulator-5554",
              "exec-out",
              "run-as",
              "com.bitpos.bitpos_" + app,
              "cat",
              sessionPath,
            ])
          ).toString(),
        );
        assert.ok(
          rotated.accountId === actor.account &&
            rotated.sessionId === actor.session,
          "Only same fixture session may be recovered",
        );
        assert.ok(
          /^[A-Za-z0-9_-]{43}$/.test(rotated.accessToken) &&
            /^[A-Za-z0-9_-]{43}$/.test(rotated.refreshToken),
          "Canonical credential shape required",
        );
        const valid = (
          await db.query(
            "SELECT 1 FROM bitpos.mobile_sessions WHERE id=$1 AND access_hash=$2 AND revoked_at IS NULL",
            [
              actor.session,
              createHash("sha256").update(rotated.accessToken).digest("hex"),
            ],
          )
        ).rowCount;
        assert.ok(valid, "Export must match current persisted fixture session");
        actor.access = rotated.accessToken;
        actor.refresh = rotated.refreshToken;
        await save(dir, state);
        await command(adb, [
          "-s",
          "emulator-5554",
          "shell",
          "run-as",
          "com.bitpos.bitpos_" + app,
          "rm",
          sessionPath,
        ]);
      }
      assert.equal(code, 0, "Actual " + app + " " + stage + " UI failed");
      assert.ok(
        output.includes(
          "BITPOS_JOINED_" + app.toUpperCase() + "_" + stage + "_PASS",
        ),
        "Observed UI stage marker required",
      );
    } finally {
      await unlink(path);
    }
  }
  async function exported(app: "customer" | "driver") {
    const path = "code_cache/bitpos-joined-" + app + ".json";
    const bytes = await command(adb, [
      "-s",
      "emulator-5554",
      "exec-out",
      "run-as",
      "com.bitpos.bitpos_" + app,
      "cat",
      path,
    ]);
    try {
      return JSON.parse(bytes.toString());
    } finally {
      await command(adb, [
        "-s",
        "emulator-5554",
        "shell",
        "run-as",
        "com.bitpos.bitpos_" + app,
        "rm",
        path,
      ]);
    }
  }
  try {
    if (action === "restore-fixture-lifetime") {
      await ownOrder();
      assert.notEqual(state.stage, "FINISHED");
      // Disposable fixture only: process-local mocked secure storage lost rotated
      // credentials on a failed run. Never reuse its consumed refresh token.
      for (const actor of [
        state.customer,
        state.driverActor,
        state.dispatcher,
      ]) {
        const access = randomBytes(32).toString("base64url"),
          refresh = randomBytes(32).toString("base64url");
        const changed = await db.query(
          "UPDATE bitpos.mobile_sessions SET access_hash=$2,refresh_hash=$3,access_expires_at=least(clock_timestamp()+interval '4 hours',refresh_expires_at) WHERE id=$1 AND account_id=$4 AND device_id=$5 AND revoked_at IS NULL AND refresh_expires_at>clock_timestamp()",
          [
            actor.session,
            createHash("sha256").update(access).digest("hex"),
            createHash("sha256").update(refresh).digest("hex"),
            actor.account,
            actor.device,
          ],
        );
        assert.equal(changed.rowCount, 1);
        await db.query(
          "INSERT INTO bitpos.mobile_refresh_history(token_hash,session_id,consumed_at) VALUES($1,$2,NULL)",
          [createHash("sha256").update(refresh).digest("hex"), actor.session],
        );
        actor.access = access;
        actor.refresh = refresh;
        await save(dir, state);
      }
      const renewed = await db.query(
        "UPDATE bitpos.platform_staff_role_grants SET expires_at=clock_timestamp()+interval '4 hours' WHERE id=$1 AND account_id=$2 AND revoked_at IS NULL",
        [state.grant, state.dispatcher.account],
      );
      assert.equal(renewed.rowCount, 1);
      state.checks.push(
        "Explicit disposable-fixture session rekey and issuing grant lifetime restoration after elapsed debugging; not production authority behavior",
      );
    } else if (action === "customer-recover") {
      assert.equal(state.stage, "PREPARED");
      const originalCommand = await originalOwnedFoodCommand();
      await save(dir, state);
      await native("customer", "RECOVER", {
        BITPOS_TEST_PENDING_FOOD_COMMAND_BASE64: Buffer.from(
          JSON.stringify(originalCommand),
        ).toString("base64"),
      });
      const value = await exported("customer");
      assert.equal(
        value.orderId,
        state.orderId,
        "Recovery must export the existing order",
      );
      await ownOrder();
      const orders = await call(
        "/api/mobile/v1/food/orders",
        "GET",
        undefined,
        state.customer.access,
      );
      assert.equal(
        orders.orders.length,
        1,
        "Recovery must not create another order",
      );
      assert.equal(orders.orders[0].id, state.orderId);
      const order = await call(
        "/api/mobile/v1/food/orders/" + state.orderId,
        "GET",
        undefined,
        state.customer.access,
      );
      assert.equal(order.id, state.orderId);
      assert.equal(order.status, "AWAITING_WALLET");
      assert.equal(order.acceptanceStatus, "PENDING");
      assert.ok(order.delivery);
      await renewExpiredMerchantFixtureToken();
      state.shipmentId = (
        await call(
          "/api/orders/" + state.orderId + "/delivery",
          "GET",
          undefined,
          state.merchantToken,
        )
      ).shipmentId;
      state.stage = "CUSTOMER_CREATED";
      state.checks.push(
        "Actual customer root recovered the original committed command reconstructed into isolated mock storage; same owned order only, pending command cleared; not cross-process native secure-storage durability proof",
      );
    } else if (action === "customer-recover-negative") {
      assert.equal(state.stage, "CUSTOMER_CREATED");
      await ownOrder();
      const before = (
        await db.query(
          "SELECT acceptance_status,acceptance_version,acceptance_deadline<=clock_timestamp() AS deadline_elapsed FROM bitpos.online_food_orders WHERE merchant_id=$1 AND order_id=$2",
          [state.merchant, state.orderId],
        )
      ).rows[0];
      assert.deepEqual(
        {
          acceptance_status: before.acceptance_status,
          deadline_elapsed: before.deadline_elapsed,
        },
        { acceptance_status: "PENDING", deadline_elapsed: true },
      );
      const other = await call("/api/mobile/v1/auth/verify", "POST", {
        phone: "+66900000002",
        code: "123456",
        deviceId: randomUUID(),
      });
      await call(
        "/api/mobile/v1/food/orders/" + state.orderId,
        "GET",
        undefined,
        other.accessToken,
        404,
      );
      const acceptance = await call(
        "/api/orders/" + state.orderId + "/acceptance",
        "POST",
        {
          status: "ACCEPTED",
          expectedVersion: before.acceptance_version,
          idempotencyKey: randomUUID(),
          preparationMinutes: 15,
        },
        state.merchantToken,
        409,
      );
      assert.equal(acceptance.error?.code, "ACCEPTANCE_UNAVAILABLE");
      const command = await originalOwnedFoodCommand();
      const replay = await call(
        "/api/mobile/v1/food/orders",
        "POST",
        command,
        state.customer.access,
      );
      assert.equal(replay.replayed, true);
      assert.equal(replay.order.id, state.orderId);
      const after = (
        await db.query(
          "SELECT acceptance_status,acceptance_version,acceptance_deadline<=clock_timestamp() AS deadline_elapsed FROM bitpos.online_food_orders WHERE merchant_id=$1 AND order_id=$2",
          [state.merchant, state.orderId],
        )
      ).rows[0];
      assert.deepEqual(after, before);
      const count = (
        await db.query(
          "SELECT count(*)::int AS count FROM bitpos.online_food_orders WHERE merchant_id=$1 AND account_id=$2",
          [state.merchant, state.customer.account],
        )
      ).rows[0].count;
      assert.equal(count, 1);
      const evidence = {
        status: "PASS_W02_RECOVER_NEGATIVE_HTTP",
        orderId: state.orderId,
        wrongCustomerOrderRead: 404,
        expiredAcceptance: acceptance.error.code,
        exactReplay: true,
        ownedOrderCount: count,
        acceptanceUnchanged: true,
        physicalTesting: "deferred_by_user_2026-10-16",
      };
      const evidencePath = join(
        ".omp/work/flutter-delivery-20261016/evidence",
        "w02-recover-negative-" + stamp() + ".json",
      );
      await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
      console.log(JSON.stringify(evidence));
      state.checks.push(
        "Foreign customer order read denied; expired acceptance rejected without lifecycle rewrite; exact owner replay retained one order",
      );
      await save(dir, state);
    } else if (action === "customer-recover-tenant-negative") {
      assert.equal(state.stage, "CUSTOMER_CREATED");
      await ownOrder();
      const foreignMerchant = (
        await db.query(
          "SELECT id FROM bitpos.merchants WHERE id<>$1 ORDER BY id LIMIT 1",
          [state.merchant],
        )
      ).rows[0];
      assert.ok(foreignMerchant, "Separate fixture merchant required");
      const foreignActor = randomUUID();
      const staleAccount = randomUUID();
      const staleAccess = randomBytes(32).toString("base64url");
      const pool = new pg.Pool({
        connectionString:
          (OWN?"postgresql://cryptoclock@127.0.0.1:55440/bitpos_delivery_fixture":"postgresql://cryptoclock@127.0.0.1:55446/bitpos_w01_fixture"),
        options: "-c search_path=bitpos,public",
      });
      try {
        const foreignToken = await staffToken(
          pool,
          foreignMerchant.id,
          foreignActor,
          "owner",
        );
        await call(
          "/api/orders/" + state.orderId + "/delivery",
          "GET",
          undefined,
          foreignToken,
          404,
        );
        await db.query(
          "INSERT INTO bitpos.mobile_accounts(id,auth_subject) VALUES($1,$1)",
          [staleAccount],
        );
        await db.query(
          "INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day')",
          [
            randomUUID(),
            staleAccount,
            randomUUID(),
            createHash("sha256").update(staleAccess).digest("hex"),
            createHash("sha256").update(randomBytes(32)).digest("hex"),
          ],
        );
        await call(
          "/api/mobile/v1/food/orders/" + state.orderId,
          "GET",
          undefined,
          staleAccess,
          401,
        );
      } finally {
        await pool.end();
        await db.query(
          "DELETE FROM bitpos.sessions WHERE merchant_id=$1 AND user_id=$2",
          [foreignMerchant.id, foreignActor],
        );
        await db.query(
          "DELETE FROM bitpos.members WHERE merchant_id=$1 AND user_id=$2",
          [foreignMerchant.id, foreignActor],
        );
        await db.query(
          "DELETE FROM bitpos.mobile_sessions WHERE account_id=$1",
          [staleAccount],
        );
        await db.query("DELETE FROM bitpos.mobile_accounts WHERE id=$1", [
          staleAccount,
        ]);
      }
      const evidence = {
        status: "PASS_W02_RECOVER_TENANT_NEGATIVE_HTTP",
        orderId: state.orderId,
        foreignMerchantDeliveryRead: 404,
        staleCustomerOrderRead: 401,
        syntheticCredentialsCleaned: true,
        physicalTesting: "deferred_by_user_2026-10-16",
      };
      const evidencePath = join(
        ".omp/work/flutter-delivery-20261016/evidence",
        "w02-recover-tenant-negative-" + stamp() + ".json",
      );
      await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
      console.log(JSON.stringify(evidence));
      state.checks.push(
        "Foreign tenant owner cannot read shipment; expired synthetic customer cannot read owned order",
      );
      await save(dir, state);
    } else if (action === "customer-recover-auth-boundary-negative") {
      assert.equal(state.stage, "CUSTOMER_CREATED");
      const actor = randomUUID();
      const expired = randomBytes(32).toString("base64url");
      try {
        await db.query(
          "INSERT INTO bitpos.sessions(token_hash,user_id,merchant_id,role,expires_at) VALUES($1,$2,$3,'owner',clock_timestamp()-interval '1 minute')",
          [
            createHash("sha256").update(expired).digest("hex"),
            actor,
            state.merchant,
          ],
        );
        await assert.rejects(
          mintCurrentOwnerMerchantFixtureToken(expired),
          /Current merchant membership must remain owner/,
        );
        await db.query(
          "INSERT INTO bitpos.members(user_id,merchant_id,role) VALUES($1,$2,'manager')",
          [actor, state.merchant],
        );
        await assert.rejects(
          mintCurrentOwnerMerchantFixtureToken(expired),
          /Current merchant membership must remain owner/,
        );
        const count = (
          await db.query(
            "SELECT count(*)::int AS count FROM bitpos.sessions WHERE merchant_id=$1 AND user_id=$2",
            [state.merchant, actor],
          )
        ).rows[0].count;
        assert.equal(count, 1, "Refusals must not mint a replacement session");
      } finally {
        await db.query(
          "DELETE FROM bitpos.sessions WHERE merchant_id=$1 AND user_id=$2",
          [state.merchant, actor],
        );
        await db.query(
          "DELETE FROM bitpos.members WHERE merchant_id=$1 AND user_id=$2",
          [state.merchant, actor],
        );
      }
      const evidence = {
        status: "PASS_W02_RECOVER_AUTH_BOUNDARY_NEGATIVE",
        missingCurrentOwnerMembership: "refused",
        downgradedCurrentMembership: "refused",
        replacementSessionMinted: false,
        syntheticCredentialsCleaned: true,
      };
      const evidencePath = join(
        ".omp/work/flutter-delivery-20261016/evidence",
        "w02-recover-auth-boundary-" + stamp() + ".json",
      );
      await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
      console.log(JSON.stringify(evidence));
      await save(dir, state);
    } else if (action === "customer-recover-selection-negative") {
      assert.equal(state.stage, "CUSTOMER_CREATED");
      const command = await originalOwnedFoodCommand();
      const known = {...command, id: state.orderId!};
      assert.throws(
        () =>
          selectOriginalOwnedFoodCommand([
            known,
            {...known, id: randomUUID()},
          ]),
        /exactly one owned online order/,
      );
      assert.throws(
        () =>
          selectOriginalOwnedFoodCommand([{...known, id: randomUUID()}]),
        /retain its known original order/,
      );
      const evidence = {
        status: "PASS_W02_RECOVER_SELECTION_NEGATIVE",
        knownOrderId: state.orderId,
        ambiguousCandidates: "refused-before-effect",
        mismatchedKnownCandidate: "refused-before-effect",
      };
      const evidencePath = join(
        ".omp/work/flutter-delivery-20261016/evidence",
        "w02-recover-selection-" + stamp() + ".json",
      );
      await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
      console.log(JSON.stringify(evidence));
      await save(dir, state);
    } else if (action === "customer-create") {
      assert.equal(state.stage, "PREPARED");
      await native("customer", "CREATE");
      const value = await exported("customer");
      assert.match(value.orderId, /^[0-9a-f-]{36}$/);
      state.orderId = value.orderId;
      await ownOrder();
      const order = await call(
        "/api/mobile/v1/food/orders/" + state.orderId,
        "GET",
        undefined,
        state.customer.access,
      );
      assert.equal(order.total.amountMinor, "390");
      assert.ok(order.delivery);
      assert.notEqual(order.status, "PAID");
      state.shipmentId = (
        await call(
          "/api/orders/" + state.orderId + "/delivery",
          "GET",
          undefined,
          state.merchantToken,
        )
      ).shipmentId;
      state.stage = "CUSTOMER_CREATED";
      state.checks.push(
        "Actual customer root menu/cart/canonical quote/order UI created same owned delivery order390",
      );
    } else if (action === "settle") {
      assert.equal(state.stage, "CUSTOMER_CREATED");
      await ownOrder();
      const accepted = (
        await db.query(
          "SELECT acceptance_status FROM bitpos.online_food_orders WHERE order_id=$1",
          [state.orderId],
        )
      ).rows[0];
      assert.equal(
        accepted?.acceptance_status,
        "ACCEPTED",
        "Merchant must accept through actual POS UI before fixture settlement",
      );
      Object.assign(process.env, {
        DATABASE_URL:
          (OWN?"postgresql://bitpos_app@127.0.0.1:55440/bitpos_delivery_fixture":"postgresql://bitpos_app@127.0.0.1:55446/bitpos_w01_fixture"),
        ADMIN_DATABASE_URL:
          (OWN?"postgresql://cryptoclock@127.0.0.1:55440/bitpos_delivery_fixture":"postgresql://cryptoclock@127.0.0.1:55446/bitpos_w01_fixture"),
        DOTENV_CONFIG_PATH: "/dev/null",
        APP_SECRET: "fixture-only-not-a-real-secret-000000",
        AUTH_URL: (OWN?"http://127.0.0.1:55437":"http://127.0.0.1:55447"),
        AUTH_ANON_KEY: "fixture-no-provider-key",
        PUBLIC_URL: "http://127.0.0.1:4391",
        SOLANA_RPC: "https://api.devnet.solana.com",
        DEVNET_PRIVATE_DIR: join(dir, "no-wallets"),
      });
      const { fixturePaymentAttempt } =
        await import("../../tests/backend-payment-fixture");
      const { settleAttempt } = await import("../../apps/api/src/orders");
      const { pool } = await import("../../apps/api/src/db");
      try {
        await db.query("BEGIN");
        await db.query("SET LOCAL search_path=bitpos,public");
        await db.query("SELECT set_config('bitpos.merchant',$1,true)", [
          state.merchant,
        ]);
        const attempt = (
          await fixturePaymentAttempt(db, {
            merchant: state.merchant,
            order: state.orderId!,
            status: "SUBMITTED",
            signature: "W02-JOINED-UI-SQL-FIXTURE-" + randomUUID(),
          })
        ).rows[0];
        await settleAttempt(db as unknown as pg.PoolClient, attempt, true);
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        await pool.end();
      }
      state.stage = "FIXTURE_SETTLED";
      state.checks.push(
        "Actual POS accepted same order before SQL-only synthetic finalized payment seam; not chain/provider verification",
      );
    } else if (action === "offer") {
      assert.equal(state.stage, "FIXTURE_SETTLED");
      await ownOrder();
      const kitchen = (
        await db.query(
          "SELECT status FROM bitpos.order_fulfillment WHERE order_id=$1",
          [state.orderId],
        )
      ).rows[0];
      assert.equal(
        kitchen.status,
        "READY",
        "Actual POS must prepare and ready order",
      );
      await db.query(
        "UPDATE bitpos.driver_availability SET requested_online=true,heartbeat_expires_at=clock_timestamp()+interval '90 seconds' WHERE driver_id=$1",
        [state.driver],
      );
      await call(
        `/api/mobile/v1/platform/merchants/${state.merchant}/branches/${state.branch}/drivers/${state.driver}/food-service`,
        "PUT",
        {
          idempotencyKey: randomUUID(),
          expectedVersion: "0",
          enabled: true,
          validUntil: new Date(Date.now() + 3600000).toISOString(),
          reason: "W02 local joined UI synthetic service authority",
        },
        state.dispatcher.access,
      );
      state.stage = "WAITING_FOR_CLAIM";
      state.checks.push(
        "Actual POS same-order PREPARING→READY persisted; no merchant fake DELIVERED",
      );
    } else if (action === "driver-claim") {
      assert.equal(state.stage, "WAITING_FOR_CLAIM");
      await ownOrder();
      // A native run may fail after claim commits. Recover only this owned
      // shipment/driver; never create a second offer or discard the assignment.
      const recovered = (
        await db.query(
          "SELECT id,offer_id FROM bitpos.food_assignments WHERE shipment_id=$1 AND driver_id=$2 AND closed_at IS NULL",
          [state.shipmentId, state.driver],
        )
      ).rows;
      assert.ok(recovered.length <= 1);
      if (recovered.length) {
        state.assignmentId = recovered[0].id;
        state.offerId = recovered[0].offer_id;
        await save(dir, state);
      }
      await native("driver", "CLAIM", {}, async () => {
        await db.query(
          "UPDATE bitpos.driver_availability SET requested_online=true,heartbeat_expires_at=clock_timestamp()+interval '90 seconds' WHERE driver_id=$1",
          [state.driver],
        );
        const work = await call(
          "/api/orders/" + state.orderId + "/delivery",
          "GET",
          undefined,
          state.merchantToken,
        );
        const offer = await call(
          "/api/mobile/v1/platform/food/shipments/" +
            state.shipmentId +
            "/offers",
          "POST",
          {
            idempotencyKey: randomUUID(),
            expectedVersion: work.version,
            driverId: state.driver,
          },
          state.dispatcher.access,
        );
        state.offerId = offer.offerId;
        await save(dir, state);
      });
      const value = await exported("driver");
      assert.equal(value.offerId, state.offerId);
      state.assignmentId = value.assignmentId;
      const actual = await call(
        "/api/mobile/v1/driver/food/work",
        "GET",
        undefined,
        state.driverActor.access,
      );
      assert.equal(actual.assignment.id, state.assignmentId);
      assert.equal(actual.assignment.state, "AT_PICKUP");
      state.generation = actual.assignment.generation;
      state.leaseGeneration = actual.assignment.leaseGeneration;
      state.stage = "AT_STORE";
      state.checks.push(
        "Actual rider root accepted canonical offer and arrived at store on same assignment",
      );
    } else if (action === "driver-pickup") {
      assert.equal(state.stage, "AT_STORE");
      const path = join(dir, "pickup-proof.json");
      const proof = JSON.parse(await readFile(path, "utf8"));
      assert.equal(proof.assignmentId, state.assignmentId);
      assert.match(proof.secret, /^[A-Za-z0-9_-]{43}$/);
      await native("driver", "PICKUP", {
        BITPOS_TEST_PICKUP_SECRET: proof.secret,
      });
      await unlink(path);
      state.stage = "AT_DESTINATION";
      state.checks.push(
        "Actual POS issued same-assignment pickup proof; actual rider custody UI consumed it and arrived at customer",
      );
    } else if (action === "customer-proof") {
      assert.equal(state.stage, "AT_DESTINATION");
      await native("customer", "PROOF");
      const proof = await exported("customer");
      assert.equal(proof.orderId, state.orderId);
      assert.match(proof.secret, /^[A-Za-z0-9_-]{43}$/);
      await writeFile(join(dir, "delivery-proof.json"), JSON.stringify(proof), {
        mode: 0o600,
        flag: "wx",
      });
      state.stage = "CUSTOMER_PROOF_ISSUED";
      state.checks.push(
        "Actual customer root same-order tracking UI issued customer delivery proof",
      );
    } else if (action === "driver-delivery") {
      assert.equal(state.stage, "CUSTOMER_PROOF_ISSUED");
      const path = join(dir, "delivery-proof.json");
      const proof = JSON.parse(await readFile(path, "utf8"));
      assert.equal(proof.orderId, state.orderId);
      assert.match(proof.secret, /^[A-Za-z0-9_-]{43}$/);
      const committed = (await db.query(
        "SELECT a.state,s.order_id FROM bitpos.food_assignments a JOIN bitpos.food_shipments s ON s.id=a.shipment_id WHERE a.id=$1 AND s.id=$2",
        [state.assignmentId,state.shipmentId],
      )).rows;
      assert.equal(committed.length,1);
      assert.equal(committed[0].order_id,state.orderId);
      if (committed[0].state === "DELIVERED") {
        state.checks.push("Recovered exact persisted DELIVERED assignment after native proof commit; retained obsolete wording assertion failure, no proof replay");
      } else {
        assert.equal(committed[0].state,"AT_DROPOFF");
        await native("driver", "DELIVERY", {
          BITPOS_TEST_DELIVERY_SECRET: proof.secret,
        });
      }
      await unlink(path);
      state.stage = "DELIVERED";
      state.checks.push(
        "Actual rider UI consumed actual customer-issued proof and observed canonical completion",
      );
    } else if (action === "finish") {
      assert.equal(state.stage, "DELIVERED");
      await native("customer", "DELIVERED");
      await ownOrder();
      const joined = (
        await db.query(
          "SELECT s.state shipment,f.status kitchen,a.state assignment,l.state lease,e.state earning,facts.amount_minor::text minor,(SELECT sum(debit_minor)::text FROM bitpos.ledger_entries WHERE transaction_id=e.ledger_transaction_id) debit,(SELECT sum(credit_minor)::text FROM bitpos.ledger_entries WHERE transaction_id=e.ledger_transaction_id) credit FROM bitpos.food_shipments s JOIN bitpos.order_fulfillment f ON f.order_id=s.order_id JOIN bitpos.food_assignments a ON a.shipment_id=s.id JOIN bitpos.driver_assignment_leases l ON l.id=a.lease_id JOIN bitpos.earning_accruals e ON e.food_assignment_id=a.id JOIN bitpos.earning_accrual_facts facts ON facts.accrual_id=e.id WHERE s.id=$1",
          [state.shipmentId],
        )
      ).rows;
      assert.deepEqual(joined, [
        {
          shipment: "DELIVERED",
          kitchen: "COLLECTED",
          assignment: "DELIVERED",
          lease: "RELEASED",
          earning: "ACCRUED",
          minor: "100",
          debit: "100",
          credit: "100",
        },
      ]);
      await db.query(
        "UPDATE bitpos.mobile_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=ANY($1::uuid[])",
        [
          [
            state.customer.session,
            state.driverActor.session,
            state.dispatcher.session,
          ],
        ],
      );
      await db.query(
        "UPDATE bitpos.platform_staff_role_grants SET revoked_at=clock_timestamp() WHERE id=$1",
        [state.grant],
      );
      await db.query(
        "UPDATE bitpos.driver_availability SET requested_online=false WHERE driver_id=$1",
        [state.driver],
      );
      await db.query(
        "UPDATE bitpos.marketplace_branches SET enabled=false WHERE merchant_id=$1",
        [state.merchant],
      );
      await call("/api/session", "DELETE", undefined, state.merchantToken);
      state.stage = "FINISHED";
      state.checks.push(
        "Actual customer same-order delivered snapshot and normal Back; persisted balanced earning obligation, not payout",
      );
      const evidence =
        ".omp/work/flutter-delivery-20261016/evidence/w02-same-order-ui-" +
        stamp() +
        ".json";
      await writeFile(
        evidence,
        JSON.stringify(
          {
            status: "PASS_SAME_ORDER_CUSTOMER_POS_RIDER_UI_DELIVERY",
            checkedAtUtc: new Date().toISOString(),
            orderId: state.orderId,
            shipmentId: state.shipmentId,
            assignmentId: state.assignmentId,
            checks: state.checks,
            joined,
            physicalTesting: "deferred_by_user_2026-10-16",
            limits: [
              "Synthetic local identities/documents/address and SQL payment seam; no chain/provider payment or payout transfer",
              "No physical delivery/GPS/field acceptance",
              "Not full W02/P0-P6 acceptance",
            ],
          },
          null,
          2,
        ) + "\n",
        { flag: "wx" },
      );
      console.log(JSON.stringify({ evidence }));
    } else throw Error("Unknown joined UI action");
    await save(dir, state);
    console.log(
      JSON.stringify({
        status: "PASS_STAGE",
        stage: state.stage,
        orderId: state.orderId,
        shipmentId: state.shipmentId,
        assignmentId: state.assignmentId,
      }),
    );
  } catch (error) {
    await writeFile(
      ".omp/work/flutter-delivery-20261016/evidence/w02-same-order-ui-failure-" +
        stamp() +
        ".json",
      JSON.stringify(
        {
          status: "FAIL",
          action,
          stage: state.stage,
          orderId: state.orderId ?? null,
          error:
            error instanceof assert.AssertionError
              ? error.message
              : error instanceof Error
                ? error.message
                : "unknown",
          limits: ["Failure retained; no joined acceptance"],
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    throw error;
  } finally {
    await db.end();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
)
  await main();
