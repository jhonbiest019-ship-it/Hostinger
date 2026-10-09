export const TEMPLATE_VARIABLES = ["firstName", "lastName", "fullName", "brandName", "companyName", "email", "phone", "website", "formUrl"] as const;

export type TemplateContact = Partial<Record<(typeof TEMPLATE_VARIABLES)[number], string | null | undefined>>;

export function renderTemplate(value: string, contact: TemplateContact) {
  return value.replace(/{{\s*([a-zA-Z]+)\s*}}/g, (_, variable: string) => {
    if (!TEMPLATE_VARIABLES.includes(variable as (typeof TEMPLATE_VARIABLES)[number])) return "";
    return String(contact[variable as keyof TemplateContact] ?? "");
  });
}
