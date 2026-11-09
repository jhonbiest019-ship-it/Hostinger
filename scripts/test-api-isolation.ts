import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { prisma } from "../lib/prisma";
import { createSessionToken } from "../lib/auth";

async function main() {
  console.log("=================================================");
  console.log("TESTING API ENDPOINTS & MAILBOX ISOLATION (HTTP)");
  console.log("=================================================\n");

  const user = await prisma.user.findFirst({
    where: { email: "jhonbiest019@gmail.com" },
  });
  if (!user) throw new Error("User jhonbiest019@gmail.com not found");

  const token = createSessionToken(user.id);
  const cookieHeader = `outreach_session=${token}`;

  const mailboxes = await prisma.mailbox.findMany({
    where: { userId: user.id },
    select: { id: true, emailAddress: true },
  });

  const mb1 = mailboxes[0];
  const mb2 = mailboxes[1];

  const baseUrl = "http://localhost:3000";

  // Test 1: Request without mailboxId
  console.log("TEST A: GET /api/inbox without mailboxId...");
  try {
    const resA = await fetch(`${baseUrl}/api/inbox?folder=inbox`, {
      headers: { Cookie: cookieHeader },
    });
    const dataA = await resA.json();
    console.log(`- Status: ${resA.status}`);
    console.log(`- Response: messages length = ${dataA.messages?.length}, requiresMailboxSelection = ${dataA.requiresMailboxSelection}`);
    if (resA.ok && dataA.messages?.length === 0 && dataA.requiresMailboxSelection === true) {
      console.log("=> TEST A PASSED: Empty state correctly returned when no mailbox is selected.\n");
    } else {
      console.error("=> TEST A FAILED: Unexpected response for missing mailboxId.\n");
    }
  } catch (err: any) {
    console.error("TEST A failed with error:", err.message);
  }

  // Test B: Request with Mailbox 1
  console.log(`TEST B: GET /api/inbox for Mailbox 1 (${mb1.emailAddress})...`);
  try {
    const resB = await fetch(`${baseUrl}/api/inbox?folder=inbox&mailboxId=${mb1.id}`, {
      headers: { Cookie: cookieHeader },
    });
    const dataB = await resB.json();
    console.log(`- Status: ${resB.status}`);
    console.log(`- Active Mailbox: ${dataB.activeMailbox?.emailAddress}`);
    console.log(`- Inbox Messages: ${dataB.messages?.length}`);
    console.log(`- Counts:`, JSON.stringify(dataB.counts));
    if (resB.ok && dataB.activeMailbox?.id === mb1.id && dataB.messages?.length === 0) {
      console.log("=> TEST B PASSED: Scoped strictly to Mailbox 1 with 0 legacy messages.\n");
    } else {
      console.error("=> TEST B FAILED!\n");
    }
  } catch (err: any) {
    console.error("TEST B failed with error:", err.message);
  }

  // Test C: Request with Mailbox 2
  console.log(`TEST C: GET /api/inbox for Mailbox 2 (${mb2.emailAddress})...`);
  try {
    const resC = await fetch(`${baseUrl}/api/inbox?folder=inbox&mailboxId=${mb2.id}`, {
      headers: { Cookie: cookieHeader },
    });
    const dataC = await resC.json();
    console.log(`- Status: ${resC.status}`);
    console.log(`- Active Mailbox: ${dataC.activeMailbox?.emailAddress}`);
    console.log(`- Inbox Messages: ${dataC.messages?.length}`);
    console.log(`- Counts:`, JSON.stringify(dataC.counts));
    if (resC.ok && dataC.activeMailbox?.id === mb2.id && dataC.messages?.length === 0) {
      console.log("=> TEST C PASSED: Scoped strictly to Mailbox 2 with 0 legacy messages.\n");
    } else {
      console.error("=> TEST C FAILED!\n");
    }
  } catch (err: any) {
    console.error("TEST C failed with error:", err.message);
  }

  // Test D: Sent folder test
  console.log(`TEST D: GET /api/inbox?folder=sent for Mailbox 1 (${mb1.emailAddress})...`);
  try {
    const resD = await fetch(`${baseUrl}/api/inbox?folder=sent&mailboxId=${mb1.id}`, {
      headers: { Cookie: cookieHeader },
    });
    const dataD = await resD.json();
    console.log(`- Status: ${resD.status}`);
    console.log(`- Sent Messages: ${dataD.messages?.length}`);
    if (resD.ok && dataD.messages?.length === 0) {
      console.log("=> TEST D PASSED: Sent folder is clean with 0 messages.\n");
    } else {
      console.error("=> TEST D FAILED!\n");
    }
  } catch (err: any) {
    console.error("TEST D failed with error:", err.message);
  }

  // Test E: Request with Unauthorized / Foreign Mailbox ID
  console.log("TEST E: GET /api/inbox with invalid/unowned mailboxId...");
  try {
    const resE = await fetch(`${baseUrl}/api/inbox?folder=inbox&mailboxId=unauthorized_mailbox_123`, {
      headers: { Cookie: cookieHeader },
    });
    console.log(`- Status: ${resE.status} (Expected: 403)`);
    if (resE.status === 403) {
      console.log("=> TEST E PASSED: Server correctly rejected unauthorized mailbox ID with 403 Forbidden.\n");
    } else {
      console.error("=> TEST E FAILED: Expected 403, got:", resE.status);
    }
  } catch (err: any) {
    console.error("TEST E failed with error:", err.message);
  }

  // Test F: Mark all as read scoped to Mailbox 1
  console.log("TEST F: POST /api/inbox/read (mark all read scoped to mb1)...");
  try {
    const resF = await fetch(`${baseUrl}/api/inbox/read`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({ all: true, mailboxId: mb1.id }),
    });
    const dataF = await resF.json();
    console.log(`- Status: ${resF.status}`);
    console.log(`- Counts returned:`, JSON.stringify(dataF.counts));
    if (resF.ok) {
      console.log("=> TEST F PASSED: Read status handler succeeds with mailbox scoping.\n");
    } else {
      console.error("=> TEST F FAILED!\n");
    }
  } catch (err: any) {
    console.error("TEST F failed with error:", err.message);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
