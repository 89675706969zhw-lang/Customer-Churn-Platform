"""Export the already-computed demo state for the Netlify Node.js API adapter."""
from __future__ import annotations

import gzip
import json
from pathlib import Path
import sys

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.engine import (CHANNELS, CLV_MONTHS, FEATURE_NAMES, FEATURES, LABEL_MONTHS,
                            LINES, OBS_MONTHS, RAW, REGIONS, Engine)


def native(value):
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return None if not np.isfinite(value) else float(value)
    raise TypeError(f"Unsupported JSON value: {type(value)!r}")


def main():
    engine = Engine()
    monthly = pd.read_csv(
        RAW / "monthly_usage.csv",
        usecols=["customer_id", "month", "usage_gb", "bill_amount", "support_tickets"],
    )
    monthly = monthly[monthly.month <= OBS_MONTHS].sort_values(["customer_id", "month"])
    histories = {
        cid: group[["month", "usage_gb", "bill_amount", "support_tickets"]].values.tolist()
        for cid, group in monthly.groupby("customer_id", sort=False)
    }

    customers, details = [], {}
    public_columns = ["customer_id", "business_line", "region", "tenure_months", "n_products",
                      "arpu", "score", "band", "clv", "gain", "reason", "evaluation_split"]
    for position, row in engine.frame.iterrows():
        customer = {column: native(row[column]) if isinstance(row[column], np.generic) else row[column]
                    for column in public_columns}
        customers.append(customer)
        values = engine.shap[position]
        order = np.argsort(-np.abs(values))[:8]
        contributions = [[FEATURES[i], FEATURE_NAMES[FEATURES[i]], float(values[i])] for i in order]
        contributions.append(["others", "其他特征合计", float(values.sum() - values[order].sum())])
        cid = row.customer_id
        details[cid] = {
            "contract_type": row.contract_type,
            "payment_method": row.payment_method,
            "days_to_contract_end": int(row.days_to_contract_end),
            "tickets": int(row.tickets_6m),
            "uplift": float(row.uplift),
            "p0": float(row.p0),
            "p1": float(row.p1),
            "contributions": contributions,
            "base_value": float(engine.base[position]),
            "raw_log_odds": float(engine.base[position] + values.sum()),
            "history": histories[cid],
        }

    snapshot = {
        "meta": {
            "lines": LINES, "regions": REGIONS, "channels": CHANNELS, "synthetic": True,
            "obs_months": OBS_MONTHS, "label_months": LABEL_MONTHS, "clv_months": CLV_MONTHS,
        },
        "dashboard": engine.dashboard(),
        "customers": customers,
        "details": details,
        "version": engine.version,
    }
    target = Path(__file__).with_name("generated") / "snapshot.json.gz"
    target.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(target, "wt", encoding="utf-8", compresslevel=9) as output:
        json.dump(snapshot, output, ensure_ascii=False, separators=(",", ":"), default=native)
    print(f"Exported {len(customers):,} customers to {target} ({target.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
