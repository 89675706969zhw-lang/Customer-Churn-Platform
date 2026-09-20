import { emptyFilters, type Customer, type Dashboard, type Detail, type Meta, type SimParams, type SimResult } from "../src/api";

// Small, hand-authored contract fixtures; these are not copies of runtime output.
export const meta: Meta = {
  lines: { mobile: "移动业务", broadband: "固定宽带" },
  regions: { Moscow: "莫斯科", Siberia: "西伯利亚" },
  channels: [
    { id: "call", name: "人工电话", cost: 800, success: 1, description: "电话基准" },
    { id: "sms", name: "短信与推送", cost: 80, success: 0.35, description: "短信渠道" },
    { id: "app", name: "App 专属优惠", cost: 350, success: 0.7, description: "App 渠道" },
    { id: "visit", name: "客户经理上门", cost: 5000, success: 1.5, description: "上门渠道" },
  ],
  obs_months: 18,
  label_months: 6,
  clv_months: 18,
};

export function customer(id = "RT-000001", line = "mobile"): Customer {
  return {
    customer_id: id, business_line: line, region: "Moscow", tenure_months: 12,
    n_products: 1, arpu: 500, score: 0.8, band: "high", clv: 9000,
    gain: 100, reason: "近六月工单", evaluation_split: "holdout",
  };
}

export const detail: Detail = {
  ...customer(), contract_type: "monthly", payment_method: "card",
  days_to_contract_end: 30, tickets: 3, uplift: 0.1, p0: 0.3, p1: 0.2,
  contributions: [{ feature: "tickets_6m", name: "近六月工单", value: 0.5 }],
  base_value: 0.88629436112, raw_log_odds: 1.38629436112,
  history: [{ month: 1, usage_gb: 20, bill_amount: 500, support_tickets: 1 }],
  suggestion: "核实工单处理进度。",
};

export const dashboard: Dashboard = {
  total: 30000, monthly_rows: 720000, invalid_event_months: 0,
  average_risk: 0.08, high: 900, expected_revenue_at_risk: 1000000,
  version: "fixture", bands: [{ key: "high", name: "高风险", value: 900 }],
  lines: [{ key: "mobile", name: "移动业务", total: 30000, predicted: 0.08, observed: 0.07, high: 900 }],
  trend: Array.from({ length: 6 }, (_, i) => ({ month: i + 19, mobile: 0.01 })),
  importance: [{ name: "合约类型", value: 0.2 }],
  metrics: { auc: 0.8475, pr_auc: 0.3966, lift: 4.38, recall: 0.438, brier: 0.06, ece: 0.0071,
    holdout_size: 7500, train_size: 18000, calibration_size: 4500, model: "LightGBM + Platt",
    observation_months: 18, label_months: 6, clv_months: 18, base_retention_cost: 800 },
  baselines: [
    { key: "B0", name: "B0 规则基线", model: "规则", note: "规则", auc: 0.76, pr_auc: 0.26, lift: 3.2, recall: 0.32 },
    { key: "B1", name: "B1 逻辑回归", model: "逻辑回归", note: "线性", auc: 0.856, pr_auc: 0.422, lift: 4.63, recall: 0.463, brier: 0.06, ece: 0.0069 },
    { key: "B2", name: "B2 LightGBM", model: "LightGBM", note: "当前演示主模型", auc: 0.8475, pr_auc: 0.3966, lift: 4.38, recall: 0.438, brier: 0.06, ece: 0.0071 },
    { key: "B3", name: "B3 离散时间生存模型", model: "生存", note: "hazard", auc: 0.856, pr_auc: 0.423, lift: 4.63, recall: 0.463, brier: 0.06, ece: 0.0073 },
  ],
  ablation: [{ group: "全特征（基准）", removed: [], auc: 0.8475, pr_auc: 0.3966, lift: 4.38, recall: 0.438, delta_pr_auc: 0, delta_lift: 0 }],
  uplift_stats: { ate: 0.05, p90: 0.1, sensitive: 1000, recoverable: 500 },
  intervention_validation: {
    method: "5-fold cross-fitting + independent holdout", seed: 52, folds: 5,
    development_size: 22500, holdout_size: 7500, treatment_probability: 0.3,
    qini_ipw: 0.01, ate_ipw: 0.05, top_decile_effect_ipw: 0.1, arms: [], note: "合成实验",
  },
};

export const selection = {
  filters: { ...emptyFilters }, customer_ids: ["RT-000001"], name: "手选客户 · 1 人",
};

export function simulation(input: SimParams): SimResult {
  const candidate_count = input.customer_ids?.length ?? 41;
  const best_k = input.budget === 0 || input.max_k === 0 || input.success === 0 ? 0 : 1;
  return {
    intervention_validation: {
      method: "5-fold cross-fitting + independent holdout", seed: 52, folds: 5,
      development_size: 30, holdout_size: 10, treatment_probability: 0.3,
      qini_ipw: -0.0123, ate_ipw: 0.05, top_decile_effect_ipw: -0.1,
      arms: [{ arm: 0, size: 7, observed_rate: 0.2, predicted_rate: 0.21, brier: 0.15, auc: 0.7 },
        { arm: 1, size: 3, observed_rate: 0.1, predicted_rate: 0.11, brier: 0.09, auc: 0.65 }],
      note: "合成随机化干预实验；样本外估计不代表真实业务效果，排序指标可能为负。",
    },
    candidate_count, best_k, net: best_k * 100, gross: best_k * (100 + input.cost),
    cost: best_k * input.cost, roi: best_k ? 100 / input.cost : null,
    random_net: 0, mean_uplift: 0.1, mean_rescue: 0.1 * input.success,
    curve: [{ k: 0, gross: 0, net: 0, cost: 0 }],
    groups: [{ name: "可挽回", value: candidate_count }],
    customers: best_k ? [{ customer_id: "RT-000001", business_line: "mobile", score: 0.8, uplift: 0.1, expected_net: 100, p0: 0.3, p1: 0.2, p_after: 0.3 - 0.1 * input.success, rescue: 0.1 * input.success }] : [],
  };
}
