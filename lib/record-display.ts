import { formatCurrency, type CanonicalRecord, type FinancialStatus } from "./domain";

export const RECORD_EXPORT_HEADERS = [
  "Nama",
  "WhatsApp",
  "Produk",
  "Mekanisme",
  "Status",
  "Pembayaran 1",
  "Pembayaran 2",
  "Total Pembayaran",
  "Sisa Pembayaran",
] as const;

const FINANCIAL_STATUS_LABELS: Record<FinancialStatus, string> = {
  paid_off: "Lunas",
  installment_receivable: "Cicilan",
  underpaid_lunas_review: "Kurang bayar",
  overpaid_review: "Overpaid",
  needs_review: "Review",
  excluded_no_payment: "Tanpa bayar",
};

export function formatPaymentPlan(plan: CanonicalRecord["pilihanPembayaran"]) {
  if (plan === "lunas") return "1x Pembayaran";
  if (plan === "cicil") return "2x Pembayaran";
  return "-";
}

export function formatSecondPayment(record: CanonicalRecord) {
  if (
    record.pilihanPembayaran === "lunas" &&
    record.totalPayment > 0 &&
    record.pembayaranPertama === record.totalPayment
  ) {
    return "Lunas";
  }

  return formatCurrency(record.pembayaranKedua);
}

export function formatFinancialStatus(status: FinancialStatus) {
  return FINANCIAL_STATUS_LABELS[status];
}

export function recordToExportRow(record: CanonicalRecord): string[] {
  return [
    record.namaLengkap || "Tanpa nama",
    record.displayWhatsapp || record.rawWhatsapp,
    record.productName,
    formatPaymentPlan(record.pilihanPembayaran),
    formatFinancialStatus(record.financialStatus),
    formatCurrency(record.pembayaranPertama),
    formatSecondPayment(record),
    formatCurrency(record.paidAmount),
    formatCurrency(record.receivableAmount),
  ];
}
