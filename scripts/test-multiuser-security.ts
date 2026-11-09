import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { prisma } from "../lib/prisma";
import { encryptedPassword } from "../lib/email/mailbox-service";

const BASE_URL = "http://127.0.0.1:3000";

interface TestContext {
  userA: { id: string; email: string; cookie: string };
  userB: { id: string; email: string; cookie: string };
  mailboxA: { id: string; email: string };
  mailboxB: { id: string; email: string };
  contactA: { id: string; email: string };
  contactB: { id: string; email: string };
  templateA: { id: string; name: string };
  templateB: { id: string; name: string };
  campaignA: { id: string; name: string };
  campaignB: { id: string; name: string };
  messageA: { id: string };
  messageB: { id: string };
}

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passCount++;
  } else {
    console.error(`  ✗ FAIL: ${testName} ${detail ? `(${detail})` : ""}`);
    failCount++;
  }
}

function extractSessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie") || "";
  const match = setCookie.match(/outreach_session=([^;]+)/);
  if (!match) throw new Error("outreach_session cookie not found in response headers");
  return `outreach_session=${match[1]}`;
}

async function cleanupTestData(emailA: string, emailB: string) {
  const users = await prisma.user.findMany({
    where: { email: { in: [emailA, emailB] } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);

  if (userIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.scheduledJob.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.emailLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.emailMessage.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.campaignRecipient.deleteMany({
      where: { campaign: { userId: { in: userIds } } },
    });
    await prisma.campaign.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.template.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.contact.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.mailbox.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

async function runSecuritySuite() {
  console.log("\n========================================================");
  console.log("   MULTI-USER SECURITY & DATA ISOLATION TEST SUITE");
  console.log("========================================================\n");

  const emailA = "test_user_a_sec@farani.test";
  const emailB = "test_user_b_sec@farani.test";
  const passA = "PasswordA123!";
  const passB = "PasswordB123!";

  console.log("[1/8] Cleaning up existing test records if any...");
  await cleanupTestData(emailA, emailB);

  console.log("[2/8] Creating and authenticating User A and User B via /api/auth/signup & login...");
  
  // 1. Signup User A
  const signupResA = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "User A (Security Test)", email: emailA, password: passA }),
  });
  assert(signupResA.status === 201, "User A signup returns 201 Created");
  const cookieA = extractSessionCookie(signupResA);

  // 2. Signup User B
  const signupResB = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "User B (Security Test)", email: emailB, password: passB }),
  });
  assert(signupResB.status === 201, "User B signup returns 201 Created");
  const cookieB = extractSessionCookie(signupResB);

  // Verify /api/auth/me for both users
  const meA = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Cookie: cookieA } });
  const meAData = await meA.json();
  assert(meA.status === 200 && meAData.user?.email === emailA, "User A /api/auth/me identifies correct user");

  const meB = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Cookie: cookieB } });
  const meBData = await meB.json();
  assert(meB.status === 200 && meBData.user?.email === emailB, "User B /api/auth/me identifies correct user");

  const userIdA = meAData.user.id;
  const userIdB = meBData.user.id;

  console.log(`\n  User A: ${userIdA} (${emailA})`);
  console.log(`  User B: ${userIdB} (${emailB})`);

  console.log("\n[3/8] Provisioning private workspace resources for User A and User B...");
  // Mailbox A
  const mbA = await prisma.mailbox.create({
    data: {
      userId: userIdA,
      emailAddress: "box_a@farani.test",
      displayName: "Box A",
      smtpHost: "smtp.hostinger.com",
      smtpPort: 465,
      smtpSecurity: "SSL",
      imapHost: "imap.hostinger.com",
      imapPort: 993,
      imapSecurity: "SSL",
      status: "ACTIVE",
      smtpStatus: "CONNECTED",
      imapStatus: "CONNECTED",
      encryptedCredentials: encryptedPassword("dummyPasswordA"),
    },
  });

  // Mailbox B
  const mbB = await prisma.mailbox.create({
    data: {
      userId: userIdB,
      emailAddress: "box_b@farani.test",
      displayName: "Box B",
      smtpHost: "smtp.hostinger.com",
      smtpPort: 465,
      smtpSecurity: "SSL",
      imapHost: "imap.hostinger.com",
      imapPort: 993,
      imapSecurity: "SSL",
      status: "ACTIVE",
      smtpStatus: "CONNECTED",
      imapStatus: "CONNECTED",
      encryptedCredentials: encryptedPassword("dummyPasswordB"),
    },
  });

  // Contact A
  const contA = await prisma.contact.create({
    data: {
      userId: userIdA,
      name: "Contact of User A",
      email: "contact_a@target.test",
      companyName: "Target A Corp",
    },
  });

  // Contact B
  const contB = await prisma.contact.create({
    data: {
      userId: userIdB,
      name: "Contact of User B",
      email: "contact_b@target.test",
      companyName: "Target B Corp",
    },
  });

  // Template A
  const tplA = await prisma.template.create({
    data: {
      userId: userIdA,
      name: "Private Template A",
      subject: "Hello from A {{brandName}}",
      body: "Secret content of User A",
      status: "ACTIVE",
    },
  });

  // Template B
  const tplB = await prisma.template.create({
    data: {
      userId: userIdB,
      name: "Private Template B",
      subject: "Hello from B {{brandName}}",
      body: "Secret content of User B",
      status: "ACTIVE",
    },
  });

  // Campaign A
  const campA = await prisma.campaign.create({
    data: {
      userId: userIdA,
      name: "Campaign of User A",
      mailboxId: mbA.id,
      templateId: tplA.id,
      status: "DRAFT",
    },
  });

  // Campaign B
  const campB = await prisma.campaign.create({
    data: {
      userId: userIdB,
      name: "Campaign of User B",
      mailboxId: mbB.id,
      templateId: tplB.id,
      status: "DRAFT",
    },
  });

  // Message A
  const msgA = await prisma.emailMessage.create({
    data: {
      userId: userIdA,
      mailboxId: mbA.id,
      campaignId: campA.id,
      contactId: contA.id,
      fromAddress: mbA.emailAddress,
      toAddress: contA.email,
      subject: "Private Inbox Item A",
      body: "Private body A",
      status: "SENT",
      direction: "INBOUND",
    },
  });

  // Message B
  const msgB = await prisma.emailMessage.create({
    data: {
      userId: userIdB,
      mailboxId: mbB.id,
      campaignId: campB.id,
      contactId: contB.id,
      fromAddress: mbB.emailAddress,
      toAddress: contB.email,
      subject: "Confidential Inbox Item B",
      body: "Confidential body B",
      status: "SENT",
      direction: "INBOUND",
    },
  });

  console.log("\n[4/8] Running Tenant Isolation & IDOR Attacks...");

  // ---------------------------------------------------------
  // A. Mailboxes Isolation
  // ---------------------------------------------------------
  console.log("\n  --- [A] Mailbox Resource Isolation ---");
  const mbListA = await (await fetch(`${BASE_URL}/api/mailboxes`, { headers: { Cookie: cookieA } })).json();
  const mbListB = await (await fetch(`${BASE_URL}/api/mailboxes`, { headers: { Cookie: cookieB } })).json();

  assert(
    mbListA.mailboxes.some((m: any) => m.id === mbA.id) && !mbListA.mailboxes.some((m: any) => m.id === mbB.id),
    "User A mailbox list contains only Mailbox A, zero exposure of Mailbox B"
  );
  assert(
    mbListB.mailboxes.some((m: any) => m.id === mbB.id) && !mbListB.mailboxes.some((m: any) => m.id === mbA.id),
    "User B mailbox list contains only Mailbox B, zero exposure of Mailbox A"
  );

  // User A tries to GET User B's mailbox directly
  const idorMbGet = await fetch(`${BASE_URL}/api/mailboxes/${mbB.id}`, { headers: { Cookie: cookieA } });
  assert(idorMbGet.status === 404, `User A accessing User B's mailbox returns 404 Not Found (got ${idorMbGet.status})`);

  // User A tries to PATCH User B's mailbox
  const idorMbPatch = await fetch(`${BASE_URL}/api/mailboxes/${mbB.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookieA },
    body: JSON.stringify({ displayName: "Hacked by A" }),
  });
  assert(idorMbPatch.status === 404, `User A modifying User B's mailbox returns 404 Not Found (got ${idorMbPatch.status})`);

  // User A tries to DELETE User B's mailbox
  const idorMbDelete = await fetch(`${BASE_URL}/api/mailboxes/${mbB.id}`, {
    method: "DELETE",
    headers: { Cookie: cookieA },
  });
  assert(idorMbDelete.status === 404, `User A deleting User B's mailbox returns 404 Not Found (got ${idorMbDelete.status})`);

  // User A tries to trigger test on User B's mailbox
  const idorMbTest = await fetch(`${BASE_URL}/api/mailboxes/${mbB.id}/test`, {
    method: "POST",
    headers: { Cookie: cookieA },
  });
  assert(idorMbTest.status === 404, `User A testing User B's mailbox returns 404 Not Found (got ${idorMbTest.status})`);

  // Verify credentials never exposed
  assert(
    mbListA.mailboxes.every((m: any) => !m.encryptedCredentials && !m.password),
    "Mailbox API never exposes encryptedCredentials or passwords"
  );

  // ---------------------------------------------------------
  // B. Contacts Isolation
  // ---------------------------------------------------------
  console.log("\n  --- [B] Contact Resource Isolation ---");
  const contListA = await (await fetch(`${BASE_URL}/api/contacts`, { headers: { Cookie: cookieA } })).json();
  const contListB = await (await fetch(`${BASE_URL}/api/contacts`, { headers: { Cookie: cookieB } })).json();

  assert(
    contListA.contacts.some((c: any) => c.id === contA.id) && !contListA.contacts.some((c: any) => c.id === contB.id),
    "User A contacts list contains only Contact A, zero exposure of Contact B"
  );
  assert(
    contListB.contacts.some((c: any) => c.id === contB.id) && !contListB.contacts.some((c: any) => c.id === contA.id),
    "User B contacts list contains only Contact B, zero exposure of Contact A"
  );

  const idorContGet = await fetch(`${BASE_URL}/api/contacts/${contB.id}`, { headers: { Cookie: cookieA } });
  assert(idorContGet.status === 404, `User A accessing User B's contact returns 404 Not Found (got ${idorContGet.status})`);

  const idorContPatch = await fetch(`${BASE_URL}/api/contacts/${contB.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookieA },
    body: JSON.stringify({ name: "Hacked Contact" }),
  });
  assert(idorContPatch.status === 404, `User A updating User B's contact returns 404 Not Found (got ${idorContPatch.status})`);

  const idorContDel = await fetch(`${BASE_URL}/api/contacts/${contB.id}`, {
    method: "DELETE",
    headers: { Cookie: cookieA },
  });
  assert(idorContDel.status === 404, `User A deleting User B's contact returns 404 Not Found (got ${idorContDel.status})`);

  // ---------------------------------------------------------
  // C. Templates Isolation
  // ---------------------------------------------------------
  console.log("\n  --- [C] Template Resource Isolation ---");
  const tplListA = await (await fetch(`${BASE_URL}/api/templates`, { headers: { Cookie: cookieA } })).json();
  const tplListB = await (await fetch(`${BASE_URL}/api/templates`, { headers: { Cookie: cookieB } })).json();

  assert(
    tplListA.templates.some((t: any) => t.id === tplA.id) && !tplListA.templates.some((t: any) => t.id === tplB.id),
    "User A templates list contains only Template A, zero exposure of Template B"
  );
  assert(
    tplListB.templates.some((t: any) => t.id === tplB.id) && !tplListB.templates.some((t: any) => t.id === tplA.id),
    "User B templates list contains only Template B, zero exposure of Template A"
  );

  const idorTplGet = await fetch(`${BASE_URL}/api/templates/${tplB.id}`, { headers: { Cookie: cookieA } });
  assert(idorTplGet.status === 404, `User A accessing User B's template returns 404 Not Found (got ${idorTplGet.status})`);

  const idorTplPatch = await fetch(`${BASE_URL}/api/templates/${tplB.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookieA },
    body: JSON.stringify({ name: "Hacked Template" }),
  });
  assert(idorTplPatch.status === 404, `User A modifying User B's template returns 404 Not Found (got ${idorTplPatch.status})`);

  const idorTplDel = await fetch(`${BASE_URL}/api/templates/${tplB.id}`, {
    method: "DELETE",
    headers: { Cookie: cookieA },
  });
  assert(idorTplDel.status === 404, `User A deleting User B's template returns 404 Not Found (got ${idorTplDel.status})`);

  // ---------------------------------------------------------
  // D. Campaigns & Cross-User Mailbox Injection Isolation
  // ---------------------------------------------------------
  console.log("\n  --- [D] Campaign Resource Isolation & Injection Prevention ---");
  const campListA = await (await fetch(`${BASE_URL}/api/campaigns`, { headers: { Cookie: cookieA } })).json();
  const campListB = await (await fetch(`${BASE_URL}/api/campaigns`, { headers: { Cookie: cookieB } })).json();

  assert(
    campListA.campaigns.some((c: any) => c.id === campA.id) && !campListA.campaigns.some((c: any) => c.id === campB.id),
    "User A campaigns list contains only Campaign A, zero exposure of Campaign B"
  );
  assert(
    campListB.campaigns.some((c: any) => c.id === campB.id) && !campListB.campaigns.some((c: any) => c.id === campA.id),
    "User B campaigns list contains only Campaign B, zero exposure of Campaign A"
  );

  const idorCampGet = await fetch(`${BASE_URL}/api/campaigns/${campB.id}`, { headers: { Cookie: cookieA } });
  assert(idorCampGet.status === 404, `User A accessing User B's campaign returns 404 Not Found (got ${idorCampGet.status})`);

  // Cross-user mailbox injection test: User A attempts to forward a campaign using User B's mailbox
  const injectionForward = await fetch(`${BASE_URL}/api/campaigns/${campA.id}/forward`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieA },
    body: JSON.stringify({
      mailboxId: mbB.id, // User B's mailbox injected!
      mode: "sendNow",
      recipientIds: [],
    }),
  });
  assert(
    injectionForward.status === 403,
    `User A forwarding campaign using User B's mailbox is blocked with 403 Forbidden (got ${injectionForward.status})`
  );

  // ---------------------------------------------------------
  // E. Inbox & Messages Isolation
  // ---------------------------------------------------------
  console.log("\n  --- [E] Inbox & Message Isolation ---");
  // User A requests inbox with User A's mailbox
  const inboxResA = await fetch(`${BASE_URL}/api/inbox?folder=inbox&mailboxId=${mbA.id}`, {
    headers: { Cookie: cookieA },
  });
  const inboxDataA = await inboxResA.json();
  assert(
    inboxResA.status === 200 && inboxDataA.messages.some((m: any) => m.id === msgA.id),
    "User A successfully views User A's inbox messages"
  );

  // User A requests inbox with User B's mailbox ID -> Must return 403 Forbidden!
  const inboxSteal = await fetch(`${BASE_URL}/api/inbox?folder=inbox&mailboxId=${mbB.id}`, {
    headers: { Cookie: cookieA },
  });
  assert(
    inboxSteal.status === 403,
    `User A attempting to query User B's mailbox messages is blocked with 403 Forbidden (got ${inboxSteal.status})`
  );

  // ---------------------------------------------------------
  // F. Session Invalidation & Logout
  // ---------------------------------------------------------
  console.log("\n[5/8] Testing Session Revocation on Logout...");
  const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: cookieA },
  });
  assert(logoutRes.status === 200, "User A logout returns 200 OK");

  // Attempting to access protected resource with the revoked token must return 401
  const afterLogoutRes = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Cookie: cookieA },
  });
  assert(
    afterLogoutRes.status === 401,
    `Post-logout request with previous session token is rejected with 401 Unauthorized (got ${afterLogoutRes.status})`
  );

  // ---------------------------------------------------------
  // G. Rate Limiting Protection
  // ---------------------------------------------------------
  console.log("\n[6/8] Testing Authentication Rate Limiting...");
  let rateLimited = false;
  const bruteForceTarget = "bruteforce_target@farani.test";
  for (let i = 1; i <= 6; i++) {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: bruteForceTarget, password: "WrongPassword999!" }),
    });
    if (res.status === 429) {
      rateLimited = true;
      console.log(`  Rate limit hit at attempt ${i} (Status: 429)`);
      break;
    }
  }
  assert(rateLimited, "Rate limiter triggers 429 Too Many Requests after excessive failed login attempts");

  // ---------------------------------------------------------
  // H. Password Reset 2-Step OTP Security Flow
  // ---------------------------------------------------------
  console.log("\n[7/8] Testing Password Reset Security Flow...");
  // Step 1: Request reset code for User B
  const resetReq = await fetch(`${BASE_URL}/api/auth/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: emailB }),
  });
  const resetReqData = await resetReq.json();
  assert(resetReq.status === 200, "Password reset request returns 200 OK");

  // Read generated reset code from DB
  const userBInDb = await prisma.user.findUnique({ where: { email: emailB } });
  assert(Boolean(userBInDb?.resetCode), "Cryptographically secure reset code generated and saved to DB");

  // Step 2: Try with wrong code -> Should fail
  const wrongCodeRes = await fetch(`${BASE_URL}/api/auth/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: emailB, code: "000000", password: "NewPassword123!" }),
  });
  assert(wrongCodeRes.status === 400, "Submitting invalid reset code is rejected with 400 Bad Request");

  // Step 3: Complete reset with correct code
  const correctCodeRes = await fetch(`${BASE_URL}/api/auth/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: emailB, code: userBInDb!.resetCode!, password: "NewPasswordB123!" }),
  });
  assert(correctCodeRes.status === 200, "Resetting password with valid OTP code succeeds (200 OK)");

  // Verify old User B session cookie is invalidated because tokenVersion incremented
  const oldSessionMe = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Cookie: cookieB } });
  assert(
    oldSessionMe.status === 401,
    `Password reset invalidates all existing user sessions server-wide (got ${oldSessionMe.status})`
  );

  // ---------------------------------------------------------
  // I. Security Audit Logging
  // ---------------------------------------------------------
  console.log("\n[8/8] Verifying Security Audit Log entries...");
  const auditLogs = await prisma.auditLog.findMany({
    where: { userId: { in: [userIdA, userIdB] } },
    orderBy: { createdAt: "asc" },
  });
  assert(auditLogs.length > 0, `Audit log records captured (${auditLogs.length} events logged)`);
  const actionsLogged = auditLogs.map((l) => l.action);
  console.log(`  Actions recorded: ${[...new Set(actionsLogged)].join(", ")}`);
  assert(actionsLogged.includes("SIGNUP_SUCCESS"), "SIGNUP_SUCCESS event recorded in AuditLog");
  assert(actionsLogged.includes("LOGOUT"), "LOGOUT event recorded in AuditLog");
  assert(actionsLogged.includes("PASSWORD_RESET_SUCCESS"), "PASSWORD_RESET_SUCCESS event recorded in AuditLog");

  console.log("\n========================================================");
  console.log(`TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("========================================================\n");

  console.log("Cleaning up test data...");
  await cleanupTestData(emailA, emailB);
  console.log("Cleanup complete.");

  await prisma.$disconnect();

  if (failCount > 0) {
    process.exit(1);
  }
}

runSecuritySuite().catch(async (e) => {
  console.error("Test execution fatal error:", e);
  await prisma.$disconnect();
  process.exit(1);
});
