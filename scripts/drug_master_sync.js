import 'dotenv/config';
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

/* ===============================
 * ENV
 * =============================== */
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ODCLOUD_SERVICE_KEY,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ODCLOUD_SERVICE_KEY) {
  throw new Error("❌ Missing env vars");
}

/* ===============================
 * MODE
 * =============================== */
const MODE = (() => {
  const arg = process.argv.find((v) => v.startsWith("--mode="));
  return arg ? arg.split("=")[1] : "daily";
})();
if (!["daily", "monthly"].includes(MODE)) {
  throw new Error("❌ mode must be daily or monthly");
}

/* ===============================
 * Supabase
 * =============================== */
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/* ===============================
 * CONST
 * =============================== */
const PER_PAGE = 200;
const UPSERT_CHUNK = 1000;

/* ===============================
 * UTIL
 * =============================== */
function norm(v) {
  return String(v ?? "")
    .replace(/[\u00A0\u2000-\u200B\u3000]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function getByMeaning(row, key) {
  for (const k of Object.keys(row)) {
    if (norm(k) === key) return row[k];
  }
  return undefined;
}

const pack = (r) => String(getByMeaning(r, "표준코드") ?? "").trim();
const base = (r) => String(getByMeaning(r, "대표코드") ?? "").trim();
const name = (r) =>
  String(
    getByMeaning(r, "한글상품명") ??
      getByMeaning(r, "제품명") ??
      "",
  ).trim();

const unit = (r) => Number(getByMeaning(r, "제품총수량") ?? 0) || 0;
const type = (r) => norm(getByMeaning(r, "전문일반구분"));
const remark = (r) => norm(getByMeaning(r, "비고"));
const cancel = (r) => getByMeaning(r, "취소일자");
const approved = (r) =>
  String(getByMeaning(r, "품목허가일자") ?? "");

/* ===============================
 * DATE
 * =============================== */
function parseApprovalDate(s) {
  if (!s) return null;
  const str = String(s).trim();

  if (/^\d{8}$/.test(str)) {
    return new Date(
      `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`,
    );
  }
  const d = new Date(str.replace(/\./g, "-"));
  return isNaN(d.getTime()) ? null : d;
}

function withinLastMonths(dateStr, months) {
  const d = parseApprovalDate(dateStr);
  if (!d) return false;
  const limit = new Date();
  limit.setMonth(limit.getMonth() - months);
  return d >= limit;
}

/* ===============================
 * UDDI
 * =============================== */
async function findLatestUddiPath() {
  const swaggerUrl =
    "https://infuser.odcloud.kr/oas/docs?namespace=15067462/v1";

  const swagger = await fetch(swaggerUrl).then((r) => r.json());

  let latestPath = "";
  let latestDate = -1;

  for (const p of Object.keys(swagger.paths ?? {})) {
    const summary = swagger.paths[p]?.get?.summary ?? "";
    const m = summary.match(/(\d{8})$/);
    if (!m) continue;

    const d = Number(m[1]);
    if (d > latestDate) {
      latestDate = d;
      latestPath = p;
    }
  }

  if (!latestPath) throw new Error("❌ Cannot find latest UDDI");

  return `https://api.odcloud.kr/api${latestPath}`;
}

/* ===============================
 * UPSERT
 * =============================== */
async function upsertBatch(records) {
  let count = 0;
  for (let i = 0; i < records.length; i += UPSERT_CHUNK) {
    const chunk = records.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase
      .from("drug_library")
      .upsert(chunk, { onConflict: "pack_barcode" });
    if (error) throw error;
    count += chunk.length;
  }
  return count;
}

/* ===============================
 * MAIN
 * =============================== */
async function run() {
  console.log(`🚀 Drug Master Sync START | mode=${MODE}`);

  const apiBase = await findLatestUddiPath();
  console.log(`🔗 Using UDDI: ${apiBase}`);

  let page = 1;
  let processed = 0;
  let upserted = 0;

  const EXCLUDED_TYPES = ["일반의약품", "한약재", "의약외품"];

  while (true) {
    const url =
      `${apiBase}` +
      `?serviceKey=${encodeURIComponent(ODCLOUD_SERVICE_KEY)}` +
      `&page=${page}` +
      `&perPage=${PER_PAGE}` +
      `&returnType=JSON`;

    const payload = await fetch(url).then((r) => r.json());
    const rows = payload.data ?? [];

    if (rows.length === 0) break;

    const batch = [];

    for (const r of rows) {
      processed++;

      if (EXCLUDED_TYPES.includes(type(r))) continue;
      if (remark(r).includes("한약재")) continue;
      if (cancel(r)) continue;
      if (MODE === "daily" && !withinLastMonths(approved(r), 3)) continue;

      const p = pack(r);
      const n = name(r);
      if (!p || !n) continue;

      const approvalDate = parseApprovalDate(approved(r));

      batch.push({
        pack_barcode: p,
        base_barcode: base(r) || null,
        drug_name: n,
        unit: unit(r),

        // ✅ 품목허가일자 추가
        approval_date: approvalDate
          ? approvalDate.toISOString()
          : null,

        updated_at: new Date().toISOString(),
      });
    }

    if (batch.length > 0) {
      upserted += await upsertBatch(batch);
    }

    console.log(
      `[sync] page=${page} rows=${rows.length} processed=${processed} upserted=${upserted}`,
    );

    page++;
  }

  console.log(`🎉 DONE | mode=${MODE} processed=${processed} upserted=${upserted}`);
}

run().catch((e) => {
  console.error("❌ SYNC FAILED", e);
  process.exit(1);
});
