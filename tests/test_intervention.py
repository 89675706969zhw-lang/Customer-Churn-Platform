import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app import Simulation, app, engine
from backend.intervention import adjusted_effect, fit_intervention, partitions, ranking_evaluation


@pytest.mark.parametrize('coefficient', [0, 1, 2])
def test_effect_probability_boundaries(coefficient):
    p0 = np.array([0., 1., .2, .8, .2, .7])
    p1 = np.array([1., 0., .9, .1, .2, .7])
    after, effect = adjusted_effect(p0, p1, coefficient)
    np.testing.assert_allclose(after, np.clip(p0 - coefficient * (p0 - p1), 0, 1))
    np.testing.assert_allclose(effect, p0 - after)
    assert ((after >= 0) & (after <= 1)).all()
    assert ((effect <= p0) & (effect >= p0 - 1)).all()
    if coefficient:
        assert effect[2] < 0  # Potential harm must not silently become zero.
    if coefficient == 1:
        np.testing.assert_allclose(after, p1)


def test_every_prediction_uses_unseen_customers_and_training_only_categories(monkeypatch):
    # Record the actual fit/predict calls, not merely the advertised split labels.
    t = np.tile([0, 0, 1, 1], 100)
    y = np.tile([0, 1, 0, 1], 100)
    x = pd.DataFrame({'value': np.arange(len(t)), 'category': [f'category-{i}' for i in range(len(t))]})
    jobs = partitions(t, y)
    calls = []

    class RecordingLearner:
        def __init__(self, **params):
            pass

        def fit(self, features, labels):
            self.training = set(features.index)
            self.categories = set(features.category.cat.categories)
            self.probability = float(np.mean(labels))
            return self

        def predict_proba(self, features):
            assert self.training.isdisjoint(features.index)
            assert features.category.isna().all()  # Unseen category vocabulary is not leaked.
            calls.append((self.training, set(features.index), self.categories))
            p = np.full(len(features), self.probability)
            return np.c_[1-p, p]

    monkeypatch.setattr('backend.intervention.lgb.LGBMClassifier', RecordingLearner)
    first = fit_intervention(x, t, y, ['category'])
    assert len(calls) == 12
    held_out = set(jobs[-1][1])
    for fold, (train, predict) in enumerate(jobs):
        for arm in [0, 1]:
            fit_ids, predicted_ids, categories = calls[fold * 2 + arm]
            assert fit_ids == set(train[t[train] == arm])
            assert fit_ids.isdisjoint(held_out)
            assert predicted_ids == set(predict)
            assert categories == set(x.iloc[train].category)
        assert (first['fold_ids'][predict] == fold).all()
    assert sorted(np.concatenate([p for _, p in jobs])) == list(range(len(x)))
    second = fit_intervention(x, t, y, ['category'])
    np.testing.assert_array_equal(first['p0'], second['p0'])
    np.testing.assert_array_equal(first['p1'], second['p1'])
    assert first['validation'] == second['validation']


def test_ipw_ranking_definition():
    # Two matched benefit strata with randomized propensity 1/2.
    t, y, score = [0, 1, 0, 1], [1, 0, 0, 0], [.9, .9, .1, .1]
    metrics = ranking_evaluation(t, y, score, propensity=.5)
    assert metrics['ate_ipw'] == pytest.approx(.5)
    assert metrics['qini_ipw'] == pytest.approx(.1875)
    assert ranking_evaluation(t, y, [-s for s in score], .5)['qini_ipw'] < 0


@pytest.mark.parametrize('coefficient', [0, 1, 2])
def test_reported_overflow_customer_and_all_recommendations(coefficient):
    with TestClient(app) as client:
        c = client.get('/api/customers/RT-015730').json()
        for ids in [['RT-015730'], None]:
            response = client.post('/api/simulate', json={
                'customer_ids': ids, 'success': coefficient, 'cost': 80, 'max_k': 30000})
            assert response.status_code == 200
            result = response.json()
            for row in result['customers']:
                assert 0 <= row['p_after'] <= 1
                assert row['rescue'] <= row['p0']
                assert row['rescue'] == pytest.approx(row['p0'] - row['p_after'])
            if ids:
                expected_effect = c['p0'] - np.clip(c['p0'] - coefficient * (c['p0']-c['p1']), 0, 1)
                assert result['mean_rescue'] == pytest.approx(expected_effect)
                assert result['gross'] <= c['p0'] * c['arpu'] * 18 + 1e-8


def test_groups_stay_aligned_after_sorting_and_budget_does_not_change_candidates():
    e = engine()
    params = Simulation(success=2, cost=80, budget=8000, max_k=30000)
    result = e.simulate(params)
    _, rescue = adjusted_effect(e.frame.p0, e.frame.p1, 2)
    risky, sensitive = e.frame.score.to_numpy() >= .4, rescue >= .04
    masks = [risky & sensitive, ~risky & sensitive, risky & ~sensitive, ~risky & ~sensitive]
    assert [g['value'] for g in result['groups']] == [int(mask.sum()) for mask in masks]
    net = np.sort(rescue * e.frame.arpu.to_numpy() * 18 - 80)[::-1]
    totals = np.r_[0, net[:100].cumsum()]
    assert result['best_k'] == int(totals.argmax())
    assert result['net'] == pytest.approx(totals.max())
    assert e.simulate(Simulation(success=2, cost=80, budget=0))['groups'] == result['groups']


def test_negative_effect_is_not_recommended():
    # Tiny isolated engine fixture; no shared model/data mutation.
    from backend.engine import Engine
    e = object.__new__(Engine)
    e.frame = pd.DataFrame(dict(customer_id=['harm'], p0=[.1], p1=[.9], uplift=[-.8],
                               score=[.8], arpu=[500], business_line=['mobile']))
    e.positions = {'harm': 0}
    e.intervention = {'validation': {}}
    result = e.simulate(Simulation(success=2, cost=80))
    assert result['mean_rescue'] == pytest.approx(-.9)
    assert result['best_k'] == 0 and result['customers'] == []
    assert result['net'] == 0 and result['gross'] == 0


def test_validation_summary_matches_held_out_records():
    e = engine()
    h = e.history.set_index('customer_id').loc[e.frame.customer_id]
    jobs = partitions(h.treated, h.churned)
    holdout = jobs[-1][1]
    summary = e.dashboard()['intervention_validation']
    assert summary['holdout_size'] == len(holdout) == 7500
    assert summary['development_size'] == 22500
    np.testing.assert_array_equal(np.flatnonzero(e.intervention['fold_ids'] == 5), np.sort(holdout))
    expected = ranking_evaluation(h.treated.to_numpy()[holdout], h.churned.to_numpy()[holdout], e.uplift[holdout])
    for key, value in expected.items():
        assert summary[key] == pytest.approx(value)
    assert sum(arm['size'] for arm in summary['arms']) == len(holdout)
    assert e.simulate(Simulation())['intervention_validation'] == summary


def test_real_tlearner_retraining_is_deterministic():
    t = np.tile([0, 0, 1, 1], 100)
    y = np.tile([0, 1, 0, 1], 100)
    x = pd.DataFrame({'value': np.random.default_rng(52).normal(size=400)})
    first, second = [fit_intervention(x, t, y, []) for _ in range(2)]
    np.testing.assert_allclose(first['p0'], second['p0'], rtol=0, atol=0)
    np.testing.assert_allclose(first['p1'], second['p1'], rtol=0, atol=0)
