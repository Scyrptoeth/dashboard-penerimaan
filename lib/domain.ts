import Papa from "papaparse";

export const APP_NAME = "Dashboard Penerimaan" as const;
export const STATE_SCHEMA_VERSION = 1 as const;

const REQUIRED_COLUMNS = [
  "whatsapp",
  "namaLengkap",
  "productName",
  "totalPayment",
  "pilihanPembayaran",
  "pembayaranPertama",
  "pembayaranKedua",
] as const;

const RAW_STATUS_RANK: Record<string, number> = {
  selesai: 4,
  verifikasi: 3,
  proses: 2,
  dibatalkan: 1,
};

const TEXT_COLLATOR = new Intl.Collator("id-ID", {
  numeric: true,
  sensitivity: "base",
});

export type PaymentPlan = "lunas" | "cicil" | "unknown";

export type FinancialStatus =
  | "paid_off"
  | "installment_receivable"
  | "underpaid_lunas_review"
  | "overpaid_review"
  | "needs_review"
  | "excluded_no_payment";

export type DeltaKind =
  | "new_record"
  | "payment_improved"
  | "became_paid_off"
  | "metadata_changed"
  | "unchanged"
  | "needs_review";

export type ImportSummary = {
  rowCount: number;
  parsedRowCount: number;
  paidRowCount: number;
  excludedNoPaymentCount: number;
  newRecordCount: number;
  updatedRecordCount: number;
  unchangedCount: number;
  exceptionCount: number;
};

export type CanonicalRecord = {
  id: string;
  normalizedWhatsapp: string;
  displayWhatsapp: string;
  rawWhatsapp: string;
  namaLengkap: string;
  normalizedProductName: string;
  productName: string;
  totalPayment: number;
  paidAmount: number;
  pembayaranPertama: number;
  pembayaranKedua: number;
  receivableAmount: number;
  pilihanPembayaran: PaymentPlan;
  financialStatus: FinancialStatus;
  tanggal?: string;
  parsedDate?: string;
  vouchers?: string;
  jenisPendaftaran?: string;
  rawPaymentStatus?: string;
  sourceFileName?: string;
  rawRowHash: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastImportId: string;
  reviewFlags: string[];
};

export type NoPaymentProspect = CanonicalRecord & {
  firstNoPaymentSeenAt: string;
  lastNoPaymentSeenAt: string;
  noPaymentImportCount: number;
};

export type ImportBatch = {
  id: string;
  importedAt: string;
  fileName: string;
  fileHash: string;
  delimiter: "," | ";";
  rowCount: number;
  parsedRowCount: number;
  paidRowCount: number;
  excludedNoPaymentCount: number;
  newRecordCount: number;
  updatedRecordCount: number;
  unchangedCount: number;
  exceptionCount: number;
};

export type WaMessageTemplate = {
  id: string;
  name: string;
  body: string;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DashboardSettings = {
  productAliases: Record<string, string>;
  waMessageTemplates: WaMessageTemplate[];
};

export type DashboardState = {
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  appName: typeof APP_NAME;
  createdAt: string;
  updatedAt: string;
  exportedAt?: string;
  records: Record<string, CanonicalRecord>;
  noPaymentProspects: Record<string, NoPaymentProspect>;
  imports: ImportBatch[];
  settings: DashboardSettings;
};

export type ImportedCandidate = CanonicalRecord & {
  rowNumber: number;
  completenessScore: number;
};

export type ImportDelta = {
  id: string;
  kind: DeltaKind;
  candidate: ImportedCandidate;
  previous?: CanonicalRecord;
  ignoredReason?: string;
};

export type ImportPreview = {
  batch: ImportBatch;
  deltas: ImportDelta[];
  candidates: ImportedCandidate[];
  missingColumns: string[];
  summary: ImportSummary;
  warnings: string[];
};

type CsvRow = Record<string, string | undefined>;

type MoneyParseResult = {
  amount: number;
  wasBlank: boolean;
  invalid: boolean;
};

export const DEFAULT_WA_MESSAGE_TEMPLATES: WaMessageTemplate[] = [
  {
    id: "default-polite-receivable",
    name: "Pengingat pelunasan sopan",
    body:
      "Assalamu'alaikum Kak {nama}, kami dari Bimbel Persiapantubel ingin mengingatkan bahwa masih ada sisa pembayaran untuk produk {produk} sebesar {sisaPembayaran}. Mohon konfirmasi rencana pelunasannya ya. Terima kasih.",
    builtIn: true,
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z",
  },
  {
    id: "default-short-installment",
    name: "Follow-up cicilan singkat",
    body:
      "Halo Kak {nama}, follow-up cicilan {produk}. Sisa pembayaran saat ini {sisaPembayaran}. Jika sudah melakukan pembayaran, mohon kirimkan bukti transfer ya. Terima kasih.",
    builtIn: true,
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z",
  },
  {
    id: "default-no-payment-follow-up",
    name: "Follow-up belum bayar",
    body:
      "Halo Kak {nama}, kami dari Bimbel Persiapantubel melihat pendaftaran untuk produk {produk} belum dilanjutkan ke pembayaran. Apakah Kakak masih ingin melanjutkan pendaftaran? Jika iya, kami siap bantu prosesnya.",
    builtIn: true,
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z",
  },
];

export function createDefaultDashboardSettings(): DashboardSettings {
  return {
    productAliases: {},
    waMessageTemplates: DEFAULT_WA_MESSAGE_TEMPLATES.map((template) => ({ ...template })),
  };
}

export function createEmptyState(now = new Date().toISOString()): DashboardState {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    appName: APP_NAME,
    createdAt: now,
    updatedAt: now,
    records: {},
    noPaymentProspects: {},
    imports: [],
    settings: createDefaultDashboardSettings(),
  };
}

export function detectDelimiter(csvText: string): "," | ";" {
  const headerLine = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0);

  if (!headerLine) {
    return ",";
  }

  return countOutsideQuotes(headerLine, ";") > countOutsideQuotes(headerLine, ",")
    ? ";"
    : ",";
}

export function normalizeWhatsapp(rawValue: unknown): {
  normalized: string;
  display: string;
  valid: boolean;
  flags: string[];
} {
  const raw = String(rawValue ?? "").trim();
  const flags: string[] = [];

  if (!raw) {
    return { normalized: "", display: "", valid: false, flags: ["missing_whatsapp"] };
  }

  if (/[eE][+-]?\d+/.test(raw)) {
    return {
      normalized: "",
      display: raw,
      valid: false,
      flags: ["ambiguous_scientific_whatsapp"],
    };
  }

  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) {
    return {
      normalized: digits,
      display: raw,
      valid: false,
      flags: ["short_whatsapp"],
    };
  }

  let normalized = digits;
  if (digits.startsWith("0")) {
    normalized = `62${digits.slice(1)}`;
  } else if (digits.startsWith("8")) {
    normalized = `62${digits}`;
  }

  const valid =
    normalized.startsWith("62") &&
    normalized.length >= 11 &&
    normalized.length <= 15;

  if (!valid) {
    flags.push("invalid_whatsapp");
  }

  return {
    normalized,
    display: formatWhatsapp(normalized || raw),
    valid,
    flags,
  };
}

export function normalizeProductName(rawValue: unknown): {
  display: string;
  normalized: string;
  valid: boolean;
} {
  const display = String(rawValue ?? "").trim().replace(/\s+/g, " ");
  return {
    display,
    normalized: display.toLocaleLowerCase("id-ID"),
    valid: display.length > 0,
  };
}

export function parseMoney(rawValue: unknown): MoneyParseResult {
  const raw = String(rawValue ?? "").trim();

  if (!raw) {
    return { amount: 0, wasBlank: true, invalid: false };
  }

  if (/[eE][+-]?\d+/.test(raw)) {
    return { amount: 0, wasBlank: false, invalid: true };
  }

  const cleaned = raw
    .replace(/^rp\.?\s*/i, "")
    .replace(/\s/g, "")
    .replace(/[.,](?=\d{3}(\D|$))/g, "")
    .replace(/[^\d-]/g, "");

  if (!/^-?\d+$/.test(cleaned)) {
    return { amount: 0, wasBlank: false, invalid: true };
  }

  return { amount: Number.parseInt(cleaned, 10), wasBlank: false, invalid: false };
}

export function parseDate(rawValue: unknown): string | undefined {
  const raw = String(rawValue ?? "").trim();
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(raw);

  if (!match) {
    return undefined;
  }

  const day = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const rawYear = Number.parseInt(match[3] ?? "", 10);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }

  return date.toISOString().slice(0, 10);
}

export function calculateFinancialStatus(input: {
  totalPayment: number;
  paidAmount: number;
  pilihanPembayaran: PaymentPlan;
  hasBlockingReviewFlag?: boolean;
}): FinancialStatus {
  const { totalPayment, paidAmount, pilihanPembayaran, hasBlockingReviewFlag } = input;

  if (paidAmount <= 0) {
    return "excluded_no_payment";
  }

  if (hasBlockingReviewFlag || totalPayment <= 0 || pilihanPembayaran === "unknown") {
    return "needs_review";
  }

  if (paidAmount > totalPayment) {
    return "overpaid_review";
  }

  if (paidAmount === totalPayment) {
    return "paid_off";
  }

  if (pilihanPembayaran === "cicil") {
    return "installment_receivable";
  }

  return "underpaid_lunas_review";
}

export function parseCsvText(
  csvText: string,
  fileName: string,
  importId = createId("import"),
  importedAt = new Date().toISOString(),
): {
  delimiter: "," | ";";
  candidates: ImportedCandidate[];
  missingColumns: string[];
  warnings: string[];
  rowCount: number;
  parsedRowCount: number;
} {
  const text = csvText.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(text);
  const warnings: string[] = [];
  const parsed = Papa.parse<CsvRow>(text, {
    header: true,
    delimiter,
    skipEmptyLines: "greedy",
    transformHeader: (header, index) => {
      const normalized = normalizeHeader(header);
      return normalized || `__empty_${index}`;
    },
    transform: (value) => (typeof value === "string" ? value.trim() : value),
  });

  if (parsed.errors.length > 0) {
    warnings.push(...parsed.errors.slice(0, 5).map((error) => error.message));
  }

  const fields = new Set((parsed.meta.fields ?? []).filter((field) => !field.startsWith("__empty_")));
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !fields.has(column));
  const rows = parsed.data.filter((row) => !isEmptyRow(row));
  const candidates = rows.map((row, index) =>
    rowToCandidate(row, {
      fileName,
      importId,
      importedAt,
      rowNumber: index + 2,
    }),
  );

  return {
    delimiter,
    candidates,
    missingColumns,
    warnings,
    rowCount: Math.max(text.split(/\r?\n/).length - 1, 0),
    parsedRowCount: candidates.length,
  };
}

export function buildImportPreview(
  csvText: string,
  fileName: string,
  state: DashboardState,
  importedAt = new Date().toISOString(),
): ImportPreview {
  const importId = createId("import", `${fileName}:${importedAt}`);
  const parsed = parseCsvText(csvText, fileName, importId, importedAt);
  const grouped = new Map<string, ImportedCandidate>();
  const nonGroupableNeedsReview: ImportDelta[] = [];

  for (const candidate of parsed.candidates) {
    if (candidate.financialStatus === "excluded_no_payment") {
      continue;
    }

    if (!candidate.id || candidate.reviewFlags.includes("missing_product") || candidate.reviewFlags.includes("missing_whatsapp")) {
      nonGroupableNeedsReview.push({
        id: candidate.rawRowHash,
        kind: "needs_review",
        candidate,
        ignoredReason: "Record lacks a usable canonical key.",
      });
      continue;
    }

    const current = grouped.get(candidate.id);
    if (!current || compareCandidates(candidate, current) > 0) {
      grouped.set(candidate.id, candidate);
    }
  }

  const deltas = [...nonGroupableNeedsReview];

  for (const candidate of grouped.values()) {
    const previous = state.records[candidate.id];
    deltas.push(classifyDelta(candidate, previous));
  }

  const summary = summarizeImport(parsed.candidates, deltas);
  const batch: ImportBatch = {
    id: importId,
    importedAt,
    fileName,
    fileHash: hashString(csvText),
    delimiter: parsed.delimiter,
    ...summary,
  };

  return {
    batch,
    deltas,
    candidates: parsed.candidates,
    missingColumns: parsed.missingColumns,
    summary,
    warnings: parsed.warnings,
  };
}

export function mergeImportPreview(
  state: DashboardState,
  preview: ImportPreview,
  now = new Date().toISOString(),
): DashboardState {
  const records = { ...state.records };
  const noPaymentProspects = { ...(state.noPaymentProspects ?? {}) };

  for (const delta of preview.deltas) {
    if (
      delta.kind === "unchanged" ||
      delta.ignoredReason ||
      delta.candidate.financialStatus === "excluded_no_payment"
    ) {
      continue;
    }

    if (delta.kind === "needs_review" && !delta.candidate.id) {
      continue;
    }

    const previous = records[delta.candidate.id];
    if (previous && delta.candidate.paidAmount < previous.paidAmount) {
      continue;
    }

    records[delta.candidate.id] = {
      ...delta.candidate,
      firstSeenAt: previous?.firstSeenAt ?? delta.candidate.firstSeenAt,
      lastSeenAt: now,
      lastImportId: preview.batch.id,
    };
  }

  mergeNoPaymentCandidates(noPaymentProspects, preview.candidates, preview.batch.id, now);
  removeConvertedNoPaymentProspects(noPaymentProspects, records);

  return {
    ...state,
    updatedAt: now,
    records,
    noPaymentProspects,
    imports: [...state.imports, preview.batch],
  };
}

export function validateImportedState(value: unknown): DashboardState {
  if (!value || typeof value !== "object") {
    throw new Error("JSON state tidak valid.");
  }

  const state = value as Partial<DashboardState>;
  if (state.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new Error(`Versi state tidak didukung: ${String(state.schemaVersion)}`);
  }

  if (state.appName !== APP_NAME) {
    throw new Error("File JSON bukan export Dashboard Penerimaan.");
  }

  if (!state.records || typeof state.records !== "object" || !Array.isArray(state.imports)) {
    throw new Error("Struktur records/imports tidak valid.");
  }

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    appName: APP_NAME,
    createdAt: state.createdAt ?? new Date().toISOString(),
    updatedAt: state.updatedAt ?? new Date().toISOString(),
    exportedAt: state.exportedAt,
    records: state.records as Record<string, CanonicalRecord>,
    noPaymentProspects: normalizeNoPaymentProspects(state.noPaymentProspects),
    imports: state.imports,
    settings: normalizeDashboardSettings(state.settings),
  };
}

export function createExportState(state: DashboardState): DashboardState {
  return {
    ...state,
    exportedAt: new Date().toISOString(),
  };
}

export function getDashboardMetrics(state: DashboardState) {
  const records = Object.values(state.records);
  const activeRecords = records.filter((record) => record.financialStatus !== "excluded_no_payment");
  const activeWhatsapp = new Set(activeRecords.map((record) => record.normalizedWhatsapp));
  const noPaymentProspects = Object.values(state.noPaymentProspects ?? {})
    .filter(
      (record) =>
        record.normalizedWhatsapp &&
        !activeWhatsapp.has(record.normalizedWhatsapp) &&
        record.paidAmount <= 0,
    )
    .sort((a, b) => TEXT_COLLATOR.compare(a.namaLengkap, b.namaLengkap));
  const totalPaid = activeRecords.reduce((sum, record) => sum + record.paidAmount, 0);
  const totalReceivable = activeRecords.reduce((sum, record) => sum + record.receivableAmount, 0);
  const paidOffCount = activeRecords.filter((record) => record.financialStatus === "paid_off").length;
  const receivableCount = activeRecords.filter((record) => record.receivableAmount > 0).length;
  const exceptionCount = activeRecords.filter(
    (record) =>
      record.reviewFlags.length > 0 ||
      record.financialStatus === "needs_review" ||
      record.financialStatus === "underpaid_lunas_review" ||
      record.financialStatus === "overpaid_review",
  ).length;

  const byProduct = new Map<
    string,
    { productName: string; paidAmount: number; receivableAmount: number; count: number }
  >();

  for (const record of activeRecords) {
    const current =
      byProduct.get(record.normalizedProductName) ??
      {
        productName: record.productName,
        paidAmount: 0,
        receivableAmount: 0,
        count: 0,
      };

    current.paidAmount += record.paidAmount;
    current.receivableAmount += record.receivableAmount;
    current.count += 1;
    byProduct.set(record.normalizedProductName, current);
  }

  return {
    activeRecords,
    noPaymentProspects,
    totalPaid,
    totalReceivable,
    paidOffCount,
    receivableCount,
    exceptionCount,
    byProduct: [...byProduct.values()].sort((a, b) => b.paidAmount - a.paidAmount),
  };
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

function rowToCandidate(
  row: CsvRow,
  context: {
    fileName: string;
    importId: string;
    importedAt: string;
    rowNumber: number;
  },
): ImportedCandidate {
  const reviewFlags: string[] = [];
  const whatsapp = normalizeWhatsapp(row.whatsapp);
  const product = normalizeProductName(row.productName);
  const totalPayment = parseMoney(row.totalPayment);
  const pembayaranPertama = parseMoney(row.pembayaranPertama);
  const pembayaranKedua = parseMoney(row.pembayaranKedua);
  const pilihanPembayaran = parsePaymentPlan(row.pilihanPembayaran);
  const paidAmount = pembayaranPertama.amount + pembayaranKedua.amount;
  const parsedDate = parseDate(row.tanggal);
  const rawPaymentStatus = stringValue(row.statusPembayaran).toLocaleLowerCase("id-ID");

  reviewFlags.push(...whatsapp.flags);
  if (!product.valid) reviewFlags.push("missing_product");
  if (totalPayment.invalid) reviewFlags.push("invalid_total_payment");
  if (pembayaranPertama.invalid) reviewFlags.push("invalid_first_payment");
  if (pembayaranKedua.invalid) reviewFlags.push("invalid_second_payment");
  if (totalPayment.wasBlank) reviewFlags.push("blank_total_payment");
  if (pembayaranPertama.wasBlank) reviewFlags.push("blank_first_payment");
  if (pembayaranKedua.wasBlank) reviewFlags.push("blank_second_payment");
  if (stringValue(row.tanggal) && !parsedDate) reviewFlags.push("invalid_date");
  if (pilihanPembayaran === "unknown") reviewFlags.push("unknown_payment_plan");

  const blockingFlags = reviewFlags.some((flag) =>
    [
      "missing_whatsapp",
      "short_whatsapp",
      "invalid_whatsapp",
      "ambiguous_scientific_whatsapp",
      "missing_product",
      "invalid_total_payment",
      "invalid_first_payment",
      "invalid_second_payment",
    ].includes(flag),
  );

  const financialStatus = calculateFinancialStatus({
    totalPayment: totalPayment.amount,
    paidAmount,
    pilihanPembayaran,
    hasBlockingReviewFlag: blockingFlags,
  });

  const receivableAmount =
    financialStatus === "excluded_no_payment"
      ? 0
      : Math.max(totalPayment.amount - paidAmount, 0);

  const id =
    whatsapp.valid && product.valid
      ? `${whatsapp.normalized}::${product.normalized}`
      : "";
  const rawRowHash = hashString(JSON.stringify(selectHashFields(row)));

  return {
    id,
    normalizedWhatsapp: whatsapp.normalized,
    displayWhatsapp: whatsapp.display,
    rawWhatsapp: stringValue(row.whatsapp),
    namaLengkap: stringValue(row.namaLengkap),
    normalizedProductName: product.normalized,
    productName: product.display,
    totalPayment: totalPayment.amount,
    paidAmount,
    pembayaranPertama: pembayaranPertama.amount,
    pembayaranKedua: pembayaranKedua.amount,
    receivableAmount,
    pilihanPembayaran,
    financialStatus,
    tanggal: stringValue(row.tanggal) || undefined,
    parsedDate,
    vouchers: stringValue(row.vouchers) || undefined,
    jenisPendaftaran: stringValue(row.jenisPendaftaran) || undefined,
    rawPaymentStatus: rawPaymentStatus || undefined,
    sourceFileName: context.fileName,
    rawRowHash,
    firstSeenAt: context.importedAt,
    lastSeenAt: context.importedAt,
    lastImportId: context.importId,
    reviewFlags: [...new Set(reviewFlags)],
    rowNumber: context.rowNumber,
    completenessScore: calculateCompletenessScore(row),
  };
}

function classifyDelta(candidate: ImportedCandidate, previous?: CanonicalRecord): ImportDelta {
  if (candidate.financialStatus === "needs_review") {
    return {
      id: candidate.rawRowHash,
      kind: "needs_review",
      candidate,
      previous,
    };
  }

  if (!previous) {
    return {
      id: candidate.rawRowHash,
      kind: "new_record",
      candidate,
    };
  }

  if (candidate.paidAmount < previous.paidAmount) {
    return {
      id: candidate.rawRowHash,
      kind: "unchanged",
      candidate,
      previous,
      ignoredReason: "Snapshot payment is lower than existing canonical record.",
    };
  }

  if (candidate.paidAmount > previous.paidAmount) {
    return {
      id: candidate.rawRowHash,
      kind:
        candidate.financialStatus === "paid_off" && previous.financialStatus !== "paid_off"
          ? "became_paid_off"
          : "payment_improved",
      candidate,
      previous,
    };
  }

  if (hasMetadataChanged(candidate, previous)) {
    return {
      id: candidate.rawRowHash,
      kind: "metadata_changed",
      candidate,
      previous,
    };
  }

  return {
    id: candidate.rawRowHash,
    kind: "unchanged",
    candidate,
    previous,
  };
}

function summarizeImport(candidates: ImportedCandidate[], deltas: ImportDelta[]): ImportSummary {
  const updatedRecordCount = deltas.filter((delta) =>
    ["payment_improved", "became_paid_off", "metadata_changed"].includes(delta.kind),
  ).length;

  return {
    rowCount: candidates.length,
    parsedRowCount: candidates.length,
    paidRowCount: candidates.filter((candidate) => candidate.paidAmount > 0).length,
    excludedNoPaymentCount: candidates.filter(
      (candidate) => candidate.financialStatus === "excluded_no_payment",
    ).length,
    newRecordCount: deltas.filter((delta) => delta.kind === "new_record").length,
    updatedRecordCount,
    unchangedCount: deltas.filter((delta) => delta.kind === "unchanged").length,
    exceptionCount: deltas.filter(
      (delta) =>
        delta.kind === "needs_review" ||
        delta.candidate.reviewFlags.length > 0 ||
        delta.candidate.financialStatus === "overpaid_review" ||
        delta.candidate.financialStatus === "underpaid_lunas_review",
    ).length,
  };
}

function compareCandidates(a: ImportedCandidate, b: ImportedCandidate): number {
  if (a.paidAmount !== b.paidAmount) return a.paidAmount - b.paidAmount;
  if (rankRawStatus(a.rawPaymentStatus) !== rankRawStatus(b.rawPaymentStatus)) {
    return rankRawStatus(a.rawPaymentStatus) - rankRawStatus(b.rawPaymentStatus);
  }
  if (a.completenessScore !== b.completenessScore) return a.completenessScore - b.completenessScore;
  return a.rowNumber - b.rowNumber;
}

function hasMetadataChanged(candidate: ImportedCandidate, previous: CanonicalRecord): boolean {
  return (
    candidate.namaLengkap !== previous.namaLengkap ||
    candidate.productName !== previous.productName ||
    candidate.totalPayment !== previous.totalPayment ||
    candidate.pilihanPembayaran !== previous.pilihanPembayaran ||
    candidate.rawPaymentStatus !== previous.rawPaymentStatus ||
    candidate.vouchers !== previous.vouchers ||
    candidate.jenisPendaftaran !== previous.jenisPendaftaran
  );
}

function mergeNoPaymentCandidates(
  noPaymentProspects: Record<string, NoPaymentProspect>,
  candidates: ImportedCandidate[],
  importId: string,
  now: string,
) {
  const grouped = new Map<string, ImportedCandidate>();

  for (const candidate of candidates) {
    if (
      candidate.paidAmount > 0 ||
      !candidate.normalizedWhatsapp ||
      candidate.reviewFlags.includes("missing_whatsapp") ||
      candidate.reviewFlags.includes("short_whatsapp") ||
      candidate.reviewFlags.includes("invalid_whatsapp") ||
      candidate.reviewFlags.includes("ambiguous_scientific_whatsapp")
    ) {
      continue;
    }

    const current = grouped.get(candidate.normalizedWhatsapp);
    if (!current || compareNoPaymentCandidates(candidate, current) > 0) {
      grouped.set(candidate.normalizedWhatsapp, candidate);
    }
  }

  for (const candidate of grouped.values()) {
    const previous = noPaymentProspects[candidate.normalizedWhatsapp];
    noPaymentProspects[candidate.normalizedWhatsapp] = {
      ...candidate,
      id: candidate.normalizedWhatsapp,
      financialStatus: "excluded_no_payment",
      firstNoPaymentSeenAt: previous?.firstNoPaymentSeenAt ?? candidate.firstSeenAt,
      lastNoPaymentSeenAt: now,
      noPaymentImportCount: (previous?.noPaymentImportCount ?? 0) + 1,
      firstSeenAt: previous?.firstSeenAt ?? candidate.firstSeenAt,
      lastSeenAt: now,
      lastImportId: importId,
    };
  }
}

function removeConvertedNoPaymentProspects(
  noPaymentProspects: Record<string, NoPaymentProspect>,
  records: Record<string, CanonicalRecord>,
) {
  const paidWhatsapps = new Set(
    Object.values(records)
      .filter((record) => record.financialStatus !== "excluded_no_payment" && record.paidAmount > 0)
      .map((record) => record.normalizedWhatsapp),
  );

  for (const normalizedWhatsapp of Object.keys(noPaymentProspects)) {
    if (paidWhatsapps.has(normalizedWhatsapp)) {
      delete noPaymentProspects[normalizedWhatsapp];
    }
  }
}

function compareNoPaymentCandidates(a: ImportedCandidate, b: ImportedCandidate): number {
  if (a.reviewFlags.length !== b.reviewFlags.length) return b.reviewFlags.length - a.reviewFlags.length;
  if (a.completenessScore !== b.completenessScore) return a.completenessScore - b.completenessScore;
  if (a.parsedDate && b.parsedDate && a.parsedDate !== b.parsedDate) {
    return TEXT_COLLATOR.compare(a.parsedDate, b.parsedDate);
  }
  return a.rowNumber - b.rowNumber;
}

function normalizeNoPaymentProspects(
  value: Partial<DashboardState>["noPaymentProspects"] | undefined,
): Record<string, NoPaymentProspect> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const prospects: Record<string, NoPaymentProspect> = {};

  for (const [key, prospect] of Object.entries(value)) {
    if (!prospect || !prospect.normalizedWhatsapp || prospect.paidAmount > 0) {
      continue;
    }

    const normalizedWhatsapp = prospect.normalizedWhatsapp || key;
    prospects[normalizedWhatsapp] = {
      ...prospect,
      id: normalizedWhatsapp,
      financialStatus: "excluded_no_payment",
      firstNoPaymentSeenAt: prospect.firstNoPaymentSeenAt ?? prospect.firstSeenAt,
      lastNoPaymentSeenAt: prospect.lastNoPaymentSeenAt ?? prospect.lastSeenAt,
      noPaymentImportCount: prospect.noPaymentImportCount ?? 1,
    };
  }

  return prospects;
}

function normalizeDashboardSettings(settings: Partial<DashboardSettings> | undefined): DashboardSettings {
  const defaults = createDefaultDashboardSettings();

  if (!settings || typeof settings !== "object") {
    return defaults;
  }

  const productAliases =
    settings.productAliases && typeof settings.productAliases === "object"
      ? { ...settings.productAliases }
      : {};
  const waMessageTemplates = Array.isArray(settings.waMessageTemplates)
    ? settings.waMessageTemplates
        .map((template, index) => normalizeWaMessageTemplate(template, index))
        .filter((template): template is WaMessageTemplate => Boolean(template))
    : defaults.waMessageTemplates;
  const templateIds = new Set(waMessageTemplates.map((template) => template.id));
  const missingDefaultTemplates = defaults.waMessageTemplates.filter(
    (template) => !templateIds.has(template.id),
  );

  return {
    productAliases,
    waMessageTemplates:
      waMessageTemplates.length > 0
        ? [...waMessageTemplates, ...missingDefaultTemplates]
        : defaults.waMessageTemplates,
  };
}

function normalizeWaMessageTemplate(
  value: unknown,
  index: number,
): WaMessageTemplate | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const template = value as Partial<WaMessageTemplate>;
  const name = String(template.name ?? "").trim();
  const body = String(template.body ?? "").trim();

  if (!name || !body) {
    return null;
  }

  const id = String(template.id ?? "").trim() || `imported-wa-template-${index + 1}`;
  const now = new Date().toISOString();

  return {
    id,
    name,
    body,
    builtIn: Boolean(template.builtIn),
    createdAt: String(template.createdAt ?? now),
    updatedAt: String(template.updatedAt ?? template.createdAt ?? now),
  };
}

function parsePaymentPlan(rawValue: unknown): PaymentPlan {
  const normalized = stringValue(rawValue).toLocaleLowerCase("id-ID");
  if (normalized === "lunas" || normalized === "cicil") return normalized;
  return "unknown";
}

function normalizeHeader(header: string): string {
  return header.replace(/^\uFEFF/, "").trim();
}

function isEmptyRow(row: CsvRow): boolean {
  return Object.entries(row)
    .filter(([key]) => !key.startsWith("__empty_"))
    .every(([, value]) => stringValue(value).length === 0);
}

function stringValue(value: unknown): string {
  return String(value ?? "").trim();
}

function countOutsideQuotes(input: string, char: "," | ";"): number {
  let count = 0;
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const current = input[index];
    if (current === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && current === char) {
      count += 1;
    }
  }

  return count;
}

function selectHashFields(row: CsvRow): Record<string, string> {
  return {
    whatsapp: stringValue(row.whatsapp),
    namaLengkap: stringValue(row.namaLengkap),
    productName: stringValue(row.productName),
    tanggal: stringValue(row.tanggal),
    totalPayment: stringValue(row.totalPayment),
    pilihanPembayaran: stringValue(row.pilihanPembayaran),
    pembayaranPertama: stringValue(row.pembayaranPertama),
    pembayaranKedua: stringValue(row.pembayaranKedua),
    statusPembayaran: stringValue(row.statusPembayaran),
    vouchers: stringValue(row.vouchers),
  };
}

function calculateCompletenessScore(row: CsvRow): number {
  return [
    row.whatsapp,
    row.namaLengkap,
    row.productName,
    row.totalPayment,
    row.tanggal,
    row.pilihanPembayaran,
    row.pembayaranPertama,
    row.pembayaranKedua,
    row.vouchers,
    row.statusPembayaran,
    row.jenisPendaftaran,
    row.kolektif,
  ].filter((value) => stringValue(value).length > 0).length;
}

function rankRawStatus(rawStatus?: string): number {
  return RAW_STATUS_RANK[stringValue(rawStatus).toLocaleLowerCase("id-ID")] ?? 0;
}

function formatWhatsapp(value: string): string {
  if (!value.startsWith("62")) return value;
  return `+${value}`;
}

function createId(prefix: string, seed = `${Date.now()}:${Math.random()}`): string {
  return `${prefix}_${hashString(seed)}`;
}

function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
