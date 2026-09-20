"""
Python-side inference.

The LIVE path does not use this file — the Node worker and the API run the same
forest through `shared/ml/forest.ts`, because neither Vercel nor the worker has
a Python runtime. This script exists for:

  * offline batch scoring and analysis
  * sanity-checking the portable export against sklearn
  * the future Raspberry Pi deployment, where Python is available on the edge
    device and running sklearn directly is the natural choice

Usage
    # score a single feature vector
    echo '{"voltage":12.4,"current":-3.1,...}' | python ml/inference/predict.py

    # score every row of the generated dataset and report agreement
    python ml/inference/predict.py --dataset

    # verify the portable JSON reproduces sklearn on the parity sample
    python ml/inference/predict.py --verify-portable
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
import joblib

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from features.feature_engineering import FEATURE_ORDER, load_dataset  # noqa: E402
from models.model_registry import get_current  # noqa: E402


def load_model():
    current = get_current()
    if current is None or not os.path.exists(current.model_joblib):
        raise SystemExit("No trained model found. Run:  npm run ml:train")
    return joblib.load(current.model_joblib), current


def vector_from_mapping(payload: dict) -> np.ndarray:
    """Build the ordered feature array, erroring on anything missing."""
    missing = [f for f in FEATURE_ORDER if f not in payload]
    if missing:
        raise SystemExit(f"Missing features: {missing}")
    return np.array([[float(payload[f]) for f in FEATURE_ORDER]], dtype=np.float64)


def predict_one(model, payload: dict, version: str) -> dict:
    X = vector_from_mapping(payload)
    proba = model.predict_proba(X)[0]
    classes = [str(c) for c in model.classes_]
    best = int(np.argmax(proba))

    importances = sorted(
        zip(FEATURE_ORDER, model.feature_importances_),
        key=lambda kv: kv[1],
        reverse=True,
    )[:4]

    return {
        "predictedClass": classes[best],
        "confidence": round(float(proba[best]), 4),
        "classProbabilities": {c: round(float(p), 4) for c, p in zip(classes, proba)},
        "contributingFeatures": [
            {"feature": name, "value": float(payload[name]), "importance": round(float(imp), 4)}
            for name, imp in importances
        ],
        "modelVersion": version,
        "trainedOnSyntheticData": True,
    }


def walk_portable_tree(tree: dict, x: np.ndarray) -> np.ndarray:
    """Mirror of the traversal in shared/ml/forest.ts, for verification."""
    node = 0
    while tree["childLeft"][node] != -1:
        f = tree["feature"][node]
        node = (
            tree["childLeft"][node]
            if x[f] <= tree["threshold"][node]
            else tree["childRight"][node]
        )
    counts = np.array(tree["value"][node], dtype=np.float64)
    total = counts.sum()
    return counts / total if total > 0 else counts


def verify_portable(model, current) -> int:
    """
    Confirm the exported JSON reproduces sklearn on the parity sample.

    This is the Python-side half of the guarantee; tests/forest.test.ts performs
    the same check from TypeScript against the same file.
    """
    with open(current.model_json, encoding="utf-8") as f:
        portable = json.load(f)
    with open(current.sample_json, encoding="utf-8") as f:
        sample = json.load(f)

    if portable["featureOrder"] != FEATURE_ORDER:
        raise SystemExit("Portable model feature order does not match FEATURE_ORDER.")

    classes = portable["classes"]
    trees = portable["trees"]
    mismatches = 0
    max_prob_delta = 0.0

    for row in sample["rows"]:
        x = np.array(row["features"], dtype=np.float64)
        summed = np.zeros(len(classes), dtype=np.float64)
        for tree in trees:
            summed += walk_portable_tree(tree, x)
        proba = summed / len(trees)
        predicted = classes[int(np.argmax(proba))]

        if predicted != row["sklearnPrediction"]:
            mismatches += 1
        max_prob_delta = max(
            max_prob_delta,
            float(np.max(np.abs(proba - np.array(row["sklearnProbabilities"])))),
        )

    n = len(sample["rows"])
    print(f"Parity sample rows      : {n}")
    print(f"Prediction mismatches   : {mismatches}")
    print(f"Max probability delta   : {max_prob_delta:.2e}")

    if mismatches == 0 and max_prob_delta < 1e-3:
        print("\nPortable export reproduces scikit-learn.")
        return 0
    print("\nPortable export DIVERGES from scikit-learn — do not deploy this model.")
    return 1


def score_dataset(model, version: str) -> int:
    df = load_dataset()
    X = df[FEATURE_ORDER].to_numpy(dtype=np.float64)
    pred = model.predict(X)
    agree = float((pred == df["label"].to_numpy()).mean())
    print(f"Model version           : {version}")
    print(f"Rows scored             : {len(df):,}")
    print(f"Agreement with labels   : {agree:.4f}")
    print(
        "\nNOTE: this figure covers rows the model TRAINED on and is not a "
        "performance metric. See ml/models/metrics.json for held-out results."
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="GridSync model inference (offline).")
    parser.add_argument("--dataset", action="store_true", help="score the full generated dataset")
    parser.add_argument(
        "--verify-portable",
        action="store_true",
        help="check the exported JSON reproduces scikit-learn",
    )
    args = parser.parse_args()

    model, current = load_model()

    if args.verify_portable:
        return verify_portable(model, current)
    if args.dataset:
        return score_dataset(model, current.version)

    raw = sys.stdin.read().strip()
    if not raw:
        parser.print_help()
        return 1
    payload = json.loads(raw)
    print(json.dumps(predict_one(model, payload, current.version), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
