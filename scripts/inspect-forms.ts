import { prisma } from "../lib/prisma";

async function run() {
  const formJobs = await prisma.websiteFormJob.findMany({
    include: { campaign: { select: { name: true } }, contact: { select: { brandName: true, email: true } } }
  });
  console.log('Total WebsiteFormJob in DB:', formJobs.length);
  console.log('Form jobs:', JSON.stringify(formJobs, null, 2));

  const formTemplates = await prisma.formTemplate.findMany();
  console.log('Form templates count:', formTemplates.length);
  console.log('Form templates:', JSON.stringify(formTemplates, null, 2));
}

run().catch(console.error).finally(() => prisma.$disconnect());
