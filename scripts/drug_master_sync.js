import 'dotenv/config';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

/* =========================
 * ENV
 * ========================= */
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ODCLOUD_SERVICE_KEY,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ODCLOUD_SERVICE_KEY) {
  throw new Error('❌ Missing required environment variables');
}

/* =========================
 * MODE
 * ========================= */
const MODE = (() => {
  const arg = process.argv.find(v => v.startsWith('--mode='));
  return arg ? arg.split('=')[1] : 'daily';
})();

if (!['daily', 'monthly'].includes(MODE)) {
  throw new Error('❌ mode must be daily or monthly');
}

/* =========================
 * SUPABASE
 * ========================= */
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

/* =========================
 * CONST
 * ========================= */
const PER_PAGE = 200;
const EXCLUDED_TYPES = ['일반의약품', '한약재', '의약외품'];

/* =========================
 * UTIL
 * ========================= */
function normalize(v) {
  return String(v ?? '')
    .replace(/[\u00A0\u2000-\u200B\u3000]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function getByMeaning(row, key) {
  for (const k of Object.keys(row)) {
    if (normalize(k) === key) return row[k];
  }
  return undefined;
}

/* =========================
 * FIELD MAPPERS
 * ========================= */
const pack = r => String(getByMeaning(r, '표준코드') ?? '').trim();
const base = r => String(getByMeaning(r, '대표코드') ?? '').trim();
const name = r =>
  String(
    getByMeaning(r, '한글상품명') ??
    getByMeaning(r, '제품명') ??
    ''
  ).trim();

const unit = r => Number(getByMeaning(r, '제품총수량') ?? 0) || 0;
const category = r => normalize(getByMeaning(r, '전문일반구분'));
const remark = r => normalize(getByMeaning(r, '비고'));
const canceled = r => getByMeaning(r, '취소일자');
const approvedRaw = r => String(getByMeaning(r, '품목허가일자') ?? '').trim();

/* =========================
 * APPROVAL DATE PARSER
 * ========================= */
function parseApprovalDate(value) {
  if (!value) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value))
    return new Date(`${value}T00:00:00Z`);

  if (/^\d{4}\.\d{2}\.\d{2}$/.test(value))
    return new Date(`${value.replace(/\./g, '-') }T00:00:00Z`);

  if (/^\d{8}$/.test(value))
    return new Date(
      `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T00:00:00Z`
    );

  return null;
}

function isWithinLastMonths(value, months) {
  const d = parseApprovalDate(value);
  if (!d) return false;

  const limit = new Date();
  limit.setMonth(limit.getMonth() - months);
  return d >= limit;
}

/* =========================
 * FIND LATEST UDDI
 * ========================= */
async function findLatestUddiPath() {
  const swaggerUrl =
    'https://infuser.odcloud.kr/oas/docs?namespace=15067462/v1';

  const swagger = await fetch(swaggerUrl).then(r => r.json());

  let latestPath = '';
  let latestDate = -1;

  for (const p of Object.keys(swagger.paths ?? {})) {
    const summary = swagger.paths[p]?.get?.summary ?? '';
    const m = summary.match(/(\d{8})$/);
    if (!m) continue;

    const d = Number(m[1]);
    if (d > latestDate) {
      latestDate = d;
      latestPath = p;
    }
  }

  if (!latestPath) throw new Error('❌ Failed to detect latest UDDI');

  return `https://api.odcloud.kr/api${latestPath}`;
}

/* =========================
 * MAIN
 * ========================= */
async function run() {
  console.log(`🚀 Drug Master Sync START | mode=${MODE}`);

  const apiBase = await findLatestUddiPath();
  console.log(`🔗 Using API: ${apiBase}`);

  let page = 1;
  let processed = 0;
  let inserted = 0;
  let updated = 0;

  while (true) {
    const url =
      `${apiBase}` +
      `?serviceKey=${encodeURIComponent(ODCLOUD_SERVICE_KEY)}` +
      `&page=${page}&perPage=${PER_PAGE}&returnType=JSON`;

    const payload = await fetch(url).then(r => r.json());
    const rows = payload.data ?? [];
    if (rows.length === 0) break;

    const incoming = [];

    for (const r of rows) {
      processed++;

      if (EXCLUDED_TYPES.includes(category(r))) continue;
      if (remark(r).includes('한약재')) continue;
      if (canceled(r)) continue;

      if (MODE === 'daily' && !isWithinLastMonths(approvedRaw(r), 3)) continue;

      const p = pack(r);
      const n = name(r);
      if (!p || !n) continue;

      incoming.push({
        pack_barcode: p,
        base_barcode: base(r) || null,
        drug_name: n,
        unit: unit(r),
        approval_date: parseApprovalDate(approvedRaw(r)),
      });
    }

    if (incoming.length === 0) {
      page++;
      continue;
    }

    /* 🔍 DB 기존 데이터 조회 */
    const { data: existing } = await supabase
      .from('drug_library')
      .select('pack_barcode, base_barcode, drug_name, unit, approval_date')
      .in(
        'pack_barcode',
        incoming.map(i => i.pack_barcode)
      );

    const map = new Map(
      (existing ?? []).map(e => [e.pack_barcode, e])
    );

    const toInsert = [];
    const toUpdate = [];

    for (const row of incoming) {
      const prev = map.get(row.pack_barcode);

      if (!prev) {
        toInsert.push(row);
        continue;
      }

      const changed =
        prev.drug_name !== row.drug_name ||
        prev.base_barcode !== row.base_barcode ||
        Number(prev.unit) !== Number(row.unit) ||
        String(prev.approval_date ?? '') !== String(row.approval_date ?? '');

      if (changed) {
        toUpdate.push({
          ...row,
          updated_at: new Date().toISOString(),
        });
      }
    }

    if (toInsert.length) {
      await supabase.from('drug_library').insert(toInsert);
      inserted += toInsert.length;
    }

    for (const u of toUpdate) {
      await supabase
        .from('drug_library')
        .update(u)
        .eq('pack_barcode', u.pack_barcode);
    }

    updated += toUpdate.length;

    console.log(
      `[sync] page=${page} processed=${processed} insert=${inserted} update=${updated}`
    );

    page++;
  }

  console.log(
    `🎉 DONE | mode=${MODE} processed=${processed} inserted=${inserted} updated=${updated}`
  );
}

run().catch(err => {
  console.error('❌ SYNC FAILED', err);
  process.exit(1);
});
