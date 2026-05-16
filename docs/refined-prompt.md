# Refined Prompt - Dashboard Penerimaan

Gunakan prompt operasional ini untuk sesi grand design dan sesi awal pengembangan Dashboard Penerimaan.

## Mode Kerja

Kita sedang merancang proyek baru bernama Dashboard Penerimaan untuk Bimbel Persiapantubel. Pada sesi grand design, jangan scaffold, coding, install dependency, commit, push, atau deploy aplikasi. Boleh membuat dokumentasi desain dan skill proyek.

Gunakan Bahasa Indonesia untuk komunikasi. Gunakan English untuk code, identifiers, commit messages, dan code comments. Ikuti instruksi AGENTS.md di workspace.

## Skill Yang Aktif

Gunakan skill berikut sesuai kebutuhan:

- `start-dev` untuk alur awal pengembangan aplikasi baru.
- `ui-ux-pro-max` untuk UX, accessibility, responsive layout, forms, navigation, dan data visualization.
- `taste-ui` untuk menghindari UI generic dan AI slop.
- `next-best-practices` untuk guardrail Next.js ketika implementasi dimulai.
- `vercel-react-best-practices` untuk performa React/Next.js ketika implementasi dimulai.
- `skill-creator` hanya ketika membuat atau mengubah skill proyek.

Jangan menjalankan skill update proyek otomatis kecuali user meminta.

## Konteks Produk

Dashboard Penerimaan adalah website lokal untuk membaca CSV penerimaan Bimbel Persiapantubel, menghitung status finansial siswa, menampilkan insight penerimaan, dan membandingkan upload baru terhadap data yang sudah pernah direkam.

Masalah utama saat ini:

- Data penerimaan masih berupa CSV manual.
- Pengguna perlu mengonversi CSV ke Excel dan mengecek data satu per satu.
- Insight penerimaan, piutang, dan update pembayaran sulit dilihat cepat.

Tujuan utama:

- Upload CSV langsung di browser.
- Normalisasi dan hitung status finansial secara otomatis.
- Simpan data canonical di localStorage atau IndexedDB browser.
- Export dan import JSON untuk memindahkan state antar pengguna/perangkat.
- Saat upload CSV baru, tampilkan hanya record baru atau perubahan bermakna dari state sebelumnya.

## Keputusan Yang Sudah Dikonfirmasi

- Sesi ini membuat dokumentasi grand design dan skill proyek, bukan aplikasi Next.js.
- Status finansial dashboard dihitung sendiri dari `totalPayment`, `pilihanPembayaran`, `pembayaranPertama`, dan `pembayaranKedua`.
- `statusPembayaran` dari CSV disimpan sebagai informasi mentah atau audit, bukan sumber kebenaran lunas/piutang.
- Kunci utama record adalah `normalizedWhatsapp + normalizedProductName`.
- Jika ada beberapa baris untuk kunci yang sama, dashboard menyimpan status finansial terbaik/terbaru berdasarkan total pembayaran yang sudah masuk.
- Skill proyek dibuat di `/Users/persiapantubel/.agents/skills/` dengan nama `start-dashboard-penerimaan` dan `update-dashboard-penerimaan`.

## Data Bahan

Gunakan folder berikut sebagai sumber contoh CSV:

`/Users/persiapantubel/Desktop/codex/persiapantubel/Dashboard Penerimaan/bahan`

Temuan awal dari audit 2026-05-16:

- Ada 61 file CSV, 11.749 baris terbaca, dan sekitar 11.528 baris non-kosong.
- 59 file memakai delimiter comma, 2 file memakai semicolon: `penerimaan (23).csv` dan `penerimaan (96).csv`.
- Ada 3 variasi header.
- Ada variasi kolom tambahan `no`, trailing header kosong, dan baris kosong penuh di `penerimaan (96).csv`.
- Ada baris WhatsApp yang sudah ambigu/rusak seperti scientific notation; flag manual review.
- Ada 2 format tanggal: `dd/mm/yyyy` dan `dd/mm/yy`.
- Ada 2.516 baris tanpa pembayaran pertama atau bernilai 0 jika baris kosong ikut terbaca.
- Banyak file bersifat snapshot berulang, sehingga deduplikasi wajib.
- Latest sample `penerimaan - 2026-05-16T211644.591.csv` memiliki 280 baris, 212 unique paid keys, 157 paid off, 55 installment receivable, dan 65 excluded no payment.

## Prinsip Domain

Kolom fokus:

- `whatsapp`: identitas utama, wajib dinormalisasi.
- `namaLengkap`: identitas tampilan dan fallback investigasi.
- `productName`: produk yang dibeli, wajib dinormalisasi untuk key.
- `totalPayment`: nilai tagihan penuh.
- `pilihanPembayaran`: `lunas` atau `cicil`.
- `pembayaranPertama`: pembayaran awal.
- `pembayaranKedua`: pembayaran lanjutan.
- `statusPembayaran`: raw status audit saja.

Aturan status finansial:

- Jika `pembayaranPertama + pembayaranKedua <= 0`, exclude dari dashboard siswa berbayar.
- Jika paid amount sama dengan `totalPayment`, status `paid_off`.
- Jika paid amount lebih besar dari `totalPayment`, status `overpaid_review`.
- Jika `pilihanPembayaran = cicil` dan paid amount kurang dari `totalPayment`, status `installment_receivable`.
- Jika `pilihanPembayaran = lunas` dan paid amount kurang dari `totalPayment`, status `underpaid_lunas_review`.
- Jika data tidak lengkap atau tidak bisa diparse, status `needs_review`.

## Grand Design Yang Harus Dihasilkan

Susun desain produk yang mencakup:

- Product vision dan scope MVP.
- User journey upload, review, save, export, import.
- Data model canonical record, import batch, raw row audit, dan import diff.
- Algoritma parsing CSV, normalisasi, dedupe, status finansial, dan delta detection.
- UX dashboard: KPI, trend, product breakdown, piutang, upload summary, exception review, dan table detail.
- Design direction anti-AI slop: dashboard operasional yang dense, tenang, mudah discan, bukan landing page marketing.
- Arsitektur Next.js masa depan tanpa coding pada sesi grand design.
- Local storage strategy dan JSON portability.
- Acceptance criteria dan test plan.
- Risk register dan recommended next actions.

## Output

Buat dokumentasi di:

`/Users/persiapantubel/Desktop/codex/persiapantubel/Dashboard Penerimaan/docs`

Buat atau update skill:

- `/Users/persiapantubel/.agents/skills/start-dashboard-penerimaan`
- `/Users/persiapantubel/.agents/skills/update-dashboard-penerimaan`

Validasi skill dengan `quick_validate.py`.
