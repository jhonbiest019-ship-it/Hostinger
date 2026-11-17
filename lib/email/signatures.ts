/**
 * Professional Business Email Signature Suite for Hostinger ERP (Shotinger)
 * 
 * Provides 10 industry-standard signature styles commonly used across
 * corporate, executive, wholesale outreach, and modern B2B communications.
 */

export interface SignatureData {
  fullName: string;
  jobTitle: string;
  companyName: string;
  phone: string;
  email: string;
  website: string;
  address?: string;
  ctaText?: string;
  ctaUrl?: string;
  styleId?: string;
}

export interface SignatureStyle {
  id: string;
  name: string;
  badge: string;
  description: string;
  previewSummary: string;
  generateText: (data: SignatureData) => string;
  renderHtml: (data: SignatureData) => string;
}

export const DEFAULT_SIGNATURE_DATA: SignatureData = {
  fullName: "David Lucas",
  jobTitle: "Senior Partnerships & Outreach Director",
  companyName: "Farani Group LLC",
  phone: "+1 (407) 555-0199",
  email: "david@faranigroup.com",
  website: "https://faranigroup.com",
  address: "7901 4th St N, St. Petersburg, FL 33702",
  ctaText: "Schedule a 15-Min Partnership Call",
  ctaUrl: "https://calendly.com",
  styleId: "two_column_executive",
};

function cleanUrl(url?: string): string {
  if (!url) return "";
  return url.startsWith("http") ? url : `https://${url}`;
}

function cleanPhoneNum(phone?: string): string {
  if (!phone) return "";
  return phone.replace(/[^0-9+]/g, "");
}

function getInitials(name?: string): string {
  if (!name) return "DL";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const SIGNATURE_STYLES: SignatureStyle[] = [
  // 1. Two-Column Executive (Current Proven Standard)
  {
    id: "two_column_executive",
    name: "Executive Split (Two-Column)",
    badge: "Most Popular",
    description: "Classic executive 2-column layout with a crisp vertical dividing line separating identity from contact channels.",
    previewSummary: "Name & Title on Left | Divider | Phone, Email & Address on Right",
    generateText: (data) => {
      const addr = data.address ? `\n${data.companyName} | 📍 ${data.address}` : "";
      return `-- [Signature: two_column_executive]
${data.fullName} | 📞 ${data.phone}
${data.jobTitle} | ✉️ ${data.email}${addr}
${data.companyName} | 🌐 ${data.website}`;
    },
    renderHtml: (data) => {
      const phoneDigits = cleanPhoneNum(data.phone);
      const webUrl = cleanUrl(data.website);
      return `
      <table cellpadding="0" cellspacing="0" border="0" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin-top: 14px; border-collapse: collapse;">
        <tr>
          <td style="padding-right: 22px; vertical-align: middle; white-space: nowrap;">
            <div style="font-size: 16.5px; font-weight: 700; color: #111827; line-height: 1.25;">${data.fullName}</div>
            ${data.jobTitle ? `<div style="font-size: 13.5px; color: #4B5563; margin-top: 3px; line-height: 1.3;">${data.jobTitle}</div>` : ""}
            ${data.companyName ? `<div style="font-size: 13px; font-weight: 700; color: #673DE6; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; line-height: 1.3;">${data.companyName}</div>` : ""}
          </td>
          <td style="border-left: 2px solid #111827; padding-left: 22px; vertical-align: middle; white-space: nowrap;">
            ${data.phone ? `<div style="font-size: 13px; color: #111827; margin-bottom: 4px;"><span style="margin-right: 6px;">📞</span><a href="tel:${phoneDigits}" style="color: #111827; text-decoration: none; font-weight: 500;">${data.phone}</a></div>` : ""}
            ${data.email ? `<div style="font-size: 13px; color: #111827; margin-bottom: 4px;"><span style="margin-right: 6px;">✉️</span><a href="mailto:${data.email}" style="color: #111827; text-decoration: none;">${data.email}</a></div>` : ""}
            ${data.website ? `<div style="font-size: 13px; color: #111827; margin-bottom: 4px;"><span style="margin-right: 6px;">🌐</span><a href="${webUrl}" style="color: #673DE6; text-decoration: none; font-weight: 600;">${data.website.replace(/^https?:\/\//, "")}</a></div>` : ""}
            ${data.address ? `<div style="font-size: 12.5px; color: #6B7280; margin-top: 2px;"><span style="margin-right: 6px;">📍</span>${data.address}</div>` : ""}
          </td>
        </tr>
      </table>`;
    },
  },

  // 2. Modern Accent Border Bar (Purple / Indigo Bar)
  {
    id: "modern_accent_bar",
    name: "Modern Accent Bar (Vertical Left Accent)",
    badge: "Clean & Modern",
    description: "Sleek vertical border line in vibrant purple highlighting your credentials and outreach channels.",
    previewSummary: "Thick Accent Bar on Left with Stacked Credentials & Horizontal Contact Bar",
    generateText: (data) => {
      return `-- [Signature: modern_accent_bar]
${data.fullName} • ${data.companyName}
${data.jobTitle}
Direct: ${data.phone} | Email: ${data.email} | Web: ${data.website}${data.address ? `\nHQ: ${data.address}` : ""}`;
    },
    renderHtml: (data) => {
      const phoneDigits = cleanPhoneNum(data.phone);
      const webUrl = cleanUrl(data.website);
      return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin-top: 14px; border-left: 3.5px solid #673DE6; padding-left: 14px;">
        <div style="font-size: 16px; font-weight: 700; color: #111827; line-height: 1.2;">
          ${data.fullName} <span style="font-size: 13px; font-weight: 600; color: #673DE6; margin-left: 6px;">• ${data.companyName}</span>
        </div>
        ${data.jobTitle ? `<div style="font-size: 13px; color: #4B5563; margin-top: 3px; font-weight: 500;">${data.jobTitle}</div>` : ""}
        <div style="font-size: 12.5px; color: #374151; margin-top: 7px; line-height: 1.5;">
          ${data.phone ? `<a href="tel:${phoneDigits}" style="color: #111827; text-decoration: none; font-weight: 500;">📞 ${data.phone}</a>` : ""}
          ${data.phone && data.email ? ` <span style="color: #D1D5DB; margin: 0 6px;">|</span> ` : ""}
          ${data.email ? `<a href="mailto:${data.email}" style="color: #111827; text-decoration: none;">✉️ ${data.email}</a>` : ""}
          ${(data.phone || data.email) && data.website ? ` <span style="color: #D1D5DB; margin: 0 6px;">|</span> ` : ""}
          ${data.website ? `<a href="${webUrl}" style="color: #673DE6; text-decoration: none; font-weight: 600;">🌐 ${data.website.replace(/^https?:\/\//, "")}</a>` : ""}
        </div>
        ${data.address ? `<div style="font-size: 11.5px; color: #9CA3AF; margin-top: 4px;">📍 ${data.address}</div>` : ""}
      </div>`;
    },
  },

  // 3. Minimalist Tech / Founder
  {
    id: "minimalist_tech",
    name: "Minimalist Tech (Clean Dot-Separated)",
    badge: "Sleek & Minimal",
    description: "Ultra-clean dot-separated minimalist aesthetic favored by modern founders, product leads, and tech executives.",
    previewSummary: "Full Name (Bold) | Role @ Company • Compact Single Block",
    generateText: (data) => {
      return `-- [Signature: minimalist_tech]
${data.fullName}
${data.jobTitle} at ${data.companyName}
${data.phone} • ${data.email} • ${data.website}`;
    },
    renderHtml: (data) => {
      const phoneDigits = cleanPhoneNum(data.phone);
      const webUrl = cleanUrl(data.website);
      return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin-top: 14px;">
        <div style="font-size: 15.5px; font-weight: 700; color: #111827;">${data.fullName}</div>
        <div style="font-size: 13px; color: #4B5563; margin-top: 2px;">
          ${data.jobTitle} at <strong style="color: #111827; font-weight: 600;">${data.companyName}</strong>
        </div>
        <div style="font-size: 12.5px; color: #6B7280; margin-top: 6px;">
          ${data.phone ? `<a href="tel:${phoneDigits}" style="color: #4B5563; text-decoration: none;">${data.phone}</a>` : ""}
          ${data.phone && data.email ? ` <span style="color: #9CA3AF; margin: 0 4px;">•</span> ` : ""}
          ${data.email ? `<a href="mailto:${data.email}" style="color: #4B5563; text-decoration: none;">${data.email}</a>` : ""}
          ${(data.phone || data.email) && data.website ? ` <span style="color: #9CA3AF; margin: 0 4px;">•</span> ` : ""}
          ${data.website ? `<a href="${webUrl}" style="color: #673DE6; text-decoration: none; font-weight: 500;">${data.website.replace(/^https?:\/\//, "")}</a>` : ""}
        </div>
      </div>`;
    },
  },

  // 4. Visual Avatar / Monogram Card
  {
    id: "avatar_monogram",
    name: "Avatar / Monogram Card (Identity Badge)",
    badge: "Personal & Warm",
    description: "Features a stylish circular gradient monogram avatar badge with your initials next to your contact credentials.",
    previewSummary: "Initials Badge (e.g. [DL]) + Name, Title, and Two-Line Contact Box",
    generateText: (data) => {
      return `-- [Signature: avatar_monogram]
[${getInitials(data.fullName)}] ${data.fullName}
${data.jobTitle} | ${data.companyName}
Phone: ${data.phone} | Email: ${data.email}
Web: ${data.website}`;
    },
    renderHtml: (data) => {
      const initials = getInitials(data.fullName);
      const phoneDigits = cleanPhoneNum(data.phone);
      const webUrl = cleanUrl(data.website);
      return `
      <table cellpadding="0" cellspacing="0" border="0" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin-top: 14px; border-collapse: collapse;">
        <tr>
          <td style="vertical-align: middle; padding-right: 14px;">
            <div style="width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg, #673DE6 0%, #4F46E5 100%); color: #ffffff; font-size: 15px; font-weight: 700; text-align: center; line-height: 44px; letter-spacing: 0.5px; box-shadow: 0 2px 6px rgba(103, 61, 230, 0.25);">
              ${initials}
            </div>
          </td>
          <td style="vertical-align: middle;">
            <div style="font-size: 15.5px; font-weight: 700; color: #111827; line-height: 1.2;">${data.fullName}</div>
            <div style="font-size: 12.5px; color: #6B7280; margin-top: 2px;">
              ${data.jobTitle} • <strong style="color: #673DE6;">${data.companyName}</strong>
            </div>
            <div style="font-size: 12px; color: #374151; margin-top: 5px;">
              ${data.phone ? `<a href="tel:${phoneDigits}" style="color: #374151; text-decoration: none;">📞 ${data.phone}</a> <span style="color: #D1D5DB; margin: 0 4px;">|</span> ` : ""}
              ${data.email ? `<a href="mailto:${data.email}" style="color: #374151; text-decoration: none;">✉️ ${data.email}</a> <span style="color: #D1D5DB; margin: 0 4px;">|</span> ` : ""}
              ${data.website ? `<a href="${webUrl}" style="color: #673DE6; text-decoration: none; font-weight: 600;">🌐 ${data.website.replace(/^https?:\/\//, "")}</a>` : ""}
            </div>
          </td>
        </tr>
      </table>`;
    },
  },

  // 5. Classic Corporate & Legal
  {
    id: "classic_corporate",
    name: "Classic Corporate & Enterprise",
    badge: "Formal & Trusted",
    description: "Traditional formal layout with a subtle top hairline divider, ideal for legal, finance, logistics, and wholesale contracts.",
    previewSummary: "Thin Border Top Rule • Formal Designation, Organization & Official HQ",
    generateText: (data) => {
      return `-- [Signature: classic_corporate]
${data.fullName}
${data.jobTitle}
${data.companyName}
T: ${data.phone} | E: ${data.email} | W: ${data.website}${data.address ? `\nOffice: ${data.address}` : ""}`;
    },
    renderHtml: (data) => {
      const phoneDigits = cleanPhoneNum(data.phone);
      const webUrl = cleanUrl(data.website);
      return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin-top: 14px; border-top: 1px solid #E5E7EB; padding-top: 10px;">
        <div style="font-size: 16px; font-weight: bold; color: #111827; letter-spacing: -0.2px;">${data.fullName}</div>
        ${data.jobTitle ? `<div style="font-size: 13px; color: #374151; margin-top: 2px;">${data.jobTitle}</div>` : ""}
        ${data.companyName ? `<div style="font-size: 13.5px; font-weight: 700; color: #111827; margin-top: 3px; text-transform: uppercase;">${data.companyName}</div>` : ""}
        <div style="font-size: 12.5px; color: #4B5563; margin-top: 6px;">
          ${data.phone ? `T: <a href="tel:${phoneDigits}" style="color: #111827; text-decoration: none; font-weight: 500;">${data.phone}</a> &nbsp;|&nbsp; ` : ""}
          ${data.email ? `E: <a href="mailto:${data.email}" style="color: #111827; text-decoration: none;">${data.email}</a> &nbsp;|&nbsp; ` : ""}
          ${data.website ? `W: <a href="${webUrl}" style="color: #2563EB; text-decoration: none; font-weight: 500;">${data.website.replace(/^https?:\/\//, "")}</a>` : ""}
        </div>
        ${data.address ? `<div style="font-size: 12px; color: #6B7280; margin-top: 4px;">Office: ${data.address}</div>` : ""}
      </div>`;
    },
  },

  // 6. Outreach & Sales Pro (with Book a Call Button)
  {
    id: "sales_pro_cta",
    name: "Sales Pro with Call CTA Button",
    badge: "High Conversion",
    description: "Engineered specifically for brand outreach with an actionable 'Schedule a Call' button to accelerate partnership replies.",
    previewSummary: "Full Identity + Interactive Gradient Button [📅 Schedule a 15-Min Call]",
    generateText: (data) => {
      const cta = data.ctaText || "Schedule a 15-Min Partnership Call";
      const ctaLink = data.ctaUrl || "https://calendly.com";
      return `-- [Signature: sales_pro_cta]
${data.fullName} — ${data.jobTitle}
${data.companyName} | 📞 ${data.phone} | ✉️ ${data.email}
👉 [${cta}](${ctaLink})`;
    },
    renderHtml: (data) => {
      const phoneDigits = cleanPhoneNum(data.phone);
      const cta = data.ctaText || "Schedule a 15-Min Partnership Call";
      const ctaLink = cleanUrl(data.ctaUrl || "https://calendly.com");
      return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin-top: 14px;">
        <div style="font-size: 16px; font-weight: 700; color: #111827;">
          ${data.fullName} <span style="font-size: 13px; font-weight: 400; color: #6B7280;">— ${data.jobTitle}</span>
        </div>
        <div style="font-size: 13px; color: #4B5563; margin-top: 3px;">
          <strong style="color: #111827;">${data.companyName}</strong> &nbsp;•&nbsp;
          ${data.phone ? `<a href="tel:${phoneDigits}" style="color: #4B5563; text-decoration: none;">📞 ${data.phone}</a> &nbsp;•&nbsp; ` : ""}
          ${data.email ? `<a href="mailto:${data.email}" style="color: #4B5563; text-decoration: none;">✉️ ${data.email}</a>` : ""}
        </div>
        <div style="margin-top: 10px;">
          <a href="${ctaLink}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #673DE6 0%, #4F46E5 100%); color: #ffffff; text-decoration: none; font-size: 12px; font-weight: 700; padding: 7px 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(103, 61, 230, 0.2);">
            📅 ${cta} &rarr;
          </a>
        </div>
      </div>`;
    },
  },

  // 7. Compact Inline One-Liner (Wholesale & Operations)
  {
    id: "compact_inline",
    name: "Compact Inline (Quick Wholesale)",
    badge: "Space Saver",
    description: "Zero-clutter single-line format that keeps the focus entirely on your message body and respects recipient inbox space.",
    previewSummary: "Name | Title @ Company | +1 (555) 000-0000 | email@domain.com",
    generateText: (data) => {
      return `-- [Signature: compact_inline]
${data.fullName} | ${data.jobTitle}, ${data.companyName} | ${data.phone} | ${data.email} | ${data.website}`;
    },
    renderHtml: (data) => {
      const phoneDigits = cleanPhoneNum(data.phone);
      const webUrl = cleanUrl(data.website);
      return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12.5px; color: #4B5563; margin-top: 12px; line-height: 1.4; border-top: 1px dashed #D1D5DB; padding-top: 8px;">
        <strong style="color: #111827;">${data.fullName}</strong> &nbsp;|&nbsp;
        ${data.jobTitle ? `${data.jobTitle}, ` : ""}<strong style="color: #111827;">${data.companyName}</strong> &nbsp;|&nbsp;
        ${data.phone ? `<a href="tel:${phoneDigits}" style="color: #4B5563; text-decoration: none;">${data.phone}</a> &nbsp;|&nbsp; ` : ""}
        ${data.email ? `<a href="mailto:${data.email}" style="color: #4B5563; text-decoration: none;">${data.email}</a> &nbsp;|&nbsp; ` : ""}
        ${data.website ? `<a href="${webUrl}" style="color: #673DE6; text-decoration: none; font-weight: 500;">${data.website.replace(/^https?:\/\//, "")}</a>` : ""}
      </div>`;
    },
  },

  // 8. Verified B2B Partner (Security & Trust Badge)
  {
    id: "verified_partner",
    name: "Verified B2B Partner (Security Badge)",
    badge: "Maximum Trust",
    description: "Includes an official verified enterprise security badge line reassuring brands of sender legitimacy and rapid response.",
    previewSummary: "Full Credentials + [🔒 Verified Hostinger Enterprise Sender | 24/7 Response]",
    generateText: (data) => {
      return `-- [Signature: verified_partner]
${data.fullName}
${data.jobTitle} — ${data.companyName}
Phone: ${data.phone} | Email: ${data.email} | Web: ${data.website}
[🔒 Verified Hostinger Business Sender | Fast Response Guaranteed]`;
    },
    renderHtml: (data) => {
      const phoneDigits = cleanPhoneNum(data.phone);
      const webUrl = cleanUrl(data.website);
      return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin-top: 14px;">
        <div style="font-size: 16px; font-weight: 700; color: #111827;">${data.fullName}</div>
        <div style="font-size: 13px; color: #4B5563; margin-top: 2px;">
          ${data.jobTitle} &nbsp;—&nbsp; <strong style="color: #111827;">${data.companyName}</strong>
        </div>
        <div style="font-size: 12.5px; color: #374151; margin-top: 5px;">
          ${data.phone ? `<a href="tel:${phoneDigits}" style="color: #111827; text-decoration: none;">📞 ${data.phone}</a> &nbsp;|&nbsp; ` : ""}
          ${data.email ? `<a href="mailto:${data.email}" style="color: #111827; text-decoration: none;">✉️ ${data.email}</a> &nbsp;|&nbsp; ` : ""}
          ${data.website ? `<a href="${webUrl}" style="color: #673DE6; text-decoration: none; font-weight: 600;">🌐 ${data.website.replace(/^https?:\/\//, "")}</a>` : ""}
        </div>
        <div style="margin-top: 8px; display: inline-block; background-color: #ECFDF5; border: 1px solid #A7F3D0; border-radius: 6px; padding: 4px 10px; font-size: 11.5px; color: #065F46; font-weight: 600;">
          🔒 Verified Business Sender &nbsp;•&nbsp; Direct Hostinger SMTP Dispatch
        </div>
      </div>`;
    },
  },

  // 9. Dark Contrast Brand Header
  {
    id: "dark_contrast_bar",
    name: "Dark Brand Bar (Executive Contrast)",
    badge: "Premium Impact",
    description: "Contrasting dark charcoal pill tag displaying company brand with bold executive typography.",
    previewSummary: "[COMPANY NAME] Dark Pill Tag + Bold Name, Phone, and Direct Channels",
    generateText: (data) => {
      return `-- [Signature: dark_contrast_bar]
[${data.companyName.toUpperCase()}]
${data.fullName}
${data.jobTitle}
Tel: ${data.phone} | Mail: ${data.email} | URL: ${data.website}`;
    },
    renderHtml: (data) => {
      const phoneDigits = cleanPhoneNum(data.phone);
      const webUrl = cleanUrl(data.website);
      return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin-top: 14px;">
        <div style="display: inline-block; background-color: #111827; color: #ffffff; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; padding: 3px 10px; border-radius: 4px; margin-bottom: 6px;">
          ${data.companyName || "ENTERPRISE"}
        </div>
        <div style="font-size: 16px; font-weight: 800; color: #000000; line-height: 1.2;">${data.fullName}</div>
        ${data.jobTitle ? `<div style="font-size: 13px; color: #4B5563; margin-top: 2px;">${data.jobTitle}</div>` : ""}
        <div style="font-size: 12.5px; color: #374151; margin-top: 6px; line-height: 1.5;">
          ${data.phone ? `<span style="color: #6B7280;">Tel:</span> <a href="tel:${phoneDigits}" style="color: #111827; text-decoration: none; font-weight: 600;">${data.phone}</a> &nbsp;•&nbsp; ` : ""}
          ${data.email ? `<span style="color: #6B7280;">Mail:</span> <a href="mailto:${data.email}" style="color: #111827; text-decoration: none;">${data.email}</a> &nbsp;•&nbsp; ` : ""}
          ${data.website ? `<span style="color: #6B7280;">URL:</span> <a href="${webUrl}" style="color: #673DE6; text-decoration: none; font-weight: 600;">${data.website.replace(/^https?:\/\//, "")}</a>` : ""}
        </div>
      </div>`;
    },
  },

  // 10. Formal Legal & Confidentiality Notice
  {
    id: "legal_compliance",
    name: "Legal Compliance & Confidentiality",
    badge: "Corporate Protocol",
    description: "Includes official corporate designation followed by standard enterprise confidentiality notice, essential for regulated business.",
    previewSummary: "Full Executive Details + Confidentiality & Non-Disclosure Legal Notice",
    generateText: (data) => {
      return `-- [Signature: legal_compliance]
${data.fullName} | ${data.jobTitle}
${data.companyName}
Phone: ${data.phone} | Email: ${data.email} | Web: ${data.website}

CONFIDENTIALITY NOTICE: This transmission is intended solely for the addressee and may contain confidential information. If received in error, please notify the sender immediately and delete this communication.`;
    },
    renderHtml: (data) => {
      const phoneDigits = cleanPhoneNum(data.phone);
      const webUrl = cleanUrl(data.website);
      return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin-top: 14px;">
        <div style="font-size: 15.5px; font-weight: 700; color: #111827;">${data.fullName}</div>
        <div style="font-size: 13px; color: #4B5563; margin-top: 2px;">
          ${data.jobTitle} &nbsp;|&nbsp; <strong style="color: #111827;">${data.companyName}</strong>
        </div>
        <div style="font-size: 12.5px; color: #374151; margin-top: 5px;">
          ${data.phone ? `<a href="tel:${phoneDigits}" style="color: #111827; text-decoration: none;">📞 ${data.phone}</a> &nbsp;|&nbsp; ` : ""}
          ${data.email ? `<a href="mailto:${data.email}" style="color: #111827; text-decoration: none;">✉️ ${data.email}</a> &nbsp;|&nbsp; ` : ""}
          ${data.website ? `<a href="${webUrl}" style="color: #673DE6; text-decoration: none; font-weight: 600;">🌐 ${data.website.replace(/^https?:\/\//, "")}</a>` : ""}
        </div>
        <div style="margin-top: 10px; border-top: 1px solid #E5E7EB; padding-top: 6px; font-size: 10.5px; color: #9CA3AF; line-height: 1.4;">
          CONFIDENTIALITY NOTICE: This electronic transmission and any attachments are intended solely for the named recipient. Any unauthorized disclosure, distribution, or copying is strictly prohibited.
        </div>
      </div>`;
    },
  },
];

/**
 * Parses raw signature text into structured data and renders the appropriate HTML style.
 */
export function parseAndRenderSignatureHtml(sigText: string): string {
  if (!sigText || !sigText.trim()) return "";

  // Check if a specific style tag is present (e.g. [Signature: modern_accent_bar])
  const styleMatch = sigText.match(/\[Signature:\s*([a-zA-Z0-9_-]+)\]/i);
  const matchedStyleId = styleMatch ? styleMatch[1].trim() : null;

  // Clean markers and split lines
  const cleanSig = sigText
    .replace(/(?:^|\n)--\s*/g, "\n")
    .replace(/\[Signature:\s*[a-zA-Z0-9_-]+\]/gi, "")
    .trim();

  const lines = cleanSig
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let fullName = "David Lucas";
  let jobTitle = "Partnerships Manager";
  let companyName = "Farani Group LLC";
  let phone = "+1 (407) 555-0199";
  let email = "david@faranigroup.com";
  let website = "https://faranigroup.com";
  let address = "";
  let ctaText = "Schedule a 15-Min Partnership Call";
  let ctaUrl = "https://calendly.com";

  // Check for 2-column pipe format
  const hasPipe = lines.some((l) => l.includes("|"));
  if (hasPipe) {
    const pipeRows = lines.map((l) => {
      const parts = l.split("|");
      return { left: parts[0]?.trim() || "", right: parts.slice(1).join("|")?.trim() || "" };
    });

    if (pipeRows[0]?.left) fullName = pipeRows[0].left.replace(/^\[[A-Z]+\]\s*/, "");
    if (pipeRows[1]?.left) jobTitle = pipeRows[1].left;
    if (pipeRows[2]?.left) companyName = pipeRows[2].left;

    for (const r of pipeRows) {
      const raw = r.right;
      if (!raw) continue;
      const emMatch = raw.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (emMatch) email = emMatch[1];
      const phMatch = raw.match(/([0-9+() -]{7,})/);
      if (phMatch && !emMatch) phone = phMatch[1].trim();
      if (/https?:\/\/[^\s]+|[a-zA-Z0-9-]+\.(?:com|org|io|net|co)/i.test(raw)) {
        const wMatch = raw.match(/(https?:\/\/[^\s]+|[a-zA-Z0-9-]+\.(?:com|org|io|net|co)[^\s]*)/i);
        if (wMatch && !emMatch) website = wMatch[1];
      }
      if (/road|street|st\.|suite|fl|orlando|ave|blvd|pkwy/i.test(raw) && !emMatch && !phMatch) {
        address = raw.replace(/^[\u{1F4CD}\u{1F4CC}📍📌\s]+/u, "").trim();
      }
    }
  } else {
    // Simple line parsing
    if (lines[0]) fullName = lines[0].replace(/^\[[A-Z]+\]\s*/, "");
    if (lines[1]) {
      const p = lines[1].split(/[—•\-–|at]/i).map((s) => s.trim());
      if (p.length >= 2) {
        jobTitle = p[0];
        companyName = p[1];
      } else {
        jobTitle = lines[1];
      }
    }
    for (const line of lines) {
      const emMatch = line.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (emMatch) email = emMatch[1];
      const phMatch = line.match(/(?:\+?[0-9]{1,3}[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/);
      if (phMatch) phone = phMatch[0].trim();
      if (/https?:\/\/[^\s]+|[a-zA-Z0-9-]+\.(?:com|org|io|net|co)/i.test(line)) {
        const wMatch = line.match(/(https?:\/\/[^\s]+|[a-zA-Z0-9-]+\.(?:com|org|io|net|co)[^\s]*)/i);
        if (wMatch && !emMatch) website = wMatch[1];
      }
      if (/calendly\.com|book|schedule/i.test(line)) {
        const ctaMatch = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (ctaMatch) {
          ctaText = ctaMatch[1];
          ctaUrl = ctaMatch[2];
        }
      }
    }
  }

  const sigData: SignatureData = {
    fullName,
    jobTitle,
    companyName,
    phone,
    email,
    website,
    address,
    ctaText,
    ctaUrl,
  };

  // Find targeted style or pick best match
  let targetStyle = SIGNATURE_STYLES.find((s) => s.id === matchedStyleId);
  if (!targetStyle) {
    if (hasPipe) {
      targetStyle = SIGNATURE_STYLES[0]; // two_column_executive
    } else if (sigText.includes("CONFIDENTIALITY")) {
      targetStyle = SIGNATURE_STYLES[9]; // legal_compliance
    } else if (sigText.includes("calendly") || sigText.includes("Schedule")) {
      targetStyle = SIGNATURE_STYLES[5]; // sales_pro_cta
    } else if (sigText.includes("Verified")) {
      targetStyle = SIGNATURE_STYLES[7]; // verified_partner
    } else {
      targetStyle = SIGNATURE_STYLES[1]; // modern_accent_bar
    }
  }

  return targetStyle.renderHtml(sigData);
}

/**
 * Appends a chosen signature to email body text cleanly after Kind Regards / Best Regards.
 */
export function appendSignatureToBody(bodyText: string, signatureText: string): string {
  const cleanBody = (bodyText || "").trim();
  // Strip any existing signature beginning with '--'
  const mainPart = cleanBody.replace(/(?:^|\n)--\s*(?:\[Signature:[^\]]+\])?[\s\S]*$/, "").trimEnd();

  // If no "Kind regards" or similar closing exists, add "Best regards,"
  const hasClosing = /(?:kind\s+regards|best\s+regards|regards|warm\s+regards|sincerely|cheers|thanks|thank\s+you)[\s,.]*$/i.test(mainPart);
  const closingPrefix = hasClosing ? mainPart : `${mainPart}\n\nBest regards,`;

  return `${closingPrefix}\n\n${signatureText}`;
}
