# -*- coding: utf-8 -*-
"""快速验证：合成数据的信号强度是否落在合理区间 (AUC 0.78-0.85)"""
import sys, os
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, average_precision_score

path = sys.argv[1] if len(sys.argv) > 1 else "_test_data/model_table.csv"
df = pd.read_csv(path)

y = df["churn_flag"].values
drop = ["customer_id", "churn_flag", "churn_month"]
X = df.drop(columns=[c for c in drop if c in df.columns])
X = pd.get_dummies(X, columns=["business_line", "region", "contract_type",
                               "payment_method", "tech_type"], drop_first=False)
X = X.fillna(X.median(numeric_only=True)).fillna(0)

Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=42, stratify=y)

m = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.08,
                                   max_depth=6, random_state=42)
m.fit(Xtr, ytr)
p = m.predict_proba(Xte)[:, 1]

auc = roc_auc_score(yte, p)
ap = average_precision_score(yte, p)

# Lift@Top10%
order = np.argsort(-p)
k = int(len(yte) * 0.10)
lift = yte[order[:k]].mean() / yte.mean()
recall10 = yte[order[:k]].sum() / yte.sum()

print("=" * 58)
print("合成数据信号强度检验 / Signal strength check")
print("=" * 58)
print(f"样本量            : {len(df):,}  (正样本率 {y.mean():.3f})")
print(f"ROC-AUC           : {auc:.4f}")
print(f"PR-AUC            : {ap:.4f}   (随机基线 ≈ {y.mean():.3f})")
print(f"Lift@Top10%       : {lift:.2f}")
print(f"Recall@Top10%     : {recall10:.3f}")
print("-" * 58)
if 0.78 <= auc <= 0.88:
    print("判定: 通过 — 信号强度落在真实业务的合理区间")
elif auc > 0.92:
    print("判定: 信号过强 — 调大 NOISE_SD (当前 0.55 → 0.8~1.0)")
elif auc < 0.72:
    print("判定: 信号过弱 — 调小 NOISE_SD 或加大 BETA 系数")
else:
    print("判定: 可接受，但建议微调至 0.78-0.85")
print("=" * 58)
