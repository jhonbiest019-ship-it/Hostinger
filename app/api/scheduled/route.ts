import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { JobStatus } from "@prisma/client";
import { renderTemplate } from "@/lib/email/template";
import { processDueJobs } from "@/lib/queue/worker";

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const status = request.nextUrl.searchParams.get("status");
    if (status && !Object.values(JobStatus).includes(status as JobStatus)) {
      return NextResponse.json({ error: "Invalid status filter." }, { status: 400 });
    }
    const page = Math.max(1, Math.min(100000, Math.floor(Number(request.nextUrl.searchParams.get("page"))) || 1));
    const where = { userId, ...(status ? { status: status as JobStatus } : {}) };

    const [rawJobs, total, worker, defaultTemplate, campaigns] = await Promise.all([
      prisma.scheduledJob.findMany({
        where,
        include: {
          campaign: {
            select: {
              id: true,
              name: true,
              status: true,
              mailbox: { select: { id: true, emailAddress: true, displayName: true } },
              template: { select: { id: true, name: true, subject: true, body: true } },
            },
          },
          campaignRecipient: {
            select: {
              id: true,
              status: true,
              snapshotBrand: true,
              snapshotEmail: true,
              snapshotName: true,
              productCategory: true,
              sheetRowIndex: true,
              formStatus: true,
              formUrl: true,
              websiteFormJobs: {
                select: {
                  id: true,
                  targetUrl: true,
                  status: true,
                  manualActionReason: true,
                  runAt: true,
                  submittedAt: true,
                  lastError: true,
                },
                orderBy: { createdAt: "desc" },
                take: 1,
              },
              contact: {
                select: {
                  id: true,
                  name: true,
                  fullName: true,
                  brandName: true,
                  companyName: true,
                  email: true,
                  notes: true,
                  website: true,
                  formUrl: true,
                },
              },
            },
          },
          followUpRule: {
            select: {
              stepNumber: true,
              subject: true,
              body: true,
              template: { select: { id: true, name: true, subject: true, body: true } },
            },
          },
          message: {
            select: {
              id: true,
              toAddress: true,
              fromAddress: true,
              subject: true,
              body: true,
              sentAt: true,
              status: true,
            },
          },
        },
        orderBy: [{ runAt: status === "PENDING" ? "asc" : "desc" }, { id: "asc" }],
        skip: (page - 1) * 50,
        take: 50,
      }),
      prisma.scheduledJob.count({ where }),
      prisma.workerLease.findUnique({ where: { name: "queue" }, select: { updatedAt: true } }),
      prisma.template.findFirst({ where: { userId, status: "ACTIVE", isDefault: true } }),
      prisma.campaign.findMany({
        where: { userId },
        include: {
          mailbox: { select: { id: true, emailAddress: true, displayName: true } },
          template: { select: { id: true, name: true, subject: true, body: true } },
          recipients: {
            select: {
              id: true,
              status: true,
              snapshotBrand: true,
              snapshotEmail: true,
              productCategory: true,
              contact: { select: { brandName: true, email: true, name: true } },
            },
          },
          scheduledJobs: {
            select: { id: true, status: true, runAt: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const jobs = rawJobs.map((job) => {
      const recipient = job.campaignRecipient;
      const contact = recipient?.contact;

      const email =
        recipient?.snapshotEmail ||
        contact?.email ||
        job.message?.toAddress ||
        "";

      let brandName =
        recipient?.snapshotBrand ||
        contact?.brandName ||
        contact?.companyName ||
        contact?.name ||
        contact?.fullName ||
        "";

      if (!brandName || brandName.trim().toLowerCase() === "brand") {
        if (email && email.includes("@")) {
          const rawDomain = email.split("@")[1].split(".")[0];
          brandName = rawDomain
            .split(/[-_]/)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");
        } else {
          brandName = "Brand";
        }
      }

      const productCategory = recipient?.productCategory || contact?.notes || "General";
      const website = contact?.website || "";
      const asin = contact?.formUrl || "";

      const contactVariables = {
        brandName,
        snapshotBrand: brandName,
        email,
        productCategory,
        category: productCategory,
        website,
        asin,
        amazonLink: website,
        name: brandName,
        fullName: brandName,
        companyName: brandName,
      };

      const rawSubject =
        job.message?.subject ||
        job.followUpRule?.subject ||
        job.followUpRule?.template?.subject ||
        job.campaign?.template?.subject ||
        defaultTemplate?.subject ||
        "Partnership Outreach";

      const rawBody =
        job.message?.body ||
        job.followUpRule?.body ||
        job.followUpRule?.template?.body ||
        job.campaign?.template?.body ||
        defaultTemplate?.body ||
        "";

      const renderedSubject = renderTemplate(rawSubject, contactVariables);
      const renderedBody = renderTemplate(rawBody, contactVariables);

      const rawFormUrl =
        recipient?.formUrl ||
        contact?.formUrl ||
        (contact?.website
          ? contact.website.startsWith("http")
            ? contact.website
            : `https://${contact.website}`
          : null);

      const latestFormJob = recipient?.websiteFormJobs?.[0] || null;
      const formStatus = latestFormJob?.status || recipient?.formStatus || (rawFormUrl ? "READY" : "NO_URL");

      return {
        ...job,
        brandName,
        recipientEmail: email,
        productCategory,
        formUrl: rawFormUrl,
        formStatus,
        websiteFormJob: latestFormJob,
        renderedSubject,
        renderedBody,
        senderEmail: job.campaign?.mailbox?.emailAddress || "Default Sender",
        senderDisplayName: job.campaign?.mailbox?.displayName || null,
      };
    });

    // Trigger queue worker to process any jobs that have reached their scheduled runAt time
    void processDueJobs().catch(() => {});

    return NextResponse.json({
      jobs,
      total,
      page,
      pageSize: 50,
      lastWorkerActivity: worker?.updatedAt ?? null,
      campaigns,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to load scheduled jobs." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const { jobId, formUrl } = await request.json();

    if (!jobId || !formUrl) {
      return NextResponse.json({ error: "jobId and formUrl are required." }, { status: 400 });
    }

    const job = await prisma.scheduledJob.findFirst({
      where: { id: jobId, userId },
      include: { campaignRecipient: true },
    });

    if (!job || !job.campaignRecipient) {
      return NextResponse.json({ error: "Scheduled job or recipient not found." }, { status: 404 });
    }

    const cleanUrl = formUrl.trim().startsWith("http") ? formUrl.trim() : `https://${formUrl.trim()}`;

    await prisma.campaignRecipient.update({
      where: { id: job.campaignRecipient.id },
      data: { formUrl: cleanUrl, formStatus: "PENDING" },
    });

    await prisma.contact.update({
      where: { id: job.campaignRecipient.contactId },
      data: { formUrl: cleanUrl },
    });

    return NextResponse.json({ success: true, formUrl: cleanUrl });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Failed to update webform link." }, { status: 500 });
  }
}
