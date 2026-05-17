import {
  formatCurrency,
  type CanonicalRecord,
} from "./domain";
import { formatFinancialStatus, formatPaymentPlan } from "./record-display";

export const WA_TEMPLATE_PLACEHOLDERS = [
  "nama",
  "whatsapp",
  "produk",
  "sisaPembayaran",
  "totalPembayaran",
  "pembayaranPertama",
  "pembayaranKedua",
  "status",
  "mekanisme",
] as const;

export type WaTemplatePlaceholder = (typeof WA_TEMPLATE_PLACEHOLDERS)[number];

export type WaMeDraft = {
  record: CanonicalRecord;
  message: string;
  link: string;
  ok: boolean;
  reasons: string[];
  unknownPlaceholders: string[];
};

const WA_REVIEW_BLOCKING_FLAGS = new Set([
  "missing_whatsapp",
  "short_whatsapp",
  "invalid_whatsapp",
  "ambiguous_scientific_whatsapp",
]);

const WHATSAPP_PHONE_PATTERN = /^62\d{9,13}$/;

export function buildWaMeDraft(record: CanonicalRecord, templateBody: string): WaMeDraft {
  const { message, unknownPlaceholders } = renderWaTemplate(templateBody, record);
  const eligibility = getWaMeEligibility(record);

  return {
    record,
    message,
    link: eligibility.ok ? buildWaMeLink(record.normalizedWhatsapp, message) : "",
    ok: eligibility.ok,
    reasons: eligibility.reasons,
    unknownPlaceholders,
  };
}

export function buildWaMeLink(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function renderWaTemplate(
  templateBody: string,
  record: CanonicalRecord,
): {
  message: string;
  unknownPlaceholders: string[];
} {
  const values = getWaTemplateValues(record);
  const unknownPlaceholders = new Set<string>();
  const message = templateBody.replace(/\{([^{}]+)\}/g, (match, rawKey: string) => {
    const key = rawKey.trim();

    if (isWaTemplatePlaceholder(key)) {
      return values[key];
    }

    unknownPlaceholders.add(key);
    return match;
  });

  return {
    message,
    unknownPlaceholders: [...unknownPlaceholders],
  };
}

export function getWaMeEligibility(record: CanonicalRecord): {
  ok: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];

  if (!WHATSAPP_PHONE_PATTERN.test(record.normalizedWhatsapp)) {
    reasons.push("Nomor WhatsApp tidak valid untuk wa.me.");
  }

  if (record.reviewFlags.some((flag) => WA_REVIEW_BLOCKING_FLAGS.has(flag))) {
    reasons.push("Record memiliki flag review pada nomor WhatsApp.");
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}

export function formatWaMeBatchLine(draft: WaMeDraft): string {
  return `${draft.record.namaLengkap || "Tanpa nama"} | ${draft.record.displayWhatsapp || draft.record.normalizedWhatsapp} | ${draft.link}`;
}

function getWaTemplateValues(record: CanonicalRecord): Record<WaTemplatePlaceholder, string> {
  return {
    nama: record.namaLengkap || "Kak",
    whatsapp: record.displayWhatsapp || record.normalizedWhatsapp,
    produk: record.productName || "-",
    sisaPembayaran: formatCurrency(record.receivableAmount),
    totalPembayaran: formatCurrency(record.totalPayment),
    pembayaranPertama: formatCurrency(record.pembayaranPertama),
    pembayaranKedua: formatCurrency(record.pembayaranKedua),
    status: formatFinancialStatus(record.financialStatus),
    mekanisme: formatPaymentPlan(record.pilihanPembayaran),
  };
}

function isWaTemplatePlaceholder(value: string): value is WaTemplatePlaceholder {
  return (WA_TEMPLATE_PLACEHOLDERS as readonly string[]).includes(value);
}
