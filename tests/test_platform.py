import csv
import io

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app import app, engine
from backend.engine import FEATURE_GROUPS, FEATURES, RAW


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_data_and_holdout_metrics(client):
    d = client.get('/api/dashboard').json()
    assert d['total'] == 30000
    assert d['monthly_rows'] == 720000
    assert sum(b['value'] for b in d['bands']) == d['total']
    assert sum(l['total'] for l in d['lines']) == d['total']
    assert d['metrics']['holdout_size'] == 7500
    assert 0.78 <= d['metrics']['auc'] <= 0.85
    assert d['metrics']['lift'] >= 3
    assert d['metrics']['ece'] < 0.03
    assert not {'churn_flag', 'churn_month', 'churn_reason', 'customer_id'} & set(FEATURES)
    assert engine().frame.groupby('customer_id').evaluation_split.nunique().max() == 1
    assert client.get('/api/health').json()['synthetic'] is True


def test_four_tier_baselines(client):
    d = client.get('/api/dashboard').json()
    baselines = d['baselines']
    assert [b['key'] for b in baselines] == ['B0', 'B1', 'B2', 'B3']
    assert all({'auc', 'pr_auc', 'lift', 'recall'} <= set(b) for b in baselines)
    rule, lr, lgbm, survival = baselines
    # Rule baseline stays interpretable but clearly weakest.
    assert rule['pr_auc'] < lr['pr_auc'] - .1
    assert rule['pr_auc'] < lgbm['pr_auc'] - .1
    assert rule['pr_auc'] < survival['pr_auc'] - .1
    # Only the rule baseline is rank-only; the other three emit calibrated probabilities.
    assert 'ece' not in rule and 'brier' not in rule
    for b in (lr, lgbm, survival):
        assert 0 <= b['ece'] < 0.05 and 0 <= b['brier'] < 0.25
    # Linear models edge out the tree on linear-logit synthetic labels, by a small margin.
    assert abs(lr['pr_auc'] - lgbm['pr_auc']) < 0.05
    # B2 row must agree with the headline metrics on the same holdout.
    assert lgbm['pr_auc'] == d['metrics']['pr_auc']
    assert lgbm['lift'] == d['metrics']['lift']


def test_ablation_covers_every_feature_group(client):
    d = client.get('/api/dashboard').json()
    ablation = d['ablation']
    assert ablation[0]['group'] == '全特征（基准）'
    assert ablation[0]['delta_pr_auc'] == 0
    assert [a['group'] for a in ablation[1:]] == list(FEATURE_GROUPS)
    removed = [f for a in ablation[1:] for f in a['removed']]
    assert sorted(removed) == sorted(FEATURES)  # partition, no duplicates
    deltas = [a['delta_pr_auc'] for a in ablation[1:]]
    assert max(deltas) <= 0  # dropping a group never helps
    assert min(deltas) <= -0.05  # at least one group is decisively important
    assert all(a['pr_auc'] > 0 for a in ablation)


def test_simulation_groups_match_proposal_taxonomy(client):
    body = {'cost': 80, 'success': .2, 'max_k': 30000, 'filters': {}}
    r = client.post('/api/simulate', json=body).json()
    assert [g['name'] for g in r['groups']] == ['可挽回', '需说服', '必然流失', '无需打扰']
    assert sum(g['value'] for g in r['groups']) == r['candidate_count']


def test_filter_sort_paginate_export(client):
    query = 'line=broadband&region=Moscow&sort=score&direction=desc'
    first = client.get('/api/customers?' + query).json()
    second = client.get('/api/customers?' + query + '&page=2').json()
    ids1 = {r['customer_id'] for r in first['items']}
    assert ids1.isdisjoint(r['customer_id'] for r in second['items'])
    assert first['items'][-1]['score'] >= second['items'][0]['score']
    assert all(r['business_line'] == 'broadband' and r['region'] == 'Moscow' for r in first['items'])
    exported = client.get('/api/customers/export?line=broadband&region=Moscow')
    assert exported.status_code == 200
    rows = list(csv.DictReader(io.StringIO(exported.content.decode('utf-8-sig'))))
    assert len(rows) == first['total']
    assert ids1 <= {r['customer_id'] for r in rows}
    assert client.get('/api/customers?search=DOES-NOT-EXIST').json()['total'] == 0
    assert client.get('/api/customers?page=0').status_code == 422
    assert client.get('/api/customers?sort=churn_flag').status_code == 422


@pytest.mark.parametrize('cid', ['RT-000001', 'RT-015000', 'RT-030000'])
def test_shap_reconstructs_calibrated_score_and_no_future_history(client, cid):
    d = client.get('/api/customers/' + cid).json()
    log_odds = d['base_value'] + sum(v['value'] for v in d['contributions'])
    assert 1 / (1 + np.exp(-log_odds)) == pytest.approx(d['score'], abs=1e-10)
    assert [r['month'] for r in d['history']] == list(range(1, 19))
    assert client.post('/api/score', json={'customer_id': cid}).json()['score'] == d['score']
    assert isinstance(d['uplift'], float)


def test_batch_preserves_order_and_rejects_unknown(client):
    ids = ['RT-000025', 'RT-000002', 'RT-000025']
    r = client.post('/api/batch_score', json={'customer_ids': ids})
    assert [c['customer_id'] for c in r.json()['items']] == ids
    assert client.post('/api/batch_score', json={'customer_ids': ['unknown']}).status_code == 404
    assert client.get('/api/customers/unknown').status_code == 404


def test_randomised_treatment_history(client):
    """S5 uplift 的前提：历史干预必须随机分配，否则 ITE 有偏。"""
    h = pd.read_csv(RAW / "intervention_history.csv")
    assert list(h.columns) == ["customer_id", "treated", "churned"]
    assert len(h) == 30000
    assert 0.28 <= h.treated.mean() <= 0.32
    rate_t = h.loc[h.treated == 1, "churned"].mean()
    rate_c = h.loc[h.treated == 0, "churned"].mean()
    assert rate_t < rate_c, "干预组流失率必须低于对照组"
    # Randomisation check: treatment must be independent of the observed drivers.
    merged = engine().frame.merge(h, on="customer_id")
    near = merged.days_to_contract_end < 60
    assert abs(near[merged.treated == 1].mean() - near[merged.treated == 0].mean()) < 0.02


def test_tlearner_estimates_heterogeneous_gain(client):
    e = engine()
    u = e.frame.uplift
    assert 0.03 <= u.mean() <= 0.08, "平均增益应与生成端 ATE 同量级"
    assert u.std() > 0.02, "个体增益必须异质，而非退化为常数"
    near = e.frame.days_to_contract_end < 60
    assert u[near].mean() > u[~near].mean() + 0.02, "合约临期客户的增益应显著更高"
    stats = client.get("/api/dashboard").json()["uplift_stats"]
    assert stats["recoverable"] > 500 and stats["sensitive"] > stats["recoverable"]


def test_single_customer_simulation_exact_arithmetic(client):
    cid = client.get('/api/customers?page_size=1').json()['items'][0]['customer_id']
    c = client.get('/api/customers/' + cid).json()
    r = client.post('/api/simulate', json={'customer_ids': [cid], 'cost': 80, 'success': .5, 'clv_months': 18, 'max_k': 10}).json()
    # Economics now driven by individual uplift, not by churn probability alone.
    expected = c['uplift'] * c['arpu'] * 18 * .5 - 80
    assert r['candidate_count'] == 1 and r['best_k'] == 1
    assert r['net'] == pytest.approx(expected)
    assert r['roi'] == pytest.approx(expected / 80)
    assert r['customers'][0]['customer_id'] == cid
    assert r['mean_uplift'] == pytest.approx(c['uplift'])


def test_simulation_budget_and_optimum(client):
    body = {'cost': 80, 'success': .5, 'max_k': 30000, 'budget': 8000, 'filters': {'line': 'mobile'}}
    r = client.post('/api/simulate', json=body).json()
    df = engine().frame[engine().frame.business_line == 'mobile']
    gain = (df.uplift * .5 * df.arpu * 18 - 80).sort_values(ascending=False).to_numpy()
    exhaustive = np.r_[0, np.cumsum(gain[:100])]
    assert r['best_k'] == int(np.argmax(exhaustive))
    assert r['net'] == pytest.approx(exhaustive.max())
    assert r['cost'] <= body['budget']
    assert sum(g['value'] for g in r['groups']) == r['candidate_count']
    assert r['net'] >= r['random_net']


@pytest.mark.parametrize('body', [{'success': 0}, {'budget': 0}, {'max_k': 0}, {'customer_ids': []}, {'filters': {'search': 'nobody'}}])
def test_zero_and_empty_scenarios(client, body):
    r = client.post('/api/simulate', json=body)
    assert r.status_code == 200
    d = r.json()
    assert d['best_k'] == 0 and d['net'] == 0 and d['roi'] is None
    assert d['customers'] == []


@pytest.mark.parametrize('body', [{'cost': 0}, {'success': 2.5}, {'success': -0.1}, {'budget': -1}, {'max_k': 30001}, {'clv_months': 0}])
def test_invalid_scenarios(client, body):
    assert client.post('/api/simulate', json=body).status_code == 422


def test_simulation_missing_customer(client):
    assert client.post('/api/simulate', json={'customer_ids': ['unknown']}).status_code == 404


def test_features_recompute_from_observation_window(client):
    from generate_synthetic_data import aggregate_features
    ids = ['RT-000001', 'RT-000100', 'RT-025000']
    monthly = pd.DataFrame(engine().query('SELECT * FROM monthly WHERE customer_id IN (?, ?, ?)', ids))
    observed = monthly[monthly.month <= 18]
    expected = aggregate_features(observed, 18).set_index('customer_id').sort_index()
    actual = engine().frame.set_index('customer_id').loc[expected.index, expected.columns]
    np.testing.assert_allclose(actual.to_numpy(dtype=float), expected.to_numpy(dtype=float), rtol=1e-8, equal_nan=True)


def test_holdout_scores_are_reproducible(client):
    e = engine()
    df = e.frame[e.frame.evaluation_split == 'holdout'].iloc[:50]
    margin = e.model.booster_.predict(e.encode(df), raw_score=True, num_threads=4)
    fresh = e.calibrator.predict_proba(margin.reshape(-1, 1))[:, 1]
    np.testing.assert_allclose(fresh, df.score, rtol=1e-12)


def test_invalid_event_dates_are_visible_not_silently_dropped(client):
    e = engine()
    invalid = ((e.frame.churn_flag == 1) & ~e.frame.churn_month.between(19, 24)).sum()
    assert client.get('/api/dashboard').json()['invalid_event_months'] == int(invalid)
    trend_total = sum((e.frame.churn_month == m).sum() for m in range(19, 25))
    assert int(invalid) + trend_total == int(e.frame.churn_flag.sum())


def test_generator_inclusive_label_window():
    import generate_synthetic_data as gs
    rng = np.random.default_rng(42)
    base = gs.build_customers(2000, rng)
    monthly = gs.build_monthly(base, 24, rng)
    labeled = gs.generate_labels(base, gs.aggregate_features(monthly, 18), rng)
    event_months = labeled.loc[labeled.churn_flag == 1, 'churn_month']
    assert len(event_months) > 50
    assert event_months.between(19, 24).all()
