"""Out-of-sample T-learner for the shipped synthetic randomized experiment."""
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import StratifiedKFold, train_test_split

SEED = 52
FOLDS = 5
# Design probability of the shipped randomized history, not a fitted propensity.
TREATMENT_PROBABILITY = 0.30


def adjusted_effect(p0, p1, coefficient):
    p_after = np.clip(np.asarray(p0) - coefficient * (np.asarray(p0) - np.asarray(p1)), 0, 1)
    return p_after, np.asarray(p0) - p_after


def partitions(treated, outcome):
    strata = np.asarray(treated) * 2 + np.asarray(outcome)
    development, holdout = train_test_split(
        np.arange(len(strata)), test_size=.25, random_state=SEED, stratify=strata)
    folds = StratifiedKFold(n_splits=FOLDS, shuffle=True, random_state=SEED + 1)
    jobs = [(development[train], development[test])
            for train, test in folds.split(development, strata[development])]
    return jobs + [(development, holdout)]


def ranking_evaluation(treated, outcome, uplift, propensity=TREATMENT_PROBABILITY):
    """IPW avoided-churn gain curve; positive means less churn under treatment.

    Normalize cumulative gains by test-set size. Qini is the trapezoidal area
    above the random-targeting line. Observed outcomes, not individual truth.
    """
    t, y = np.asarray(treated), np.asarray(outcome)
    pseudo_effect = (1 - t) * y / (1 - propensity) - t * y / propensity
    order = np.argsort(-np.asarray(uplift), kind="stable")
    gain = np.r_[0., np.cumsum(pseudo_effect[order]) / len(y)]
    fraction = np.linspace(0, 1, len(gain))
    k = max(1, len(y) // 10)
    return dict(qini_ipw=float(np.trapezoid(gain - fraction * gain[-1], fraction)),
                ate_ipw=float(gain[-1]), top_decile_effect_ipw=float(pseudo_effect[order[:k]].mean()),
                treatment_probability=propensity)


def fit_intervention(features, treated, outcome, categorical):
    treated, outcome = np.asarray(treated), np.asarray(outcome)
    p0, p1 = np.zeros(len(features)), np.zeros(len(features))
    fold_ids = np.full(len(features), -1, dtype=int)
    jobs = partitions(treated, outcome)
    params = dict(n_estimators=120, learning_rate=.06, num_leaves=15,
                  min_child_samples=60, reg_lambda=3, random_state=42, n_jobs=4,
                  verbosity=-1, deterministic=True, force_col_wise=True)
    for fold, (train, predict) in enumerate(jobs):
        train_x, predict_x = features.iloc[train].copy(), features.iloc[predict].copy()
        # Fit category vocabularies within each training partition only.
        for column in categorical:
            categories = sorted(train_x[column].dropna().unique().tolist())
            train_x[column] = pd.Categorical(train_x[column], categories=categories)
            predict_x[column] = pd.Categorical(predict_x[column], categories=categories)
        for arm, destination in [(0, p0), (1, p1)]:
            mask = treated[train] == arm
            model = lgb.LGBMClassifier(**params)
            model.fit(train_x.loc[mask], outcome[train][mask])
            destination[predict] = model.predict_proba(predict_x)[:, 1]
        fold_ids[predict] = fold
    holdout = jobs[-1][1]
    arms = []
    for arm, probability in [(0, p0), (1, p1)]:
        selected = holdout[treated[holdout] == arm]
        y, p = outcome[selected], probability[selected]
        arms.append(dict(arm=arm, size=len(selected), observed_rate=float(y.mean()),
                         predicted_rate=float(p.mean()), brier=float(brier_score_loss(y, p)),
                         auc=float(roc_auc_score(y, p))))
    validation = dict(method="5-fold cross-fitting + independent holdout", seed=SEED,
                      folds=FOLDS, development_size=len(jobs[-1][0]), holdout_size=len(holdout),
                      arms=arms, **ranking_evaluation(treated[holdout], outcome[holdout], (p0-p1)[holdout]),
                      note="合成随机化干预实验；样本外估计不代表真实业务效果，排序指标可能为负。")
    return dict(p0=p0, p1=p1, fold_ids=fold_ids, validation=validation)
