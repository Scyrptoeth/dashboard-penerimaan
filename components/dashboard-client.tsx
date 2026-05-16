"use client";

import {
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  Database,
  Download,
  FileJson,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  buildImportPreview,
  createEmptyState,
  createExportState,
  formatCurrency,
  getDashboardMetrics,
  mergeImportPreview,
  validateImportedState,
  type CanonicalRecord,
  type DashboardState,
  type FinancialStatus,
  type ImportPreview,
} from "@/lib/domain";
import {
  clearStoredState,
  loadStoredState,
  loadUndoState,
  saveStoredState,
  saveUndoState,
} from "@/lib/storage";

type TabId = "overview" | "records" | "receivables" | "products" | "exceptions" | "history";
type SortDirection = "asc" | "desc";
type SortKey =
  | "name"
  | "whatsapp"
  | "product"
  | "mechanism"
  | "status"
  | "firstPayment"
  | "secondPayment"
  | "totalPayment"
  | "remainingPayment";
type SortConfig = {
  key: SortKey;
  direction: SortDirection;
};

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "records", label: "Records" },
  { id: "receivables", label: "Piutang" },
  { id: "products", label: "Produk" },
  { id: "exceptions", label: "Exceptions" },
  { id: "history", label: "Import History" },
];

const STATUS_META: Record<FinancialStatus, { label: string; tone: string }> = {
  paid_off: { label: "Lunas", tone: "success" },
  installment_receivable: { label: "Cicilan", tone: "warning" },
  underpaid_lunas_review: { label: "Kurang bayar", tone: "danger" },
  overpaid_review: { label: "Overpaid", tone: "danger" },
  needs_review: { label: "Review", tone: "danger" },
  excluded_no_payment: { label: "Tanpa bayar", tone: "muted" },
};

const STATUS_OPTIONS = Object.keys(STATUS_META) as FinancialStatus[];

const DELTA_LABELS = {
  new_record: "Baru",
  payment_improved: "Pembayaran naik",
  became_paid_off: "Menjadi lunas",
  metadata_changed: "Metadata berubah",
  unchanged: "Tidak berubah",
  needs_review: "Perlu review",
};

const TEXT_COLLATOR = new Intl.Collator("id-ID", {
  numeric: true,
  sensitivity: "base",
});

export function DashboardClient() {
  const [state, setState] = useState<DashboardState>(() => createEmptyState());
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [query, setQuery] = useState("");
  const [statusFilters, setStatusFilters] = useState<FinancialStatus[]>([]);
  const [productFilters, setProductFilters] = useState<string[]>([]);
  const [notice, setNotice] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(loadStoredState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) {
      saveStoredState(state);
    }
  }, [hydrated, state]);

  const metrics = useMemo(() => getDashboardMetrics(state), [state]);
  const products = metrics.byProduct;
  const productOptions = useMemo(
    () => products.map((product) => product.productName).sort((a, b) => a.localeCompare(b)),
    [products],
  );

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("id-ID");

    return metrics.activeRecords
      .filter((record) => {
        if (statusFilters.length > 0 && !statusFilters.includes(record.financialStatus)) return false;
        if (productFilters.length > 0 && !productFilters.includes(record.productName)) return false;
        if (!normalizedQuery) return true;

        return [
          record.namaLengkap,
          record.displayWhatsapp,
          record.rawWhatsapp,
          record.productName,
          record.rawPaymentStatus,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase("id-ID").includes(normalizedQuery));
      })
      .sort((a, b) => b.paidAmount - a.paidAmount);
  }, [metrics.activeRecords, productFilters, query, statusFilters]);

  const receivableRecords = useMemo(
    () => filteredRecords.filter((record) => record.receivableAmount > 0),
    [filteredRecords],
  );

  const exceptionRecords = useMemo(
    () =>
      filteredRecords.filter(
        (record) =>
          record.reviewFlags.length > 0 ||
          record.financialStatus === "needs_review" ||
          record.financialStatus === "underpaid_lunas_review" ||
          record.financialStatus === "overpaid_review",
      ),
    [filteredRecords],
  );

  async function handleCsvInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      const nextPreview = buildImportPreview(text, file.name, state);
      setPreview(nextPreview);
      setActiveTab("overview");
      setError("");
      setNotice(`Preview siap: ${file.name}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "CSV gagal diproses.");
    }
  }

  async function handleJsonInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const imported = validateImportedState(JSON.parse(await file.text()));
      saveUndoState(state);
      setState(imported);
      setPreview(null);
      setNotice(`State JSON diimpor: ${file.name}`);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "JSON gagal diimpor.");
    }
  }

  function confirmMerge() {
    if (!preview) return;

    saveUndoState(state);
    setState((current) => mergeImportPreview(current, preview));
    setNotice(
      `Import digabung: ${preview.summary.newRecordCount} baru, ${preview.summary.updatedRecordCount} update.`,
    );
    setPreview(null);
    setError("");
  }

  function cancelPreview() {
    setPreview(null);
    setNotice("Preview dibatalkan.");
  }

  function exportJson() {
    const exportState = createExportState(state);
    const blob = new Blob([JSON.stringify(exportState, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dashboard-penerimaan-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice("JSON diekspor.");
  }

  function undoLastImport() {
    const undoState = loadUndoState();
    if (!undoState) {
      setError("Tidak ada state sebelum import terakhir.");
      return;
    }

    setState(undoState);
    setPreview(null);
    setNotice("State sebelum import terakhir dipulihkan.");
    setError("");
  }

  function clearData() {
    if (!window.confirm("Hapus seluruh data lokal Dashboard Penerimaan dari browser ini?")) {
      return;
    }

    clearStoredState();
    setState(createEmptyState());
    setPreview(null);
    setNotice("Data lokal dihapus.");
    setError("");
  }

  const visibleRecords =
    activeTab === "receivables"
      ? receivableRecords
      : activeTab === "exceptions"
        ? exceptionRecords
        : filteredRecords;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Bimbel Persiapantubel</p>
          <h1>Dashboard Penerimaan</h1>
        </div>

        <div className="actions" aria-label="Aksi data">
          <label className="button primary" htmlFor="csv-upload">
            <Upload aria-hidden="true" size={18} />
            Import CSV
          </label>
          <input id="csv-upload" className="sr-only" type="file" accept=".csv,text/csv" onChange={handleCsvInput} />

          <label className="button" htmlFor="json-upload">
            <FileJson aria-hidden="true" size={18} />
            Import JSON
          </label>
          <input id="json-upload" className="sr-only" type="file" accept=".json,application/json" onChange={handleJsonInput} />

          <button className="button" type="button" onClick={exportJson}>
            <Download aria-hidden="true" size={18} />
            Export JSON
          </button>
        </div>
      </header>

      {(notice || error) && (
        <div className={`notice ${error ? "danger" : "success"}`} role={error ? "alert" : "status"}>
          {error ? <AlertTriangle aria-hidden="true" size={18} /> : <CheckCircle2 aria-hidden="true" size={18} />}
          <span>{error || notice}</span>
          <button
            type="button"
            aria-label="Tutup notifikasi"
            onClick={() => {
              setNotice("");
              setError("");
            }}
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
      )}

      {preview && <ImportPreviewPanel preview={preview} onConfirm={confirmMerge} onCancel={cancelPreview} />}

      <section className="kpi-grid" aria-label="Ringkasan penerimaan">
        <Kpi label="Penerimaan" value={formatCurrency(metrics.totalPaid)} detail={`${metrics.activeRecords.length} siswa berbayar`} />
        <Kpi label="Piutang" value={formatCurrency(metrics.totalReceivable)} detail={`${metrics.receivableCount} record`} />
        <Kpi label="Lunas" value={metrics.paidOffCount.toLocaleString("id-ID")} detail="record tanpa piutang" />
        <Kpi label="Perlu Review" value={metrics.exceptionCount.toLocaleString("id-ID")} detail="anomali data" tone="danger" />
      </section>

      <section className="workspace">
        <div className="toolbar" aria-label="Filter dashboard">
          <div className="searchbox">
            <Search aria-hidden="true" size={18} />
            <label className="sr-only" htmlFor="record-search">
              Cari siswa, WhatsApp, produk, atau status
            </label>
            <input
              id="record-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari siswa, WhatsApp, produk..."
            />
          </div>

          <MultiFilter
            label="Status"
            allLabel="Semua"
            options={STATUS_OPTIONS}
            selected={statusFilters}
            onChange={setStatusFilters}
            getOptionLabel={(status) => STATUS_META[status].label}
          />

          <MultiFilter
            label="Produk"
            allLabel="Semua produk"
            options={productOptions}
            selected={productFilters}
            onChange={setProductFilters}
            getOptionLabel={(product) => product}
          />

          <button className="button subtle" type="button" onClick={undoLastImport}>
            <RotateCcw aria-hidden="true" size={18} />
            Undo
          </button>
          <button className="button danger" type="button" onClick={clearData}>
            <Trash2 aria-hidden="true" size={18} />
            Clear
          </button>
        </div>

        <nav className="tabs" aria-label="Tampilan dashboard">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={tab.id === activeTab ? "active" : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {activeTab === "overview" && (
          <div className="overview-grid">
            <ProductBreakdown products={products} />
            <ImportHistory state={state} compact />
          </div>
        )}

        {activeTab === "products" && <ProductBreakdown products={products} />}
        {activeTab === "history" && <ImportHistory state={state} />}

        {["records", "receivables", "exceptions"].includes(activeTab) && (
          <RecordsTable records={visibleRecords} emptyLabel={emptyLabelForTab(activeTab)} />
        )}
      </section>
    </main>
  );
}

function Kpi({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "danger";
}) {
  return (
    <article className={`kpi ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function MultiFilter<T extends string>({
  label,
  allLabel,
  options,
  selected,
  onChange,
  getOptionLabel,
}: {
  label: string;
  allLabel: string;
  options: T[];
  selected: T[];
  onChange: (nextSelected: T[]) => void;
  getOptionLabel: (option: T) => string;
}) {
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const summary = summarizeSelection(selected, allLabel, getOptionLabel);

  function toggleOption(option: T) {
    if (selectedSet.has(option)) {
      onChange(selected.filter((item) => item !== option));
      return;
    }

    onChange([...selected, option]);
  }

  return (
    <details className="multi-filter">
      <summary aria-label={`${label}: ${summary}`}>
        <span>
          <small>{label}</small>
          <strong title={summary}>{summary}</strong>
        </span>
        <ChevronDown aria-hidden="true" size={18} />
      </summary>
      <div className="multi-filter-menu" role="group" aria-label={`Pilihan ${label}`}>
        <label className="multi-filter-option">
          <input
            type="checkbox"
            checked={selected.length === 0}
            onChange={() => onChange([])}
          />
          <span>{allLabel}</span>
        </label>
        {options.map((option) => {
          const optionLabel = getOptionLabel(option);
          return (
            <label className="multi-filter-option" key={option}>
              <input
                type="checkbox"
                checked={selectedSet.has(option)}
                onChange={() => toggleOption(option)}
              />
              <span title={optionLabel}>{optionLabel}</span>
            </label>
          );
        })}
      </div>
    </details>
  );
}

function summarizeSelection<T extends string>(
  selected: T[],
  allLabel: string,
  getOptionLabel: (option: T) => string,
) {
  if (selected.length === 0) return allLabel;

  const firstLabel = getOptionLabel(selected[0] as T);
  if (selected.length === 1) return firstLabel;

  return `${firstLabel} +${selected.length - 1}`;
}

function ImportPreviewPanel({
  preview,
  onConfirm,
  onCancel,
}: {
  preview: ImportPreview;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const summaryItems = [
    ["Rows", preview.summary.rowCount],
    ["Paid", preview.summary.paidRowCount],
    ["No payment", preview.summary.excludedNoPaymentCount],
    ["New", preview.summary.newRecordCount],
    ["Updated", preview.summary.updatedRecordCount],
    ["Unchanged", preview.summary.unchangedCount],
    ["Review", preview.summary.exceptionCount],
  ];

  return (
    <section className="preview" aria-label="Preview import">
      <div className="preview-head">
        <div>
          <p className="eyebrow">Import preview</p>
          <h2>{preview.batch.fileName}</h2>
        </div>
        <div className="preview-actions">
          <button className="button primary" type="button" onClick={onConfirm}>
            Merge import
          </button>
          <button className="button" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>

      <div className="preview-stats">
        {summaryItems.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{Number(value).toLocaleString("id-ID")}</strong>
          </div>
        ))}
      </div>

      {(preview.missingColumns.length > 0 || preview.warnings.length > 0) && (
        <div className="warning-list" role="alert">
          {[...preview.missingColumns.map((column) => `Missing column: ${column}`), ...preview.warnings].map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}

      <div className="delta-strip">
        {preview.deltas.slice(0, 8).map((delta) => (
          <span key={delta.id} className={`badge ${delta.kind === "needs_review" ? "danger" : "neutral"}`}>
            {DELTA_LABELS[delta.kind]}
          </span>
        ))}
      </div>
    </section>
  );
}

function ProductBreakdown({
  products,
}: {
  products: Array<{ productName: string; paidAmount: number; receivableAmount: number; count: number }>;
}) {
  const maxPaid = Math.max(...products.map((product) => product.paidAmount), 1);

  return (
    <section className="panel" aria-label="Breakdown produk">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Produk</p>
          <h2>Breakdown penerimaan</h2>
        </div>
      </div>
      {products.length === 0 ? (
        <EmptyState label="Belum ada data produk." />
      ) : (
        <div className="product-list">
          {products.map((product) => (
            <article key={product.productName} className="product-row">
              <div>
                <strong>{product.productName}</strong>
                <span>
                  {product.count.toLocaleString("id-ID")} record · Piutang {formatCurrency(product.receivableAmount)}
                </span>
              </div>
              <div className="bar" aria-hidden="true">
                <span style={{ width: `${Math.max((product.paidAmount / maxPaid) * 100, 3)}%` }} />
              </div>
              <b>{formatCurrency(product.paidAmount)}</b>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ImportHistory({ state, compact = false }: { state: DashboardState; compact?: boolean }) {
  const imports = [...state.imports].reverse().slice(0, compact ? 5 : undefined);

  return (
    <section className="panel" aria-label="Import history">
      <div className="panel-head">
        <div>
          <p className="eyebrow">History</p>
          <h2>Import terakhir</h2>
        </div>
        <Database aria-hidden="true" size={22} />
      </div>
      {imports.length === 0 ? (
        <EmptyState label="Belum ada import tersimpan." />
      ) : (
        <div className="history-list">
          {imports.map((batch) => (
            <article key={batch.id}>
              <strong>{batch.fileName}</strong>
              <span>
                {new Date(batch.importedAt).toLocaleString("id-ID")} · {batch.newRecordCount} baru · {batch.updatedRecordCount} update · {batch.exceptionCount} review
              </span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function RecordsTable({ records, emptyLabel }: { records: CanonicalRecord[]; emptyLabel: string }) {
  const [sort, setSort] = useState<SortConfig>({ key: "totalPayment", direction: "desc" });
  const sortedRecords = useMemo(
    () => [...records].sort((first, second) => compareRecords(first, second, sort)),
    [records, sort],
  );

  if (records.length === 0) {
    return <EmptyState label={emptyLabel} />;
  }

  function toggleSort(key: SortKey) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <SortableHeader
              label="Nama"
              sortKey="name"
              activeSort={sort}
              onSort={toggleSort}
              sticky
            />
            <SortableHeader label="WhatsApp" sortKey="whatsapp" activeSort={sort} onSort={toggleSort} />
            <SortableHeader label="Produk" sortKey="product" activeSort={sort} onSort={toggleSort} />
            <SortableHeader label="Mekanisme" sortKey="mechanism" activeSort={sort} onSort={toggleSort} />
            <SortableHeader label="Status" sortKey="status" activeSort={sort} onSort={toggleSort} />
            <SortableHeader
              label="Pembayaran 1"
              sortKey="firstPayment"
              activeSort={sort}
              onSort={toggleSort}
              numeric
            />
            <SortableHeader
              label="Pembayaran 2"
              sortKey="secondPayment"
              activeSort={sort}
              onSort={toggleSort}
              numeric
            />
            <SortableHeader
              label="Total Pembayaran"
              sortKey="totalPayment"
              activeSort={sort}
              onSort={toggleSort}
              numeric
            />
            <SortableHeader
              label="Sisa Pembayaran"
              sortKey="remainingPayment"
              activeSort={sort}
              onSort={toggleSort}
              numeric
            />
          </tr>
        </thead>
        <tbody>
          {sortedRecords.map((record) => (
            <tr className={record.receivableAmount > 0 ? "receivable-row" : undefined} key={record.id}>
              <td className="sticky-col name-cell">
                <strong>{record.namaLengkap || "Tanpa nama"}</strong>
                <small>{record.rawPaymentStatus || "raw status kosong"}</small>
              </td>
              <td className="mono">{record.displayWhatsapp || record.rawWhatsapp}</td>
              <td>{record.productName}</td>
              <td>{formatPaymentPlan(record.pilihanPembayaran)}</td>
              <td>
                <StatusBadge status={record.financialStatus} />
              </td>
              <td className="numeric mono">{formatCurrency(record.pembayaranPertama)}</td>
              <td className="numeric mono">{formatSecondPayment(record)}</td>
              <td className="numeric mono">{formatCurrency(record.paidAmount)}</td>
              <td className="numeric mono">{formatCurrency(record.receivableAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  activeSort,
  onSort,
  numeric = false,
  sticky = false,
}: {
  label: string;
  sortKey: SortKey;
  activeSort: SortConfig;
  onSort: (key: SortKey) => void;
  numeric?: boolean;
  sticky?: boolean;
}) {
  const isActive = activeSort.key === sortKey;
  const nextDirection: SortDirection = isActive && activeSort.direction === "asc" ? "desc" : "asc";
  const orderLabel = numeric
    ? nextDirection === "asc"
      ? "paling kecil ke paling besar"
      : "paling besar ke paling kecil"
    : nextDirection === "asc"
      ? "A-Z"
      : "Z-A";

  return (
    <th
      aria-sort={isActive ? (activeSort.direction === "asc" ? "ascending" : "descending") : "none"}
      className={`${numeric ? "numeric" : ""} ${sticky ? "sticky-col" : ""}`.trim()}
      scope="col"
    >
      <button
        className="sort-button"
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`Urutkan ${label} ${orderLabel}`}
      >
        <span>{label}</span>
        <ArrowUpDown aria-hidden="true" size={14} />
      </button>
    </th>
  );
}

function StatusBadge({ status }: { status: FinancialStatus }) {
  const meta = STATUS_META[status];
  return <span className={`badge ${meta.tone}`}>{meta.label}</span>;
}

function formatPaymentPlan(plan: CanonicalRecord["pilihanPembayaran"]) {
  if (plan === "lunas") return "1x Pembayaran";
  if (plan === "cicil") return "2x Pembayaran";
  return "-";
}

function formatSecondPayment(record: CanonicalRecord) {
  if (
    record.pilihanPembayaran === "lunas" &&
    record.totalPayment > 0 &&
    record.pembayaranPertama === record.totalPayment
  ) {
    return "Lunas";
  }

  return formatCurrency(record.pembayaranKedua);
}

function compareRecords(first: CanonicalRecord, second: CanonicalRecord, sort: SortConfig) {
  const firstValue = getSortValue(first, sort.key);
  const secondValue = getSortValue(second, sort.key);
  const baseComparison =
    typeof firstValue === "number" && typeof secondValue === "number"
      ? firstValue - secondValue
      : TEXT_COLLATOR.compare(String(firstValue), String(secondValue));

  if (baseComparison !== 0) {
    return sort.direction === "asc" ? baseComparison : -baseComparison;
  }

  return TEXT_COLLATOR.compare(first.namaLengkap, second.namaLengkap);
}

function getSortValue(record: CanonicalRecord, key: SortKey): string | number {
  if (key === "name") return record.namaLengkap;
  if (key === "whatsapp") return record.normalizedWhatsapp || record.rawWhatsapp;
  if (key === "product") return record.productName;
  if (key === "mechanism") return formatPaymentPlan(record.pilihanPembayaran);
  if (key === "status") return STATUS_META[record.financialStatus].label;
  if (key === "firstPayment") return record.pembayaranPertama;
  if (key === "secondPayment") return record.pembayaranKedua;
  if (key === "totalPayment") return record.paidAmount;
  return record.receivableAmount;
}

function EmptyState({ label }: { label: string }) {
  return <div className="empty">{label}</div>;
}

function emptyLabelForTab(tab: TabId): string {
  if (tab === "receivables") return "Tidak ada piutang pada filter ini.";
  if (tab === "exceptions") return "Tidak ada exception pada filter ini.";
  return "Belum ada record pada filter ini.";
}
