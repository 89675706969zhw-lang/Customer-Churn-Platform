"""Deterministic synthetic-data model and query engine. Never modifies raw inputs."""
from pathlib import Path
import hashlib
import os

import duckdb
import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from .intervention import adjusted_effect, fit_intervention

ROOT = Path(__file__).resolve().parents[1]
RAW = Path(os.environ.get("CHURN_DATA_DIR", ROOT / "data/raw"))
CACHE = Path(os.environ.get("CHURN_CACHE_DIR", ROOT / ".runtime"))

# ---- 时间窗口与业务假设：全站唯一事实来源，前端文案与模型逻辑均从此派生 ----
OBS_MONTHS = 18              # 特征观测窗口 M1–M18
LABEL_MONTHS = 6             # 标签窗口 M19–M24
LABEL_START = OBS_MONTHS + 1
LABEL_END = OBS_MONTHS + LABEL_MONTHS
CLV_MONTHS = 18              # 客户生命周期折现月数（业务假设）
BASE_RETENTION_COST = 800    # 基准电话挽留单人成本 ₽（业务假设）
LINES = {"mobile": "移动业务", "broadband": "固定宽带", "iptv": "IPTV", "fixed_voice": "固定电话"}
REGIONS = dict(zip(
    ["Moscow", "Saint-Petersburg", "Central", "North-West", "Volga", "Southern", "Urals", "Siberia", "Far-East", "North-Caucasus"],
    ["莫斯科", "圣彼得堡", "中央区", "西北区", "伏尔加", "南部", "乌拉尔", "西伯利亚", "远东", "北高加索"]))
FEATURE_NAMES = {
    "business_line": "业务线", "region": "区域", "competition_index": "区域竞争强度",
    "tenure_months": "在网时长", "contract_type": "合约类型", "payment_method": "付费方式",
    "tech_type": "接入技术", "n_products": "产品持有数", "has_mobile": "持有移动业务",
    "has_broadband": "持有宽带", "has_iptv": "持有 IPTV", "has_pbx": "持有虚拟 PBX",
    "days_to_contract_end": "距合约到期天数", "usage_mean_6m": "观测期平均用量",
    "usage_last3m": "近三月用量", "usage_prior3m": "前三月用量", "tickets_6m": "近六月工单",
    "unresolved_6m": "未解决工单", "tickets_12m": "近一年工单", "bill_mean_6m": "平均账单",
    "bill_std_6m": "账单波动", "bill_last": "最近账单", "bill_first": "起始账单",
    "late_payments_6m": "欠费次数", "outage_mean_6m": "故障时长", "promo_months": "促销月数",
    "usage_decline_3m": "使用量下滑", "bill_increase_pct": "账单涨幅",
}
FEATURES = list(FEATURE_NAMES)
CATEGORIES = ["business_line", "region", "contract_type", "payment_method", "tech_type"]
CHANNELS = [
    dict(id="call", name="人工电话", cost=800, success=1.0,
         description="基准渠道：干预历史即电话挽留，效果系数 1.0"),
    dict(id="sms", name="短信与推送", cost=80, success=0.35,
         description="低成本触达，效果约为电话挽留的 35%"),
    dict(id="app", name="App 专属优惠", cost=350, success=0.7,
         description="资费敏感客户，效果约为电话挽留的 70%"),
    dict(id="visit", name="客户经理上门", cost=5000, success=1.5,
         description="高价值客户深度服务，效果可达电话挽留的 1.5 倍"),
]
# S5 uplift: rescue probability threshold for "intervention-sensitive" customers.
SENSITIVITY_THRESHOLD = 0.04

# S4 消融实验的特征族划分（与开题方案 S4 对齐），八族合计覆盖全部 28 个特征。
FEATURE_GROUPS = {
    "合约与付费": ["contract_type", "payment_method", "days_to_contract_end"],
    "产品持有": ["n_products", "has_mobile", "has_broadband", "has_iptv", "has_pbx"],
    "使用行为": ["usage_mean_6m", "usage_last3m", "usage_prior3m", "usage_decline_3m", "outage_mean_6m"],
    "账单与欠费": ["bill_mean_6m", "bill_std_6m", "bill_last", "bill_first", "bill_increase_pct", "late_payments_6m", "promo_months"],
    "服务工单": ["tickets_6m", "unresolved_6m", "tickets_12m"],
    "生命周期": ["tenure_months"],
    "区域与竞争": ["region", "competition_index"],
    "业务线与技术": ["business_line", "tech_type"],
}


def records(frame):
    return frame.replace([np.inf, -np.inf], np.nan).astype(object).where(pd.notna(frame), None).to_dict("records")


def ranking_metrics(y, score, p=None):
    """Ranking metrics on a shared holdout; optional probability adds calibration terms."""
    y = np.asarray(y)
    score = np.asarray(score, dtype=float)
    k = max(1, len(y) // 10)
    top = y[np.argsort(-score)[:k]]
    out = dict(auc=float(roc_auc_score(y, score)), pr_auc=float(average_precision_score(y, score)),
               lift=float(top.mean() / y.mean()), recall=float(top.sum() / y.sum()))
    if p is not None:
        p = np.asarray(p, dtype=float)
        ece = 0.
        for low in np.arange(0, 1, .1):
            mask = (p >= low) & (p < low + .1)
            if mask.any():
                ece += mask.mean() * abs(p[mask].mean() - y[mask].mean())
        out.update(brier=float(brier_score_loss(y, p)), ece=float(ece))
    return out


def rule_score(df):
    """B0 rule baseline: unsupervised ranking, no labels involved (no leakage)."""
    def rank(s):
        return s.rank(pct=True).fillna(.5)
    return (rank(df.tickets_6m) + rank(df.unresolved_6m) + rank(df.usage_decline_3m)
            + rank(df.bill_increase_pct) + (df.days_to_contract_end <= 90).astype(float)
            + (df.n_products <= 1).astype(float) * .5)


class Engine:
    def __init__(self):
        CACHE.mkdir(exist_ok=True, parents=True)
        digest = hashlib.sha256(Path(__file__).read_bytes())
        digest.update(Path(__file__).with_name("intervention.py").read_bytes())
        for name in ["model_table.csv", "customer_base.csv", "monthly_usage.csv", "churn_events.csv",
                     "intervention_history.csv"]:
            with (RAW / name).open("rb") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(chunk)
        self.version = digest.hexdigest()[:16]
        self.frame = pd.read_csv(RAW / "model_table.csv", keep_default_na=False, na_values=[""])
        if not self.frame.customer_id.is_unique:
            raise ValueError("model_table contains duplicate customers")
        self.history = pd.read_csv(RAW / "intervention_history.csv")
        if (not self.history.customer_id.is_unique
                or set(self.history.customer_id) != set(self.frame.customer_id)):
            raise ValueError("intervention_history must contain exactly one row per model customer")
        if not self.history[["treated", "churned"]].isin([0, 1]).all().all():
            raise ValueError("intervention_history treatment and outcome must be binary")
        cache = CACHE / f"model-{self.version}.joblib"
        if cache.exists():
            state = joblib.load(cache)
        else:
            state = self.train()
            joblib.dump(state, cache)
        self.model, self.calibrator = state["model"], state["calibrator"]
        self.categories, self.metrics = state["categories"], state["metrics"]
        self.baselines, self.ablation = state["baselines"], state["ablation"]
        self.uplift = state["uplift"]
        self.intervention = state["intervention"]
        self.frame["p0"] = self.intervention["p0"]
        self.frame["p1"] = self.intervention["p1"]
        self.frame["evaluation_split"] = state["splits"]
        x = self.encode(self.frame)
        margin = self.model.booster_.predict(x, raw_score=True, num_threads=4)
        self.frame["score"] = self.calibrator.predict_proba(margin.reshape(-1, 1))[:, 1]
        # LightGBM's native pred_contrib is exact TreeSHAP in raw log-odds units.
        contributions = self.model.booster_.predict(x, pred_contrib=True, num_threads=4)
        self.shap = contributions[:, :-1] * self.calibrator.coef_[0, 0]
        self.base = contributions[:, -1] * self.calibrator.coef_[0, 0] + self.calibrator.intercept_[0]
        self.frame["arpu"] = self.frame.bill_mean_6m
        self.frame["clv"] = self.frame.arpu * CLV_MONTHS
        self.frame["uplift"] = self.uplift
        self.frame["gain"] = self.frame.uplift * self.frame.clv - BASE_RETENTION_COST
        self.frame["band"] = np.select([self.frame.score >= .7, self.frame.score >= .4], ["high", "mid"], "low")
        reasons = np.argmax(self.shap, axis=1)
        self.frame["reason"] = [FEATURE_NAMES[FEATURES[i]] for i in reasons]
        self.positions = {cid: i for i, cid in enumerate(self.frame.customer_id)}
        self.db = CACHE / f"monthly-{self.version}.duckdb"
        if not self.db.exists():
            with duckdb.connect(str(self.db)) as con:
                con.execute("CREATE TABLE monthly AS SELECT * FROM read_csv_auto(?)", [str(RAW / "monthly_usage.csv")])
                con.execute("CREATE INDEX customer_month ON monthly(customer_id, month)")

    def encode(self, frame):
        x = frame[FEATURES].copy()
        for col in CATEGORIES:
            x[col] = pd.Categorical(x[col], categories=self.categories[col])
        return x

    def train(self):
        df = self.frame
        indices = np.arange(len(df))
        train, holdout = train_test_split(indices, test_size=.25, random_state=42, stratify=df.churn_flag)
        train, calibration = train_test_split(train, test_size=.2, random_state=43, stratify=df.iloc[train].churn_flag)
        self.categories = {c: sorted(df.iloc[train][c].dropna().unique().tolist()) for c in CATEGORIES}
        y = df.iloc[holdout].churn_flag.to_numpy()
        train_labels = df.iloc[train].churn_flag

        # ---- B2 LightGBM (performance mainstay) + Platt calibration ----
        x = self.encode(df)
        model = lgb.LGBMClassifier(n_estimators=220, learning_rate=.045, num_leaves=15,
                                  min_child_samples=65, reg_lambda=3, random_state=42,
                                  n_jobs=4, verbosity=-1, deterministic=True, force_col_wise=True)
        model.fit(x.iloc[train], train_labels)
        cal_margin = model.booster_.predict(x.iloc[calibration], raw_score=True, num_threads=4)
        calibrator = LogisticRegression(C=100, random_state=42)
        calibrator.fit(cal_margin.reshape(-1, 1), df.iloc[calibration].churn_flag)
        margin = model.booster_.predict(x.iloc[holdout], raw_score=True, num_threads=4)
        p = calibrator.predict_proba(margin.reshape(-1, 1))[:, 1]
        b2 = ranking_metrics(y, p, p)
        metrics = dict(b2, holdout_size=len(y), train_size=len(train), calibration_size=len(calibration),
                       model="LightGBM + Platt", seed=42, observation_months=OBS_MONTHS,
                       label_months=LABEL_MONTHS, clv_months=CLV_MONTHS,
                       base_retention_cost=BASE_RETENTION_COST)

        # ---- dense design matrix for linear models (median imputation on train + missing flags) ----
        dense = df[FEATURES].copy()
        for c in CATEGORIES:
            dense[c] = dense[c].fillna("__missing__")
        for c in [f for f in FEATURES if f not in CATEGORIES]:
            if dense[c].isna().any():
                dense[f"{c}_missing"] = dense[c].isna().astype(float)
                dense[c] = dense[c].fillna(dense.iloc[train][c].median())
        dense = pd.get_dummies(dense, columns=CATEGORIES, drop_first=True, dtype=float)

        # ---- B1 logistic regression (interpretable baseline) ----
        lr = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, random_state=42))
        lr.fit(dense.iloc[train], train_labels)
        p1 = lr.predict_proba(dense.iloc[holdout])[:, 1]

        # ---- B3 discrete-time survival model (person-month hazard, months 19-24) ----
        df_tr, dense_tr = df.iloc[train], dense.iloc[train]
        blocks, events = [], []
        for m in range(LABEL_START, LABEL_END + 1):
            at_risk = ((df_tr.churn_flag == 0) | (df_tr.churn_month >= m)).to_numpy()
            months = np.zeros((int(at_risk.sum()), 6))
            months[:, m - 19] = 1
            blocks.append(np.hstack([dense_tr.to_numpy(dtype=float)[at_risk], months]))
            events.append(((df_tr.churn_flag == 1) & (df_tr.churn_month == m)).to_numpy()[at_risk])
        survival = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, random_state=42))
        survival.fit(np.vstack(blocks), np.concatenate(events))
        xh = dense.iloc[holdout].to_numpy(dtype=float)
        stay = np.ones(len(holdout))
        for m in range(LABEL_START, LABEL_END + 1):
            months = np.zeros((len(xh), 6))
            months[:, m - 19] = 1
            stay *= 1 - survival.predict_proba(np.hstack([xh, months]))[:, 1]
        p3 = 1 - stay

        # ---- four-tier baseline ladder on the SAME holdout (protocol S3/S4) ----
        baselines = [
            dict(key="B0", name="B0 规则基线", model="业务规则排序（工单/用量下滑/账单上涨/合约临期/产品单一）",
                 note="代表企业现状，无概率输出", **ranking_metrics(y, rule_score(df).iloc[holdout].to_numpy())),
            dict(key="B1", name="B1 逻辑回归", model="LogisticRegression（one-hot + 中位数填充 + 缺失标志）",
                 note="可解释线性基线", **ranking_metrics(y, p1, p1)),
            dict(key="B2", name="B2 LightGBM", model="LightGBM + Platt 校准",
                 note="当前演示主模型", **b2),
            dict(key="B3", name="B3 离散时间生存模型", model="person-month hazard LogisticRegression（M19–M24）",
                 note="回答「何时流失」的 hazard 模型", **ranking_metrics(y, p3, p3)),
        ]

        # ---- S4 ablation: drop one feature group at a time, same model config ----
        base = ranking_metrics(y, margin)
        ablation = [dict(group="全特征（基准）", removed=[], delta_pr_auc=0., delta_lift=0., **base)]
        for gname, cols in FEATURE_GROUPS.items():
            feats = [f for f in FEATURES if f not in cols]
            part = df[feats].copy()
            for c in [c for c in CATEGORIES if c in feats]:
                part[c] = pd.Categorical(part[c], categories=self.categories[c])
            reduced = lgb.LGBMClassifier(n_estimators=220, learning_rate=.045, num_leaves=15,
                                         min_child_samples=65, reg_lambda=3, random_state=42,
                                         n_jobs=4, verbosity=-1, deterministic=True, force_col_wise=True)
            reduced.fit(part.iloc[train], train_labels)
            m_ = ranking_metrics(y, reduced.booster_.predict(part.iloc[holdout], raw_score=True, num_threads=4))
            ablation.append(dict(group=gname, removed=cols, delta_pr_auc=m_["pr_auc"] - base["pr_auc"],
                                 delta_lift=m_["lift"] - base["lift"], **m_))

        # ---- S5 T-learner: individual treatment effect from the randomized history ----
        h = self.history.set_index("customer_id").loc[df.customer_id]
        intervention = fit_intervention(df[FEATURES], h.treated, h.churned, CATEGORIES)
        uplift = intervention["p0"] - intervention["p1"]

        splits = np.full(len(df), "train", dtype=object)
        splits[calibration] = "calibration"
        splits[holdout] = "holdout"
        return dict(model=model, calibrator=calibrator, categories=self.categories, metrics=metrics,
                    splits=splits, baselines=baselines, ablation=ablation, uplift=uplift,
                    intervention=intervention)

    def filtered(self, line="", band="", region="", search=""):
        df = self.frame
        mask = np.ones(len(df), dtype=bool)
        for col, val in [("business_line", line), ("band", band), ("region", region)]:
            if val:
                mask &= df[col].eq(val).to_numpy()
        if search:
            mask &= df.customer_id.str.contains(search, case=False, regex=False).to_numpy()
        return df.loc[mask]

    def public(self, frame):
        cols = ["customer_id", "business_line", "region", "tenure_months", "n_products", "arpu", "score", "band", "clv", "gain", "reason", "evaluation_split"]
        return records(frame[cols])

    def dashboard(self):
        df = self.frame
        lines = []
        for key, label in LINES.items():
            part = df[df.business_line == key]
            lines.append(dict(key=key, name=label, total=len(part), predicted=float(part.score.mean()),
                              observed=float(part.churn_flag.mean()), high=int((part.band == "high").sum())))
        # Historical realised events, never presented as monthly model predictions.
        trend = []
        for month in range(LABEL_START, LABEL_END + 1):
            row = dict(month=month)
            for key in LINES:
                part = df[df.business_line == key]
                row[key] = float((part.churn_month == month).sum() / len(part))
            trend.append(row)
        important = np.abs(self.shap).mean(axis=0)
        order = np.argsort(-important)[:7]
        return dict(total=len(df), monthly_rows=self.query("SELECT count(*) AS n FROM monthly")[0]["n"],
                    invalid_event_months=int(((df.churn_flag == 1) & ~df.churn_month.between(LABEL_START, LABEL_END)).sum()),
                    average_risk=float(df.score.mean()), high=int((df.band == "high").sum()),
                    expected_revenue_at_risk=float((df.score * df.arpu * LABEL_MONTHS).sum()),
                    bands=[dict(key=b, name=n, value=int((df.band == b).sum())) for b, n in [("high", "高风险 ≥70%"), ("mid", "中风险 40–70%"), ("low", "低风险 <40%")]],
                    lines=lines, trend=trend, metrics=self.metrics, baselines=self.baselines, ablation=self.ablation,
                    intervention_validation=self.intervention["validation"],
                    uplift_stats=dict(ate=float(df.uplift.mean()), p90=float(df.uplift.quantile(.9)),
                                      sensitive=int((df.uplift >= SENSITIVITY_THRESHOLD).sum()),
                                      recoverable=int(((df.score >= .4) & (df.uplift >= SENSITIVITY_THRESHOLD)).sum())),
                    importance=[dict(name=FEATURE_NAMES[FEATURES[i]], value=float(important[i])) for i in order],
                    version=self.version)

    def query(self, sql, params=None):
        with duckdb.connect(str(self.db), read_only=True) as con:
            return records(con.execute(sql, params or []).df())

    def detail(self, cid):
        pos = self.positions[cid]
        row = self.frame.iloc[pos]
        vals = self.shap[pos]
        order = np.argsort(-np.abs(vals))[:8]
        contributions = [dict(feature=FEATURES[i], name=FEATURE_NAMES[FEATURES[i]], value=float(vals[i])) for i in order]
        contributions.append(dict(feature="others", name="其他特征合计", value=float(vals.sum() - vals[order].sum())))
        return dict(**self.public(self.frame.iloc[[pos]])[0], contract_type=row.contract_type,
                    payment_method=row.payment_method, days_to_contract_end=int(row.days_to_contract_end),
                    tickets=int(row.tickets_6m), uplift=float(row.uplift), p0=float(row.p0), p1=float(row.p1),
                    contributions=contributions, base_value=float(self.base[pos]),
                    raw_log_odds=float(self.base[pos] + vals.sum()),
                    history=self.query(
                        "SELECT month, usage_gb, bill_amount, support_tickets FROM monthly "
                        "WHERE customer_id=? AND month<=? ORDER BY month", [cid, OBS_MONTHS]),
                    suggestion="优先核实客户服务体验与续约意愿，根据实际反馈选择干预渠道。")

    def simulate(self, params):
        df = self.filtered(**params.filters.model_dump())
        if params.customer_ids is not None:
            missing = set(params.customer_ids) - self.positions.keys()
            if missing:
                raise KeyError(sorted(missing)[0])
            df = df[df.customer_id.isin(params.customer_ids)]
        df = df.copy()
        # Use a coherent pair of intervention probabilities, not the separate risk score.
        df["p_after"], df["rescue"] = adjusted_effect(df.p0, df.p1, params.success)
        rescue = df.rescue.to_numpy()
        df["expected_gross"] = rescue * df.arpu.to_numpy() * params.clv_months
        df["expected_net"] = df.expected_gross - params.cost
        df = df.sort_values(["expected_net", "customer_id"], ascending=[False, True])
        n = min(params.max_k, len(df))
        if params.budget is not None:
            n = min(n, int(params.budget // params.cost))
        gross = np.r_[0., df.expected_gross.iloc[:n].cumsum().to_numpy()]
        net = gross - np.arange(n + 1) * params.cost
        best = int(np.argmax(net))
        steps = np.unique(np.r_[np.linspace(0, n, min(n + 1, 101)).astype(int), best])
        # S5 four customer segments: churn probability x individual intervention sensitivity.
        sensitive = df.rescue.to_numpy() >= SENSITIVITY_THRESHOLD
        risky = df.score.to_numpy() >= .4
        groups = np.select([risky & sensitive, ~risky & sensitive, risky & ~sensitive],
                           ["可挽回", "需说服", "高风险、低预计干预响应"], "无需打扰")
        recommended = df.head(best).head(30)
        return dict(candidate_count=len(df), best_k=best, net=float(net[best]), gross=float(gross[best]),
                    cost=float(best * params.cost), roi=float(net[best] / (best * params.cost)) if best else None,
                    random_net=float(best * df.expected_net.mean()) if len(df) else 0.,
                    mean_uplift=float(df.uplift.mean()) if len(df) else 0., mean_rescue=float(rescue.mean()) if len(df) else 0.,
                    curve=[dict(k=int(i), gross=float(gross[i]), net=float(net[i]), cost=float(i * params.cost)) for i in steps],
                    intervention_validation=self.intervention["validation"],
                    groups=[dict(name=name, value=int((groups == name).sum())) for name in ["可挽回", "需说服", "高风险、低预计干预响应", "无需打扰"]],
                    customers=records(recommended[["customer_id", "business_line", "score", "uplift", "p0", "p1", "p_after", "rescue", "expected_net"]]))
