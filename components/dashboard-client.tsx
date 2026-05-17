"use client";

import {
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileJson,
  FileSpreadsheet,
  MessageCircle,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  buildImportPreview,
  createEmptyState,
  createExportState,
  DEFAULT_WA_MESSAGE_TEMPLATES,
  formatCurrency,
  getDashboardMetrics,
  mergeImportPreview,
  validateImportedState,
  type CanonicalRecord,
  type DashboardState,
  type FinancialStatus,
  type ImportPreview,
  type NoPaymentProspect,
  type WaMessageTemplate,
} from "@/lib/domain";
import { formatPaymentPlan, formatSecondPayment } from "@/lib/record-display";
import {
  clearStoredState,
  loadStoredState,
  loadUndoState,
  saveStoredState,
  saveUndoState,
} from "@/lib/storage";
import {
  buildWaMeDraft,
  formatWaMeBatchLine,
  WA_TEMPLATE_PLACEHOLDERS,
  type WaMeDraft,
} from "@/lib/wa-me";
import { buildRecordsXlsxBlob } from "@/lib/xlsx";

type TabId =
  | "overview"
  | "records"
  | "wa-maker"
  | "no-payment"
  | "receivables"
  | "products"
  | "exceptions"
  | "history";
type WaOutputTab = "individual" | "batch";
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
  { id: "wa-maker", label: "WA.me Maker" },
  { id: "no-payment", label: "Tanpa Bayar" },
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

const STATUS_OPTIONS = (Object.keys(STATUS_META) as FinancialStatus[]).filter(
  (status) => status !== "excluded_no_payment",
);

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
  const [recordSort, setRecordSort] = useState<SortConfig>({ key: "totalPayment", direction: "desc" });
  const [selectedWaTemplateId, setSelectedWaTemplateId] = useState(
    DEFAULT_WA_MESSAGE_TEMPLATES[0]?.id ?? "",
  );
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

  useEffect(() => {
    const templates = state.settings.waMessageTemplates;
    if (templates.length > 0 && !templates.some((template) => template.id === selectedWaTemplateId)) {
      setSelectedWaTemplateId(templates[0]?.id ?? "");
    }
  }, [selectedWaTemplateId, state.settings.waMessageTemplates]);

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
    link.download = `dashboard-penerimaan-${formatLocalDateStamp()}.json`;
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

  async function copyTextToClipboard(text: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(successMessage);
      setError("");
    } catch {
      setError("Gagal menyalin ke clipboard. Coba gunakan browser dengan izin clipboard aktif.");
    }
  }

  function saveWaTemplate(name: string, body: string) {
    const trimmedName = name.trim();
    const trimmedBody = body.trim();

    if (!trimmedName || !trimmedBody) {
      setError("Nama dan isi template WA wajib diisi.");
      return;
    }

    const now = new Date().toISOString();
    const template: WaMessageTemplate = {
      id: `wa-template-${Date.now().toString(36)}`,
      name: trimmedName,
      body: trimmedBody,
      builtIn: false,
      createdAt: now,
      updatedAt: now,
    };

    setState((current) => ({
      ...current,
      updatedAt: now,
      settings: {
        ...current.settings,
        waMessageTemplates: [...current.settings.waMessageTemplates, template],
      },
    }));
    setSelectedWaTemplateId(template.id);
    setNotice(`Template WA disimpan: ${template.name}`);
    setError("");
  }

  function deleteWaTemplate(templateId: string) {
    const template = state.settings.waMessageTemplates.find((item) => item.id === templateId);

    if (!template) return;

    if (template.builtIn) {
      setError("Template bawaan tidak dapat dihapus.");
      return;
    }

    const now = new Date().toISOString();
    const nextTemplates = state.settings.waMessageTemplates.filter((item) => item.id !== templateId);

    setState((current) => ({
      ...current,
      updatedAt: now,
      settings: {
        ...current.settings,
        waMessageTemplates: nextTemplates,
      },
    }));
    setSelectedWaTemplateId(nextTemplates[0]?.id ?? "");
    setNotice(`Template WA dihapus: ${template.name}`);
    setError("");
  }

  const visibleRecords =
    activeTab === "receivables"
      ? receivableRecords
      : activeTab === "exceptions"
        ? exceptionRecords
        : filteredRecords;
  const sortedVisibleRecords = useMemo(
    () => [...visibleRecords].sort((first, second) => compareRecords(first, second, recordSort)),
    [recordSort, visibleRecords],
  );

  function exportXlsx() {
    if (sortedVisibleRecords.length === 0) {
      setError("Tidak ada record untuk diekspor ke XLSX.");
      return;
    }

    const blob = buildRecordsXlsxBlob(sortedVisibleRecords);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dashboard-penerimaan-records-${formatLocalDateStamp()}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice(`XLSX diekspor: ${sortedVisibleRecords.length.toLocaleString("id-ID")} record.`);
    setError("");
  }

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

          <div className="export-actions" aria-label="Ekspor data">
            <button className="button" type="button" onClick={exportJson}>
              <Download aria-hidden="true" size={18} />
              Export JSON
            </button>

            <button className="button" type="button" onClick={exportXlsx} disabled={sortedVisibleRecords.length === 0}>
              <FileSpreadsheet aria-hidden="true" size={18} />
              Download XLSX
            </button>
          </div>
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

        <div className="tabs-row">
          <nav className="tabs" aria-label="Tampilan dashboard" role="tablist">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                id={`tab-${tab.id}`}
                role="tab"
                aria-selected={tab.id === activeTab}
                aria-controls={`panel-${tab.id}`}
                className={tab.id === activeTab ? "active" : ""}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div
          className="tab-panel"
          role="tabpanel"
          id={`panel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
        >
          {activeTab === "overview" && (
            <div className="overview-grid">
              <ProductBreakdown products={products} />
              <ImportHistory state={state} compact />
            </div>
          )}

          {activeTab === "wa-maker" && (
            <WaMeMaker
              records={metrics.activeRecords}
              noPaymentProspects={metrics.noPaymentProspects}
              templates={state.settings.waMessageTemplates}
              selectedTemplateId={selectedWaTemplateId}
              onTemplateChange={setSelectedWaTemplateId}
              onSaveTemplate={saveWaTemplate}
              onDeleteTemplate={deleteWaTemplate}
              onCopyText={copyTextToClipboard}
              onNotice={setNotice}
              onError={setError}
            />
          )}
          {activeTab === "no-payment" && (
            <NoPaymentTable prospects={metrics.noPaymentProspects} />
          )}
          {activeTab === "products" && <ProductBreakdown products={products} />}
          {activeTab === "history" && <ImportHistory state={state} />}

          {["records", "receivables", "exceptions"].includes(activeTab) && (
            <RecordsTable
              records={visibleRecords}
              sortedRecords={sortedVisibleRecords}
              sort={recordSort}
              onSort={setRecordSort}
              emptyLabel={emptyLabelForTab(activeTab)}
            />
          )}
        </div>
      </section>
    </main>
  );
}

type WaRecipientGroup = {
  id: string;
  label: string;
  detail: string;
  records: CanonicalRecord[];
};

type WaProcessedOutput = {
  groupLabel: string;
  templateName: string;
  processedAt: string;
  drafts: WaMeDraft[];
};

function WaMeMaker({
  records,
  noPaymentProspects,
  templates,
  selectedTemplateId,
  onTemplateChange,
  onSaveTemplate,
  onDeleteTemplate,
  onCopyText,
  onNotice,
  onError,
}: {
  records: CanonicalRecord[];
  noPaymentProspects: NoPaymentProspect[];
  templates: WaMessageTemplate[];
  selectedTemplateId: string;
  onTemplateChange: (templateId: string) => void;
  onSaveTemplate: (name: string, body: string) => void;
  onDeleteTemplate: (templateId: string) => void;
  onCopyText: (text: string, successMessage: string) => void | Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [recipientGroupId, setRecipientGroupId] = useState("receivable");
  const [outputTab, setOutputTab] = useState<WaOutputTab>("individual");
  const [draftName, setDraftName] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [processedOutput, setProcessedOutput] = useState<WaProcessedOutput | null>(null);
  const draftBodyRef = useRef<HTMLTextAreaElement | null>(null);

  const recipientGroups = useMemo(
    () => buildWaRecipientGroups(records, noPaymentProspects),
    [noPaymentProspects, records],
  );
  const selectedGroup =
    recipientGroups.find((group) => group.id === recipientGroupId) ?? recipientGroups[0];
  const selectedTemplate =
    templates.find((template) => template.id === selectedTemplateId) ?? templates[0];
  const previewDrafts = useMemo(
    () =>
      selectedGroup && selectedTemplate
        ? selectedGroup.records.map((record) => buildWaMeDraft(record, selectedTemplate.body))
        : [],
    [selectedGroup, selectedTemplate],
  );
  const previewValidCount = previewDrafts.filter((draft) => draft.ok).length;
  const previewInvalidCount = previewDrafts.length - previewValidCount;

  useEffect(() => {
    if (selectedGroup) return;
    setRecipientGroupId(recipientGroups[0]?.id ?? "all");
  }, [recipientGroups, selectedGroup]);

  function processLinks() {
    if (!selectedGroup || !selectedTemplate) {
      onError("Pilih kategori nomor WA dan template pesan terlebih dahulu.");
      return;
    }

    const drafts = selectedGroup.records.map((record) => buildWaMeDraft(record, selectedTemplate.body));
    const validCount = drafts.filter((draft) => draft.ok).length;

    setProcessedOutput({
      groupLabel: selectedGroup.label,
      templateName: selectedTemplate.name,
      processedAt: new Date().toISOString(),
      drafts,
    });
    setOutputTab("individual");
    onNotice(`WA.me diproses: ${validCount.toLocaleString("id-ID")} link siap.`);
    onError("");
  }

  function saveTemplate() {
    onSaveTemplate(draftName, draftBody);
    if (draftName.trim() && draftBody.trim()) {
      setDraftName("");
      setDraftBody("");
    }
  }

  function insertPlaceholder(placeholder: string) {
    const token = `{${placeholder}}`;
    const textarea = draftBodyRef.current;

    if (!textarea) {
      setDraftBody((current) => `${current}${token}`);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const nextBody = `${draftBody.slice(0, start)}${token}${draftBody.slice(end)}`;

    setDraftBody(nextBody);
    window.requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + token.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <section className="wa-maker" aria-label="WA.me Maker">
      <div className="wa-maker-grid">
        <section className="panel wa-panel" aria-label="Nomor WA tujuan">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Nomor WA Tujuan</p>
              <h2>Pilih kategori penerima</h2>
            </div>
            <MessageCircle aria-hidden="true" size={22} />
          </div>

          <label className="form-field" htmlFor="wa-recipient-group">
            <span>Kategori</span>
            <select
              id="wa-recipient-group"
              value={selectedGroup?.id ?? ""}
              onChange={(event) => setRecipientGroupId(event.target.value)}
            >
              {recipientGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.label}
                </option>
              ))}
            </select>
          </label>

          <div className="wa-stats" aria-label="Ringkasan penerima">
            <div>
              <span>Total penerima</span>
              <strong>{(selectedGroup?.records.length ?? 0).toLocaleString("id-ID")}</strong>
            </div>
            <div>
              <span>Siap link</span>
              <strong>{previewValidCount.toLocaleString("id-ID")}</strong>
            </div>
            <div>
              <span>Dilewati</span>
              <strong>{previewInvalidCount.toLocaleString("id-ID")}</strong>
            </div>
          </div>

          <div className="wa-preview-list" aria-label="Preview penerima">
            {(selectedGroup?.records ?? []).slice(0, 6).map((record) => (
              <article key={record.id}>
                <strong>{record.namaLengkap || "Tanpa nama"}</strong>
                <span>
                  {record.displayWhatsapp || record.rawWhatsapp} · {record.productName}
                </span>
              </article>
            ))}
            {selectedGroup && selectedGroup.records.length > 6 && (
              <p className="muted">
                +{(selectedGroup.records.length - 6).toLocaleString("id-ID")} penerima lain
              </p>
            )}
            {!selectedGroup || selectedGroup.records.length === 0 ? (
              <EmptyState label="Belum ada penerima pada kategori ini." />
            ) : null}
          </div>
        </section>

        <section className="panel wa-panel" aria-label="Pesan yang ingin dipersonalisasi">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Pesan yang Ingin Dipersonalisasi</p>
              <h2>Pilih atau simpan template</h2>
            </div>
          </div>

          <div className="template-row">
            <label className="form-field" htmlFor="wa-template">
              <span>Template</span>
              <select
                id="wa-template"
                value={selectedTemplate?.id ?? ""}
                onChange={(event) => onTemplateChange(event.target.value)}
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button danger"
              type="button"
              onClick={() => selectedTemplate && onDeleteTemplate(selectedTemplate.id)}
              disabled={!selectedTemplate || selectedTemplate.builtIn}
            >
              <Trash2 aria-hidden="true" size={18} />
              Hapus
            </button>
          </div>

          <div className="message-preview">
            <span>Isi template terpilih</span>
            <p>{selectedTemplate?.body ?? "Belum ada template."}</p>
          </div>

          <div className="placeholder-strip" aria-label="Placeholder tersedia">
            {WA_TEMPLATE_PLACEHOLDERS.map((placeholder) => (
              <button
                key={placeholder}
                type="button"
                onClick={() => insertPlaceholder(placeholder)}
                aria-label={`Tambahkan placeholder ${placeholder}`}
              >
                <code>{`{${placeholder}}`}</code>
              </button>
            ))}
          </div>

          <div className="template-editor">
            <label className="form-field" htmlFor="wa-template-name">
              <span>Nama template baru</span>
              <input
                id="wa-template-name"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="Contoh: Reminder H-3 pelunasan"
              />
            </label>
            <label className="form-field" htmlFor="wa-template-body">
              <span>Isi template baru</span>
              <textarea
                id="wa-template-body"
                ref={draftBodyRef}
                value={draftBody}
                onChange={(event) => setDraftBody(event.target.value)}
                rows={5}
                placeholder="Halo Kak {nama}, sisa pembayaran {produk} adalah {sisaPembayaran}."
              />
            </label>
            <button className="button" type="button" onClick={saveTemplate}>
              <Save aria-hidden="true" size={18} />
              Simpan Template
            </button>
          </div>
        </section>
      </div>

      <section className="panel wa-process" aria-label="Proses WA.me">
        <div>
          <p className="eyebrow">Proses</p>
          <h2>Gabungkan kategori dan template</h2>
          <p className="muted">
            {selectedGroup?.detail ?? "Belum ada kategori"} · {selectedTemplate?.name ?? "Belum ada template"}
          </p>
        </div>
        <button
          className="button primary"
          type="button"
          onClick={processLinks}
          disabled={!selectedGroup || !selectedTemplate || previewDrafts.length === 0}
        >
          <MessageCircle aria-hidden="true" size={18} />
          Proses WA.me
        </button>
      </section>

      <WaMeOutput
        output={processedOutput}
        outputTab={outputTab}
        onOutputTabChange={setOutputTab}
        onCopyText={onCopyText}
        onError={onError}
      />
    </section>
  );
}

function WaMeOutput({
  output,
  outputTab,
  onOutputTabChange,
  onCopyText,
  onError,
}: {
  output: WaProcessedOutput | null;
  outputTab: WaOutputTab;
  onOutputTabChange: (tab: WaOutputTab) => void;
  onCopyText: (text: string, successMessage: string) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const validDrafts = output?.drafts.filter((draft) => draft.ok) ?? [];
  const skippedDrafts = output?.drafts.filter((draft) => !draft.ok) ?? [];
  const unknownPlaceholders = [
    ...new Set(output?.drafts.flatMap((draft) => draft.unknownPlaceholders) ?? []),
  ];
  const batchText = validDrafts.map(formatWaMeBatchLine).join("\n");

  function copyBatch() {
    if (!batchText) {
      onError("Belum ada link batch yang bisa disalin.");
      return;
    }

    void onCopyText(batchText, `Batch disalin: ${validDrafts.length.toLocaleString("id-ID")} link.`);
  }

  return (
    <section className="panel wa-output" aria-label="Output WA.me">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Output</p>
          <h2>Link WA.me personal</h2>
        </div>
        {output && (
          <span className="muted">
            {output.groupLabel} · {new Date(output.processedAt).toLocaleString("id-ID")}
          </span>
        )}
      </div>

      <div className="mini-tabs" role="tablist" aria-label="Jenis output WA.me">
        <button
          type="button"
          role="tab"
          aria-selected={outputTab === "individual"}
          className={outputTab === "individual" ? "active" : ""}
          onClick={() => onOutputTabChange("individual")}
        >
          Individu
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={outputTab === "batch"}
          className={outputTab === "batch" ? "active" : ""}
          onClick={() => onOutputTabChange("batch")}
        >
          Batch
        </button>
      </div>

      {!output ? (
        <EmptyState label="Pilih kategori dan template, lalu proses untuk membuat link WA.me." />
      ) : (
        <>
          <div className="wa-output-summary">
            <span>{validDrafts.length.toLocaleString("id-ID")} link siap</span>
            <span>{skippedDrafts.length.toLocaleString("id-ID")} dilewati</span>
            <span>Template: {output.templateName}</span>
          </div>

          {unknownPlaceholders.length > 0 && (
            <div className="warning-list" role="alert">
              <p>Placeholder tidak dikenal tetap dibiarkan: {unknownPlaceholders.join(", ")}</p>
            </div>
          )}

          {skippedDrafts.length > 0 && (
            <div className="warning-list" role="alert">
              <p>
                {skippedDrafts.length.toLocaleString("id-ID")} record dilewati karena nomor WA tidak
                valid untuk wa.me.
              </p>
            </div>
          )}

          {outputTab === "individual" ? (
            <div className="wa-link-list">
              {validDrafts.length === 0 ? (
                <EmptyState label="Tidak ada link individu yang valid." />
              ) : (
                validDrafts.map((draft) => (
                  <article key={draft.record.id} className="wa-link-row">
                    <div>
                      <strong>{draft.record.namaLengkap || "Tanpa nama"}</strong>
                      <span>
                        {draft.record.displayWhatsapp} · {draft.record.productName}
                      </span>
                      <small className="mono">{draft.link}</small>
                    </div>
                    <div className="wa-link-actions">
                      <button
                        className="button"
                        type="button"
                        onClick={() =>
                          void onCopyText(
                            draft.link,
                            `Link disalin: ${draft.record.namaLengkap || "Tanpa nama"}`,
                          )
                        }
                      >
                        <Copy aria-hidden="true" size={18} />
                        Copy link
                      </button>
                      <a className="button primary" href={draft.link} target="_blank" rel="noreferrer">
                        <ExternalLink aria-hidden="true" size={18} />
                        Open WhatsApp
                      </a>
                    </div>
                  </article>
                ))
              )}
            </div>
          ) : (
            <div className="batch-output">
              <textarea readOnly value={batchText} aria-label="Output batch WA.me" rows={8} />
              <button className="button primary" type="button" onClick={copyBatch} disabled={!batchText}>
                <Copy aria-hidden="true" size={18} />
                Copy All
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function NoPaymentTable({ prospects }: { prospects: NoPaymentProspect[] }) {
  if (prospects.length === 0) {
    return (
      <EmptyState label="Tidak ada calon siswa tanpa bayar yang masih perlu dihubungi." />
    );
  }

  return (
    <section className="panel no-payment-panel" aria-label="Calon siswa tanpa bayar">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Tanpa Bayar</p>
          <h2>Calon siswa yang belum melakukan pembayaran</h2>
        </div>
        <span className="badge muted">{prospects.length.toLocaleString("id-ID")} record</span>
      </div>

      <div className="table-wrap">
        <table className="no-payment-table">
          <thead>
            <tr>
              <th scope="col">Nama</th>
              <th scope="col">WhatsApp</th>
              <th scope="col">Produk</th>
              <th scope="col">Tanggal</th>
              <th scope="col">Import terakhir</th>
              <th scope="col" className="numeric">Frekuensi</th>
            </tr>
          </thead>
          <tbody>
            {prospects.map((record) => (
              <tr key={record.normalizedWhatsapp}>
                <td className="name-cell">
                  <strong>{record.namaLengkap || "Tanpa nama"}</strong>
                  <small>{record.rawPaymentStatus || "raw status kosong"}</small>
                </td>
                <td className="mono">{record.displayWhatsapp || record.rawWhatsapp}</td>
                <td>{record.productName || "-"}</td>
                <td>{record.tanggal || "-"}</td>
                <td>{new Date(record.lastNoPaymentSeenAt).toLocaleString("id-ID")}</td>
                <td className="numeric mono">{record.noPaymentImportCount.toLocaleString("id-ID")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function buildWaRecipientGroups(
  records: CanonicalRecord[],
  noPaymentProspects: NoPaymentProspect[],
): WaRecipientGroup[] {
  const activeRecords = [...records].sort((first, second) =>
    TEXT_COLLATOR.compare(first.namaLengkap, second.namaLengkap),
  );
  const sortedNoPaymentProspects = [...noPaymentProspects].sort((first, second) =>
    TEXT_COLLATOR.compare(first.namaLengkap, second.namaLengkap),
  );
  const receivableRecords = activeRecords.filter((record) => record.receivableAmount > 0);
  const products = new Map<string, { label: string; records: CanonicalRecord[] }>();

  for (const record of activeRecords) {
    const current =
      products.get(record.normalizedProductName) ??
      {
        label: record.productName,
        records: [],
      };

    current.records.push(record);
    products.set(record.normalizedProductName, current);
  }

  return [
    {
      id: "all",
      label: "Seluruh Siswa",
      detail: `${activeRecords.length.toLocaleString("id-ID")} record aktif`,
      records: activeRecords,
    },
    {
      id: "receivable",
      label: "Siswa Belum Lunas",
      detail: `${receivableRecords.length.toLocaleString("id-ID")} record dengan sisa pembayaran`,
      records: receivableRecords,
    },
    {
      id: "no-payment",
      label: "Tanpa Bayar",
      detail: `${sortedNoPaymentProspects.length.toLocaleString("id-ID")} calon siswa belum bayar`,
      records: sortedNoPaymentProspects,
    },
    ...[...products.entries()]
      .sort(([, first], [, second]) => TEXT_COLLATOR.compare(first.label, second.label))
      .map(([normalizedProductName, product]) => ({
        id: `product:${normalizedProductName}`,
        label: `Produk: ${product.label}`,
        detail: `${product.records.length.toLocaleString("id-ID")} record aktif`,
        records: product.records,
      })),
  ];
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

function RecordsTable({
  records,
  sortedRecords,
  sort,
  onSort,
  emptyLabel,
}: {
  records: CanonicalRecord[];
  sortedRecords: CanonicalRecord[];
  sort: SortConfig;
  onSort: (sort: SortConfig) => void;
  emptyLabel: string;
}) {
  if (records.length === 0) {
    return <EmptyState label={emptyLabel} />;
  }

  function toggleSort(key: SortKey) {
    onSort({
      key,
      direction: sort.key === key && sort.direction === "asc" ? "desc" : "asc",
    });
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

function formatLocalDateStamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

function EmptyState({ label }: { label: string }) {
  return <div className="empty">{label}</div>;
}

function emptyLabelForTab(tab: TabId): string {
  if (tab === "receivables") return "Tidak ada piutang pada filter ini.";
  if (tab === "exceptions") return "Tidak ada exception pada filter ini.";
  return "Belum ada record pada filter ini.";
}
