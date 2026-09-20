"""
Feature contract — Python side.

This module does NOT recompute features. Features are computed once, in
TypeScript (`shared/ml/features.ts`), by the same code the live inference path
uses. Duplicating that logic here would create two implementations that drift,
and a model trained on drifted features is worse than no model at all.

What this module does own:
  - the canonical feature ORDER, asserted against the generated dataset
  - loading and sanity-checking the dataset
  - the grouped train/validation/test split that prevents leakage

LEAKAGE — the thing that matters most here
Telemetry sampled at 1 Hz is massively autocorrelated: row t and row t+1 are
nearly identical. A random row-wise split puts near-duplicates of test rows into
the training set, and the model reports an accuracy that is really just
memorisation. Every row therefore carries an `episode` id, and we split by
EPISODE so that no simulation run contributes to more than one split.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import numpy as np
import pandas as pd

# Must match FEATURE_ORDER in shared/ml/features.ts exactly, including order.
FEATURE_ORDER: list[str] = [
    "voltage",
    "current",
    "power",
    "temperature",
    "lux",
    "soc",
    "generationW",
    "loadW",
    "energyImbalanceW",
    "voltageTrend",
    "currentTrend",
    "temperatureTrend",
    "socTrend",
    "powerRollingMean",
    "powerRateOfChange",
    "solarElevation",
    "efficiencyRatio",
]

# Columns that describe the row but must never be fed to the model.
# `scenario` in particular is the LABEL SOURCE — feeding it in would be direct
# target leakage and would produce a meaningless 100 % accuracy.
METADATA_COLUMNS = ["label", "episode", "node_id", "node_type", "scenario"]

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATASET_PATH = os.path.join(REPO_ROOT, "ml", "data", "training_data.csv")
MODEL_DIR = os.path.join(REPO_ROOT, "ml", "models")


@dataclass
class Dataset:
    """A grouped, leakage-free split of the generated telemetry dataset."""

    X_train: np.ndarray
    y_train: np.ndarray
    X_val: np.ndarray
    y_val: np.ndarray
    X_test: np.ndarray
    y_test: np.ndarray
    labels: list[str]
    feature_names: list[str]
    n_episodes: int
    frame: pd.DataFrame


def load_dataset(path: str = DATASET_PATH) -> pd.DataFrame:
    """Load the generated dataset and verify the feature contract holds."""
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"Dataset not found at {path}.\n"
            "Generate it first:  npm run ml:generate"
        )

    df = pd.read_csv(path)

    missing = [c for c in FEATURE_ORDER if c not in df.columns]
    if missing:
        raise ValueError(
            "Dataset is missing expected feature columns: "
            f"{missing}.\nFEATURE_ORDER here must match shared/ml/features.ts."
        )

    # Guard the ORDER, not just membership: the portable model indexes features
    # positionally, so a reordering would silently mispredict.
    actual_order = [c for c in df.columns if c in FEATURE_ORDER]
    if actual_order != FEATURE_ORDER:
        raise ValueError(
            "Feature column ORDER in the dataset does not match FEATURE_ORDER.\n"
            f"  dataset: {actual_order}\n  expected: {FEATURE_ORDER}"
        )

    for col in METADATA_COLUMNS:
        if col not in df.columns:
            raise ValueError(f"Dataset is missing metadata column '{col}'.")

    # Non-finite values would train silently and then blow up at inference.
    feats = df[FEATURE_ORDER]
    if not np.isfinite(feats.to_numpy(dtype=np.float64)).all():
        bad = feats.columns[~np.isfinite(feats.to_numpy(dtype=np.float64)).all(axis=0)].tolist()
        raise ValueError(f"Dataset contains non-finite values in columns: {bad}")

    return df


def split_by_episode(
    df: pd.DataFrame,
    test_size: float = 0.2,
    val_size: float = 0.2,
    random_state: int = 42,
) -> Dataset:
    """
    Split into train/validation/test by EPISODE, stratified by SCENARIO.

    Why stratify by scenario as well as group by episode:
      A plain GroupShuffleSplit over ~86 episodes routinely placed every episode
      of a given scenario into a single split — BATTERY_OVERHEAT ended up with
      1,303 training rows and zero in both validation and test. You cannot
      evaluate a class you have no held-out examples of, and model selection
      silently ignores it.

      So episodes are bucketed by the scenario that produced them and each
      bucket is divided across the three splits independently. Every scenario is
      then represented everywhere, while the episode-level grouping — the part
      that actually prevents leakage between autocorrelated neighbouring rows —
      is preserved exactly.
    """
    X_all = df[FEATURE_ORDER].to_numpy(dtype=np.float64)
    y_all = df["label"].to_numpy()
    groups = df["episode"].to_numpy()

    # One row per episode: (episode, scenario).
    episode_scenario = (
        df[["episode", "scenario"]].drop_duplicates().sort_values("episode")
    )

    rng = np.random.default_rng(random_state)
    train_eps: list[str] = []
    val_eps: list[str] = []
    test_eps: list[str] = []

    for scenario, block in episode_scenario.groupby("scenario", sort=True):
        eps = block["episode"].to_numpy()
        rng.shuffle(eps)
        n = len(eps)

        if n < 3:
            # Too few episodes to divide meaningfully; keep them for training
            # and let evaluate.py withhold metrics for the affected classes.
            train_eps.extend(eps.tolist())
            continue

        n_test = max(1, int(round(n * test_size)))
        n_val = max(1, int(round(n * val_size)))
        # Always leave at least one episode for training.
        while n_test + n_val >= n:
            if n_val > 1:
                n_val -= 1
            elif n_test > 1:
                n_test -= 1
            else:
                break

        test_eps.extend(eps[:n_test].tolist())
        val_eps.extend(eps[n_test : n_test + n_val].tolist())
        train_eps.extend(eps[n_test + n_val :].tolist())

    train_set, val_set, test_set = set(train_eps), set(val_eps), set(test_eps)
    train_idx = np.where(np.isin(groups, list(train_set)))[0]
    val_idx = np.where(np.isin(groups, list(val_set)))[0]
    test_idx = np.where(np.isin(groups, list(test_set)))[0]

    # Assert the guarantee rather than trusting it.
    assert not (train_set & test_set), "episode leaked into test"
    assert not (val_set & test_set), "episode leaked into test"
    assert not (train_set & val_set), "episode leaked into val"

    labels = sorted(pd.unique(y_all).tolist())

    return Dataset(
        X_train=X_all[train_idx],
        y_train=y_all[train_idx],
        X_val=X_all[val_idx],
        y_val=y_all[val_idx],
        X_test=X_all[test_idx],
        y_test=y_all[test_idx],
        labels=labels,
        feature_names=list(FEATURE_ORDER),
        n_episodes=int(pd.unique(groups).size),
        frame=df,
    )


def describe_split(ds: Dataset) -> str:
    """Readable summary printed by the training and evaluation scripts."""
    lines = [
        f"Episodes            : {ds.n_episodes}",
        f"Train rows          : {len(ds.y_train):,}",
        f"Validation rows     : {len(ds.y_val):,}",
        f"Test rows           : {len(ds.y_test):,}",
        f"Classes             : {len(ds.labels)}",
        "",
        "Class distribution (train / val / test):",
    ]
    for label in ds.labels:
        tr = int((ds.y_train == label).sum())
        va = int((ds.y_val == label).sum())
        te = int((ds.y_test == label).sum())
        lines.append(f"  {label:<22} {tr:>7,} / {va:>6,} / {te:>6,}")
    return "\n".join(lines)
