# -*- coding: utf-8 -*-
"""
Rostelecom 客户流失预测项目 —— 合成数据生成器
Synthetic data generator anchored on Rostelecom's publicly disclosed 2025 figures.

用法 / Usage:
    pip install numpy pandas
    python generate_synthetic_data.py --n 30000 --months 24 --outdir ./data/raw

设计原则 / Design principles:
    1. 锚定真实 (anchored): 用户结构、ARPU、流失率取自 Ростелеком 2025 年公开披露。
    2. 注入信号 (signal injection): 先构造 logit 倾向得分再抽样，保证模型能学到结构。
    3. 保留噪声 (irreducible noise): 个体异质性项使 AUC 落在 0.78-0.85 的真实区间。
    4. 可复现 (reproducible): 固定随机种子。

⚠ 生成结果为合成数据，不代表 Ростелеком 真实客户行为。
   This is SYNTHETIC data. It does not represent real Rostelecom customer behaviour.
"""

import argparse
import os
import numpy as np
import pandas as pd


# ----------------------------------------------------------------------------
# 1. 锚点参数 (Anchor parameters)
#    来源: ПАО «Ростелеком» 2025 年度业绩公开披露 (МСФО)
#    标注 [报告] = 财报直接披露 / [推算] = 由披露数据推算 / [假设] = 需做敏感性分析
# ----------------------------------------------------------------------------

LINES = {
    #            share   churn_target  arpu   arpu_sd  label
    "mobile":      dict(share=0.55, churn=0.071, arpu=491, arpu_sd=110, note="[报告] 48.9M 用户, 流失率 7.1%"),
    "broadband":   dict(share=0.25, churn=0.090, arpu=418, arpu_sd=95,  note="[报告] 12.8M 家庭, ARPU 418₽; [假设] 流失率"),
    "iptv":        dict(share=0.12, churn=0.110, arpu=334, arpu_sd=70,  note="[报告] 7.6M 用户, ARPU 334₽; [假设] 流失率"),
    "fixed_voice": dict(share=0.08, churn=0.180, arpu=236, arpu_sd=55,  note="[报告] 8.1M 用户(-10%), ARPU 236₽; 流失率由-10%反推"),
}

REGIONS = [
    "Moscow", "Saint-Petersburg", "Central", "North-West", "Volga",
    "Southern", "Urals", "Siberia", "Far-East", "North-Caucasus",
]

CONTRACT_TYPES = ["monthly", "annual", "two_year"]
CONTRACT_PROBS = [0.55, 0.30, 0.15]          # [假设]
PAYMENT_METHODS = ["auto", "card", "invoice"]
PAYMENT_PROBS = [0.45, 0.35, 0.20]           # [假设]

# 信号注入系数 (logit scale) —— 已按实测 AUC 校准至 0.80 附近
# 调整方法: AUC > 0.92 → 调大 NOISE_SD; AUC < 0.75 → 整体放大 BETA
BETA = {
    "contract_monthly":   1.35,
    "usage_decline":      0.85,
    "tickets":            0.60,
    "bill_increase":      0.70,
    "near_contract_end":  1.50,
    "xdsl":               1.20,
    "competition":        0.70,
    "late_payments":      0.50,
    "n_products":        -0.75,
    "auto_payment":      -0.50,
    "tenure_years":      -0.25,
}
NOISE_SD = 0.50        # 个体不可观测异质性；AUC > 0.92 调大，< 0.75 调小

# ---- S5 干预历史参数（合成随机化实验 / synthetic randomized experiment）----
# 历史干预按 TREAT_SHARE 随机分配（无混淆），处理效应在 logit 尺度异质：
# 干预只降低流失（单调假设，clip 至 0），强度随客户特征变化 —— T-learner 可学。
TREAT_SHARE = 0.30     # 历史干预覆盖率
EFFECT = {
    "base": 0.35,               # 平均处理效应（logit 减量）
    "near_contract_end": 0.80,  # 合约临期客户更易被挽留话术挽回
    "unresolved_tickets": 0.50, # 服务问题导致的流失可被服务修复
    "bill_increase": 0.40,      # 价格敏感客户对优惠响应更强
    "high_competition": 0.20,   # 高竞争区域客户对挽留offer响应
    "noise_sd": 0.15,           # 个体效应噪声
}

OBS_MONTHS = 18        # 特征观测窗口
LABEL_MONTHS = 6       # 标签窗口


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-np.clip(x, -35, 35)))


def solve_intercept(z_raw, target_rate):
    """二分法求解截距 β0，使 mean(sigmoid(z_raw + β0)) == target_rate"""
    lo, hi = -15.0, 15.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if sigmoid(z_raw + mid).mean() > target_rate:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def build_customers(n, rng):
    """表 A: 客户静态属性"""
    lines = list(LINES.keys())
    shares = [LINES[l]["share"] for l in lines]
    line = rng.choice(lines, size=n, p=shares)

    df = pd.DataFrame({"customer_id": [f"RT-{i:06d}" for i in range(1, n + 1)]})
    df["business_line"] = line

    df["region"] = rng.choice(REGIONS, size=n)
    df["competition_index"] = np.round(rng.beta(2, 2, size=n), 3)   # 0-1，区域竞争强度

    # 在网时长: Gamma 分布，均值约 32 个月
    df["tenure_months"] = np.clip(rng.gamma(2.2, 14.5, size=n).astype(int), 1, 120)

    df["contract_type"] = rng.choice(CONTRACT_TYPES, size=n, p=CONTRACT_PROBS)
    df["payment_method"] = rng.choice(PAYMENT_METHODS, size=n, p=PAYMENT_PROBS)

    # 技术类型: 仅宽带与固话线有意义
    tech = np.where(
        df["business_line"].isin(["broadband", "fixed_voice"]).values,
        rng.choice(["fiber", "xdsl", "copper"], size=n, p=[0.55, 0.30, 0.15]),
        "n/a",
    )
    df["tech_type"] = tech

    # 交叉持有产品数: 1-4，宽带/移动客户更可能多产品
    base = np.where(df["business_line"].isin(["broadband", "mobile"]).values, 1.7, 0.9)
    df["n_products"] = np.clip(1 + rng.poisson(base), 1, 4)

    for p in ["mobile", "broadband", "iptv", "pbx"]:
        df[f"has_{p}"] = False
    df["has_mobile"] = (df["business_line"] == "mobile") | (
        (df["n_products"] >= 3) & (rng.random(n) < 0.5))
    df["has_broadband"] = (df["business_line"] == "broadband") | (
        (df["n_products"] >= 2) & (rng.random(n) < 0.45))
    df["has_iptv"] = (df["business_line"] == "iptv") | (
        (df["n_products"] >= 3) & (rng.random(n) < 0.4))
    df["has_pbx"] = (df["n_products"] >= 4) & (rng.random(n) < 0.3)

    # 合约到期日: 距观测窗口末的剩余天数
    days_map = {"monthly": 30, "annual": 365, "two_year": 730}
    contract_len = df["contract_type"].map(days_map).values
    elapsed = (df["tenure_months"].values * 30) % contract_len
    df["days_to_contract_end"] = np.clip(contract_len - elapsed, 0, contract_len).astype(int)

    return df


def build_monthly(df, months, rng):
    """表 B: 月度行为快照 (客户 × 月)"""
    n = len(df)
    arpu = df["business_line"].map({k: v["arpu"] for k, v in LINES.items()}).values
    arpu_sd = df["business_line"].map({k: v["arpu_sd"] for k, v in LINES.items()}).values

    # 个体随机效应: 使同一客户各月相关
    cust_eff = rng.normal(1.0, 0.18, size=n)
    # 个体流失倾向 (未观测的异质性)，用于让行为随倾向恶化
    frailty = rng.normal(0, 0.35, size=n)

    rows = []
    for m in range(1, months + 1):
        # 12 个月季节性
        season = 1 + 0.06 * np.sin(2 * np.pi * m / 12.0)

        # 使用量: 高 frailty 客户随时间下降更快
        decline = 1 - 0.020 * m * (frailty + 0.6)
        usage = np.clip(
            rng.lognormal(np.log(50) , 0.45, size=n) * cust_eff * season * decline, 1, None
        )
        calls = np.clip(rng.lognormal(np.log(220), 0.5, size=n) * cust_eff * decline, 0, None)

        # 账单: ARPU 附近 + 个体效应 + 偶发资费上调
        bill = np.clip(
            rng.normal(arpu, arpu_sd, size=n) * cust_eff * season
            + np.where(rng.random(n) < 0.03, rng.uniform(30, 120, size=n), 0),
            50, None,
        )

        # 服务工单: frailty 越高越多
        ticket_rate = np.clip(0.12 + 0.10 * (frailty + 0.5), 0.02, 1.2)
        tickets = rng.poisson(ticket_rate)
        unresolved = np.minimum(tickets, rng.poisson(ticket_rate * 0.35))

        # 故障时长: Gamma，偶发尖峰
        outage = np.round(rng.gamma(1.2, 1.4, size=n) * (1 + 2 * (rng.random(n) < 0.04)), 2)

        late = rng.poisson(np.clip(0.05 + 0.08 * (frailty + 0.4), 0.01, 0.8))
        promo = rng.random(n) < 0.12

        rows.append(pd.DataFrame({
            "customer_id": df["customer_id"].values,
            "month": m,
            "usage_gb": np.round(usage, 2),
            "call_minutes": np.round(calls, 0),
            "bill_amount": np.round(bill, 2),
            "support_tickets": tickets,
            "unresolved_tickets": unresolved,
            "outage_hours": outage,
            "late_payments": late,
            "promo_active": promo,
        }))
    return pd.concat(rows, ignore_index=True)


def aggregate_features(monthly, obs_months):
    """从观测窗口聚合 as_of(OBS_MONTHS) 特征"""
    obs = monthly[monthly["month"] <= obs_months]
    g = obs.groupby("customer_id")

    recent3 = obs[obs["month"] > obs_months - 3]
    prior3 = obs[(obs["month"] > obs_months - 6) & (obs["month"] <= obs_months - 3)]
    last6 = obs[obs["month"] > obs_months - 6]

    f = pd.DataFrame({
        "usage_mean_6m": g["usage_gb"].mean(),
        "usage_last3m": recent3.groupby("customer_id")["usage_gb"].mean(),
        "usage_prior3m": prior3.groupby("customer_id")["usage_gb"].mean(),
        "tickets_6m": last6.groupby("customer_id")["support_tickets"].sum(),
        "unresolved_6m": last6.groupby("customer_id")["unresolved_tickets"].sum(),
        "tickets_12m": g["support_tickets"].sum(),
        "bill_mean_6m": g["bill_amount"].mean(),
        "bill_std_6m": g["bill_amount"].std(),
        "bill_last": obs[obs["month"] == obs_months].groupby("customer_id")["bill_amount"].mean(),
        "bill_first": obs[obs["month"] == 1].groupby("customer_id")["bill_amount"].mean(),
        "late_payments_6m": last6.groupby("customer_id")["late_payments"].sum(),
        "outage_mean_6m": g["outage_hours"].mean(),
        "promo_months": g["promo_active"].sum(),
    }).reset_index()

    # 使用量下降幅度 (0-1)
    f["usage_decline_3m"] = np.clip(
        (f["usage_prior3m"] - f["usage_last3m"]) / f["usage_prior3m"].replace(0, np.nan), 0, 1
    ).fillna(0)

    # 账单增幅 (观测窗口首尾比)
    f["bill_increase_pct"] = np.clip(
        (f["bill_last"] - f["bill_first"]) / f["bill_first"].replace(0, np.nan), -0.5, 1.0
    ).fillna(0)

    f["tickets_6m"] = f["tickets_6m"].fillna(0).clip(0, 8)
    f["late_payments_6m"] = f["late_payments_6m"].fillna(0).clip(0, 6)
    return f


def generate_labels(df, feats, rng):
    """信号注入 + 校准 + 抽样"""
    d = df.merge(feats, on="customer_id", how="left")

    z = (
        BETA["contract_monthly"] * (d["contract_type"] == "monthly").astype(float)
        + BETA["usage_decline"] * d["usage_decline_3m"]
        + BETA["tickets"] * d["tickets_6m"]
        + BETA["bill_increase"] * d["bill_increase_pct"].clip(0, None) * 2
        + BETA["near_contract_end"] * (d["days_to_contract_end"] < 60).astype(float)
        + BETA["xdsl"] * (d["tech_type"] == "xdsl").astype(float)
        + BETA["competition"] * d["competition_index"]
        + BETA["late_payments"] * d["late_payments_6m"]
        + BETA["n_products"] * d["n_products"]
        + BETA["auto_payment"] * (d["payment_method"] == "auto").astype(float)
        + BETA["tenure_years"] * (d["tenure_months"] / 12.0)
        + rng.normal(0, NOISE_SD, size=len(d))
    )

    # 按业务线校准截距，使流失率命中锚点
    p = np.zeros(len(d))
    for line, cfg in LINES.items():
        mask = (d["business_line"] == line).values
        b0 = solve_intercept(z.values[mask], cfg["churn"])
        p[mask] = sigmoid(z.values[mask] + b0)

    d["_true_risk"] = p
    d["churn_flag"] = (rng.random(len(d)) < p).astype(int)

    # 流失月份: 标签窗口内，高风险者更早离网
    churn_month = np.full(len(d), np.nan)
    cm = d["churn_flag"] == 1
    if cm.any():
        u = rng.random(cm.sum())
        early = np.clip(u * (1.6 - d.loc[cm, "_true_risk"].values), 0, 1)
        # early can equal 1 after clipping; cap the zero-based offset so it
        # never creates M25 outside a six-month M19-M24 label window.
        offset = np.minimum(np.floor(early * LABEL_MONTHS).astype(int), LABEL_MONTHS - 1)
        churn_month[cm.values] = OBS_MONTHS + 1 + offset
    d["churn_month"] = churn_month

    # 流失原因: 按主要驱动因素归类
    reason = np.array(["unknown"] * len(d), dtype=object)
    c = d["churn_flag"].values == 1
    reason[c & (d["bill_increase_pct"].values > 0.12)] = "price"
    reason[c & (d["tickets_6m"].values >= 3)] = "quality"
    reason[c & (d["competition_index"].values > 0.75)] = "competitor"
    reason[c & (d["tech_type"].values == "xdsl") & (d["business_line"].values == "broadband")] = "tech_migration"
    reason[c & (d["business_line"].values == "fixed_voice")] = "tech_migration"
    d["churn_reason"] = reason

    return d


def generate_treatment_history(full, rng):
    """S5 合成干预历史：随机分配（无混淆）+ 异质处理效应。

    叙事：在观测期结束前的上一周期，公司对随机 30% 客户做过挽留干预，
    本表记录"谁被干预过(treated)"与"该周期是否流失(churned)"。
    处理后的流失概率 = sigmoid(logit(p0) - effect(x))，效应依特征异质；
    效应被 clip 至非负（干预不增加流失的单调假设）。
    真实个体效应不写入 CSV —— T-learner 必须从数据估计。
    """
    d = full
    treated = rng.random(len(d)) < TREAT_SHARE
    effect = (
        EFFECT["base"]
        + EFFECT["near_contract_end"] * (d["days_to_contract_end"] < 60).astype(float)
        + EFFECT["unresolved_tickets"] * (d["unresolved_6m"] > 0).astype(float)
        + EFFECT["bill_increase"] * (d["bill_increase_pct"] > 0.10).astype(float)
        + EFFECT["high_competition"] * (d["competition_index"] > 0.70).astype(float)
        + rng.normal(0, EFFECT["noise_sd"], size=len(d))
    ).clip(lower=0.0)
    p0 = d["_true_risk"].clip(1e-6, 1 - 1e-6).values
    logit0 = np.log(p0 / (1 - p0))
    p_hist = sigmoid(logit0 - treated * effect.values)
    churned = (rng.random(len(d)) < p_hist).astype(int)
    return pd.DataFrame({
        "customer_id": d["customer_id"].values,
        "treated": treated.astype(int),
        "churned": churned,
    })


def inject_missing(monthly, rng):
    """注入真实世界的不完美"""
    idx = rng.choice(monthly.index, size=int(len(monthly) * 0.08), replace=False)
    monthly.loc[idx, "outage_hours"] = np.nan
    idx2 = rng.choice(monthly.index, size=int(len(monthly) * 0.03), replace=False)
    monthly.loc[idx2, "call_minutes"] = np.nan
    return monthly


def validate(df, monthly):
    """锚点校验 —— 生成后必须能对上财报数字"""
    print("\n" + "=" * 62)
    print("锚点校验 / Anchor validation")
    print("=" * 62)
    print(f"{'业务线':<14}{'目标流失率':>10}{'实际流失率':>12}{'目标ARPU':>10}{'实际ARPU':>10}")
    print("-" * 62)
    ok = True
    for line, cfg in LINES.items():
        sub = df[df["business_line"] == line]
        m = monthly[monthly["customer_id"].isin(sub["customer_id"])]
        actual_churn = sub["churn_flag"].mean()
        actual_arpu = m["bill_amount"].mean()
        flag = "OK" if abs(actual_churn - cfg["churn"]) < 0.015 else "CHECK"
        if flag == "CHECK":
            ok = False
        print(f"{line:<14}{cfg['churn']:>10.3f}{actual_churn:>12.3f}"
              f"{cfg['arpu']:>10.0f}{actual_arpu:>10.1f}  [{flag}]")
    print("-" * 62)
    print(f"客户总数        : {len(df):,}")
    print(f"月度记录数      : {len(monthly):,}")
    print(f"总流失率        : {df['churn_flag'].mean():.3f}")
    print(f"缺失率(outage)  : {monthly['outage_hours'].isna().mean():.3f}")
    print("=" * 62)
    print("\n下一步: 用 LightGBM 快速试跑，确认 AUC 落在 0.78-0.85。")
    print("若 AUC > 0.92 → 调大 NOISE_SD; 若 < 0.70 → 调小 NOISE_SD 或加大 BETA 系数。\n")
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=30000, help="客户数量 (默认 30000)")
    ap.add_argument("--months", type=int, default=24, help="时间跨度月数 (默认 24)")
    ap.add_argument("--seed", type=int, default=42, help="随机种子 (默认 42)")
    ap.add_argument("--outdir", type=str, default="./data/raw", help="输出目录")
    args = ap.parse_args()

    global OBS_MONTHS, LABEL_MONTHS
    LABEL_MONTHS = args.months - OBS_MONTHS
    if LABEL_MONTHS < 3:
        raise ValueError("months 需大于 OBS_MONTHS + 3 (默认 OBS_MONTHS=18)")

    rng = np.random.default_rng(args.seed)
    os.makedirs(args.outdir, exist_ok=True)

    print(f"生成合成数据: n={args.n:,}, months={args.months}, seed={args.seed}")
    print("数据来源: ПАО «Ростелеком» 2025 年度公开披露 (锚定) —— 结果为合成数据\n")

    customers = build_customers(args.n, rng)
    monthly = build_monthly(customers, args.months, rng)
    monthly = inject_missing(monthly, rng)
    feats = aggregate_features(monthly, OBS_MONTHS)
    full = generate_labels(customers, feats, rng)

    base_cols = ["customer_id", "business_line", "region", "competition_index",
                 "tenure_months", "contract_type", "payment_method", "tech_type",
                 "n_products", "has_mobile", "has_broadband", "has_iptv", "has_pbx",
                 "days_to_contract_end"]
    feat_cols = [c for c in feats.columns if c != "customer_id"]
    label_cols = ["customer_id", "churn_flag", "churn_month", "churn_reason"]

    base_out = os.path.join(args.outdir, "customer_base.csv")
    monthly_out = os.path.join(args.outdir, "monthly_usage.csv")
    label_out = os.path.join(args.outdir, "churn_events.csv")

    full[base_cols].to_csv(base_out, index=False, encoding="utf-8-sig")
    monthly.to_csv(monthly_out, index=False, encoding="utf-8-sig")
    full[label_cols].to_csv(label_out, index=False, encoding="utf-8-sig")

    # 特征宽表 (供建模直接消费)
    model_df = full[base_cols + ["churn_flag", "churn_month"]].merge(feats, on="customer_id")
    model_df.to_csv(os.path.join(args.outdir, "model_table.csv"),
                    index=False, encoding="utf-8-sig")

    # S5 干预历史（随机化实验，供 T-learner 估计个体增益）
    hist = generate_treatment_history(full, rng)
    hist_out = os.path.join(args.outdir, "intervention_history.csv")
    hist.to_csv(hist_out, index=False, encoding="utf-8-sig")
    rate_t, rate_c = (hist.loc[hist.treated == t, "churned"].mean() for t in (1, 0))
    print(f"\n干预历史: 覆盖率={hist.treated.mean():.1%}  对照组流失率={rate_c:.3f}  "
          f"干预组流失率={rate_t:.3f}  ATE≈{(rate_c - rate_t):+.3f}（正值=干预有效）")

    validate(full, monthly)
    print("已输出 / Written:")
    for p in [base_out, monthly_out, label_out,
              os.path.join(args.outdir, "model_table.csv"), hist_out]:
        print(f"  {p}  ({os.path.getsize(p)/1024/1024:.1f} MB)")


if __name__ == "__main__":
    main()
