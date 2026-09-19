export type Filters = {
  line: string;
  band: string;
  region: string;
  search: string;
};
export const emptyFilters: Filters = {
  line: "",
  band: "",
  region: "",
  search: "",
};
export type Customer = {
  customer_id: string;
  business_line: string;
  region: string;
  tenure_months: number;
  n_products: number;
  arpu: number;
  score: number;
  band: string;
  clv: number;
  gain: number;
  reason: string;
  evaluation_split: string;
};
export type Channel = {
  id: string;
  name: string;
  cost: number;
  success: number;
  description: string;
};
export type Meta = {
  lines: Record<string, string>;
  regions: Record<string, string>;
  channels: Channel[];
  obs_months: number;
  label_months: number;
  clv_months: number;
};
export type Metrics = {
  auc: number;
  pr_auc: number;
  lift: number;
  recall: number;
  brier: number;
  ece: number;
  holdout_size: number;
  train_size: number;
  calibration_size: number;
  model: string;
  observation_months: number;
  label_months: number;
  clv_months: number;
  base_retention_cost: number;
};
export type Baseline = {
  key: string;
  name: string;
  model: string;
  note: string;
  auc: number;
  pr_auc: number;
  lift: number;
  recall: number;
  brier?: number;
  ece?: number;
};
export type AblationRow = {
  group: string;
  removed: string[];
  auc: number;
  pr_auc: number;
  lift: number;
  recall: number;
  delta_pr_auc: number;
  delta_lift: number;
};
export type Dashboard = {
  total: number;
  monthly_rows: number;
  invalid_event_months: number;
  average_risk: number;
  high: number;
  expected_revenue_at_risk: number;
  version: string;
  metrics: Metrics;
  baselines: Baseline[];
  ablation: AblationRow[];
  uplift_stats: {
    ate: number;
    p90: number;
    sensitive: number;
    recoverable: number;
  };
  bands: { key: string; name: string; value: number }[];
  lines: {
    key: string;
    name: string;
    total: number;
    predicted: number;
    observed: number;
    high: number;
  }[];
  trend: ({ month: number } & Record<string, number>)[];
  importance: { name: string; value: number }[];
};
export type CustomerPage = {
  total: number;
  page: number;
  page_size: number;
  items: Customer[];
};
export type Detail = Customer & {
  contract_type: string;
  payment_method: string;
  days_to_contract_end: number;
  tickets: number;
  uplift: number;
  contributions: { feature: string; name: string; value: number }[];
  base_value: number;
  raw_log_odds: number;
  history: {
    month: number;
    usage_gb: number;
    bill_amount: number;
    support_tickets: number;
  }[];
  suggestion: string;
};
export type Selection = {
  filters: Filters;
  customer_ids: string[] | null;
  name: string;
};
export type SimParams = {
  cost: number;
  success: number;
  max_k: number;
  clv_months: number;
  budget: number | null;
  filters: Filters;
  customer_ids: string[] | null;
};
export type SimResult = {
  candidate_count: number;
  best_k: number;
  net: number;
  gross: number;
  cost: number;
  roi: number | null;
  random_net: number;
  mean_uplift: number;
  mean_rescue: number;
  curve: { k: number; gross: number; net: number; cost: number }[];
  groups: { name: string; value: number }[];
  customers: {
    customer_id: string;
    business_line: string;
    score: number;
    uplift: number;
    expected_net: number;
  }[];
};

export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    signal,
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(
      typeof data?.detail === "string"
        ? data.detail
        : `请求失败 (${response.status})，请检查参数或重试。`,
    );
  }
  return response.json();
}
export const queryString = (params: object) =>
  new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
export const number = (v: number) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(v);
export const money = (v: number) => `${number(v)} ₽`;
export const percent = (v: number) => `${(v * 100).toFixed(1)}%`;
