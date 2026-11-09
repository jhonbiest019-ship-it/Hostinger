import { renderTemplate } from "@/lib/email/template";

export interface ResolvedFormValues {
  applicantName: string;
  contactEmail: string;
  phoneNumber: string;
  companyName: string;
  companyWebsite: string;
  productCategory: string;
  subject?: string;
  message: string;
  taxId?: string;
  storeType?: string;
  [key: string]: any;
}

export function resolveFormTemplateValues(
  templateFieldsJson: string | Record<string, any>,
  recipientData: {
    brandName?: string | null;
    email?: string | null;
    productCategory?: string | null;
    senderEmail?: string | null;
    senderName?: string | null;
    notes?: string | null;
    [key: string]: any;
  }
): ResolvedFormValues {
  let fields: Record<string, any> = {};
  if (typeof templateFieldsJson === "string") {
    try {
      fields = JSON.parse(templateFieldsJson);
    } catch {
      fields = {};
    }
  } else if (templateFieldsJson && typeof templateFieldsJson === "object") {
    fields = templateFieldsJson;
  }

  const brand = recipientData.brandName || "Brand Partner";
  const category = recipientData.productCategory || recipientData.notes || "Retail Products";
  const senderEmail = recipientData.senderEmail || "sales@qayyumestore.com";
  const senderName = recipientData.senderName || "David Lucas";

  const context = {
    brandName: brand,
    productCategory: category,
    category,
    fullName: senderName,
    name: senderName,
    senderEmail,
    companyName: "QAYYUM ESTORE",
    ...recipientData,
  };

  const resolved: Record<string, any> = {};

  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === "string") {
      resolved[key] = renderTemplate(val, context);
    } else {
      resolved[key] = val;
    }
  }

  return {
    applicantName: resolved.applicantName || senderName,
    contactEmail: resolved.contactEmail || senderEmail,
    phoneNumber: resolved.phoneNumber || "352-695-1331",
    companyName: resolved.companyName || "QAYYUM ESTORE",
    companyWebsite: resolved.companyWebsite || "https://qayyumestore.com",
    productCategory: resolved.productCategory || category,
    subject: resolved.subject ? renderTemplate(resolved.subject, context) : `Retail Partnership Inquiry - ${brand}`,
    message: resolved.message
      ? renderTemplate(resolved.message, context)
      : `Hello ${brand} Team, We are reaching out from QAYYUM ESTORE to explore opening an authorized retail/wholesale partnership for your ${category} line.`,
    taxId: resolved.taxId || "Available upon request (Florida LLC)",
    storeType: resolved.storeType || "Retailer / Distribution",
    ...resolved,
  };
}
