import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

type Row = Record<string, string | number>;
type Snapshot = {
  meta: Record<string, unknown>;
  dashboard: Record<string, any>;
  customers: Row[];
  details: Record<string, Record<string, any>>;
  version: string;
};

let cached: Snapshot | undefined;

function snapshot(): Snapshot {
  if (!cached) {
    const file = new URL("../generated/snapshot.json.gz", import.meta.url);
    cached = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"));
  }
  return cached;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function error(detail: string, status: number): Response {
  return json({ detail }, status);
}

function filtered(data: Snapshot, filters: URLSearchParams | Record<string, any>): Row[] {
  const get = (key: string) => filters instanceof URLSearchParams ? filters.get(key) || "" : filters[key] || "";
  const line = get("line"), band = get("band"), region = get("region"), search = String(get("search")).toLowerCase();
  return data.customers.filter((row) =>
    (!line || row.business_line === line) && (!band || row.band === band) &&
    (!region || row.region === region) && (!search || String(row.customer_id).toLowerCase().includes(search)),
  );
}

function publicDetail(data: Snapshot, id: string): Record<string, unknown> | undefined {
  const customer = data.customers.find((row) => row.customer_id === id);
  const detail = data.details[id];
  if (!customer || !detail) return undefined;
  return {
    ...customer, ...detail,
    contributions: detail.contributions.map(([feature, name, value]: [string, string, number]) => ({ feature, name, value })),
    history: detail.history.map(([month, usage_gb, bill_amount, support_tickets]: number[]) =>
      ({ month, usage_gb, bill_amount, support_tickets })),
    suggestion: "优先核实客户服务体验与续约意愿，根据实际反馈选择干预渠道。",
  };
}

function csv(rows: Row[]): string {
  const columns = ["customer_id", "business_line", "region", "tenure_months", "n_products", "arpu",
    "score", "band", "clv", "gain", "reason", "evaluation_split"];
  const quote = (value: unknown) => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return "\uFEFF" + [columns.join(","), ...rows.map((row) => columns.map((key) => quote(row[key])).join(","))].join("\n");
}

function simulate(data: Snapshot, body: Record<string, any>): Response {
  const cost = Number(body.cost ?? 800), success = Number(body.success ?? 1);
  const maxK = Number(body.max_k ?? 3000), months = Number(body.clv_months ?? 18);
  const budget = body.budget === null || body.budget === undefined ? null : Number(body.budget);
  if (!(cost > 0 && cost <= 100000) || !(success >= 0 && success <= 2) ||
      !(maxK >= 0 && maxK <= 30000) || !(months >= 1 && months <= 60) ||
      (budget !== null && !(budget >= 0 && budget <= 1e10))) return error("仿真参数超出允许范围", 422);
  let rows = filtered(data, body.filters || {});
  if (body.customer_ids !== null && body.customer_ids !== undefined) {
    if (!Array.isArray(body.customer_ids) || body.customer_ids.length > 30000) return error("客户名单格式无效", 422);
    const ids = new Set(body.customer_ids);
    for (const id of ids) if (!data.details[id]) return error(`客户编号不存在: ${id}`, 404);
    rows = rows.filter((row) => ids.has(row.customer_id));
  }
  const candidates = rows.map((row) => {
    const detail = data.details[String(row.customer_id)];
    const p0 = Number(detail.p0), p1 = Number(detail.p1);
    const p_after = Math.min(1, Math.max(0, p0 - success * (p0 - p1)));
    const rescue = p0 - p_after;
    const expected_gross = rescue * Number(row.arpu) * months;
    return { ...row, uplift: Number(detail.uplift), p0, p1, p_after, rescue,
      expected_gross, expected_net: expected_gross - cost };
  }).sort((a, b) => b.expected_net - a.expected_net || String(a.customer_id).localeCompare(String(b.customer_id)));
  let n = Math.min(Math.trunc(maxK), candidates.length);
  if (budget !== null) n = Math.min(n, Math.floor(budget / cost));
  const gross = [0], net = [0];
  for (let i = 0; i < n; i++) {
    gross.push(gross[i] + candidates[i].expected_gross);
    net.push(gross[i + 1] - (i + 1) * cost);
  }
  let best = 0;
  for (let i = 1; i < net.length; i++) if (net[i] > net[best]) best = i;
  const stepSet = new Set<number>([best]);
  const points = Math.min(n + 1, 101);
  for (let i = 0; i < points; i++) stepSet.add(points === 1 ? 0 : Math.trunc(i * n / (points - 1)));
  const names = ["可挽回", "需说服", "高风险、低预计干预响应", "无需打扰"];
  const counts = [0, 0, 0, 0];
  for (const row of candidates) {
    const risky = Number(row.score) >= .4, sensitive = row.rescue >= .04;
    counts[risky && sensitive ? 0 : !risky && sensitive ? 1 : risky ? 2 : 3]++;
  }
  const mean = (key: "uplift" | "rescue") => candidates.length
    ? candidates.reduce((sum, row) => sum + row[key], 0) / candidates.length : 0;
  return json({
    candidate_count: candidates.length, best_k: best, net: net[best], gross: gross[best], cost: best * cost,
    roi: best ? net[best] / (best * cost) : null,
    random_net: candidates.length ? best * candidates.reduce((sum, row) => sum + row.expected_net, 0) / candidates.length : 0,
    mean_uplift: mean("uplift"), mean_rescue: mean("rescue"),
    curve: [...stepSet].sort((a, b) => a - b).map((k) => ({ k, gross: gross[k], net: net[k], cost: k * cost })),
    intervention_validation: data.dashboard.intervention_validation,
    groups: names.map((name, i) => ({ name, value: counts[i] })),
    customers: candidates.slice(0, best).slice(0, 30).map(({ customer_id, business_line, score, uplift,
      expected_net, p0, p1, p_after, rescue }) =>
      ({ customer_id, business_line, score, uplift, expected_net, p0, p1, p_after, rescue })),
  });
}

export default async (request: Request): Promise<Response> => {
  const data = snapshot();
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/health")
    return json({ status: "ok", version: data.version, synthetic: true, runtime: "netlify" });
  if (request.method === "GET" && path === "/api/meta") return json(data.meta);
  if (request.method === "GET" && path === "/api/dashboard") return json(data.dashboard);
  if (request.method === "GET" && path === "/api/customers/export") {
    const rows = filtered(data, url.searchParams).sort((a, b) => Number(b.score) - Number(a.score));
    return new Response(csv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="churn-risk-list.csv"' } });
  }
  if (request.method === "GET" && path === "/api/customers") {
    const page = Number(url.searchParams.get("page") || 1), pageSize = Number(url.searchParams.get("page_size") || 20);
    const sort = url.searchParams.get("sort") || "score", direction = url.searchParams.get("direction") || "desc";
    const allowed = new Set(["score", "customer_id", "arpu", "clv", "gain", "tenure_months"]);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
        !allowed.has(sort) || !["asc", "desc"].includes(direction)) return error("查询参数无效", 422);
    const rows = filtered(data, url.searchParams).sort((a, b) => {
      const av = a[sort], bv = b[sort];
      const comparison = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return (direction === "asc" ? comparison : -comparison) || String(a.customer_id).localeCompare(String(b.customer_id));
    });
    return json({ total: rows.length, page, page_size: pageSize, items: rows.slice((page - 1) * pageSize, page * pageSize) });
  }
  const match = path.match(/^\/api\/customers\/(RT-\d+)$/);
  if (request.method === "GET" && match) {
    const detail = publicDetail(data, match[1]);
    return detail ? json(detail) : error("客户编号不存在", 404);
  }
  if (request.method === "POST" && ["/api/score", "/api/batch_score", "/api/simulate"].includes(path)) {
    let body: Record<string, any>;
    try { body = await request.json(); } catch { return error("请求正文不是有效 JSON", 422); }
    if (path === "/api/simulate") return simulate(data, body);
    const ids = path === "/api/score" ? [body.customer_id] : body.customer_ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 30000) return error("客户名单格式无效", 422);
    const items: Row[] = [];
    for (const id of ids) {
      const row = data.customers.find((candidate) => candidate.customer_id === id);
      if (!row) return error("客户编号不存在", 404);
      items.push(row);
    }
    return json(path === "/api/score" ? items[0] : { items });
  }
  return error("接口不存在", 404);
};

export const config = { path: "/api/*" };
