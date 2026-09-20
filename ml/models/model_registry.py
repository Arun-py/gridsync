"""
Model registry.

Versioned model artefacts so a prediction shown in the UI can always be traced
back to the exact model that produced it. Each version directory holds:

    ml/models/v<N>/
        model.joblib     fitted sklearn estimator (Python inference, retraining)
        model.json       portable tree dump read by shared/ml/forest.ts (Node)
        metrics.json     REAL metrics from ml/evaluation/evaluate.py
        sklearn_sample.json  held-out rows + sklearn's own predictions, used by
                             tests/forest.test.ts to prove the TS evaluator
                             reproduces sklearn exactly

`ml/models/current.json` points at the active version. The worker and the API
read that pointer, so promoting a model is a one-line change, not a redeploy.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass

MODEL_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models"
)
CURRENT_POINTER = os.path.join(MODEL_DIR, "current.json")

# The promoted model is ALSO published here, at a stable path.
#
# Versioned directories accumulate quickly and each portable export is several
# megabytes, so only this directory is committed; `ml/models/v*/` is gitignored.
# It also means the runtime loads from one fixed location instead of resolving a
# pointer, which is one less thing to go wrong in a serverless cold start.
CURRENT_DIR = os.path.join(MODEL_DIR, "current")

_VERSION_RE = re.compile(r"^v(\d+)$")


@dataclass
class ModelVersion:
    version: str
    path: str

    @property
    def model_joblib(self) -> str:
        return os.path.join(self.path, "model.joblib")

    @property
    def model_json(self) -> str:
        return os.path.join(self.path, "model.json")

    @property
    def metrics_json(self) -> str:
        return os.path.join(self.path, "metrics.json")

    @property
    def sample_json(self) -> str:
        return os.path.join(self.path, "sklearn_sample.json")


def list_versions() -> list[str]:
    """All existing version directories, ascending by number."""
    if not os.path.isdir(MODEL_DIR):
        return []
    found = []
    for name in os.listdir(MODEL_DIR):
        m = _VERSION_RE.match(name)
        if m and os.path.isdir(os.path.join(MODEL_DIR, name)):
            found.append((int(m.group(1)), name))
    return [name for _, name in sorted(found)]


def next_version() -> ModelVersion:
    """Allocate the next version directory and create it."""
    versions = list_versions()
    n = 1 if not versions else int(_VERSION_RE.match(versions[-1]).group(1)) + 1
    version = f"v{n}"
    path = os.path.join(MODEL_DIR, version)
    os.makedirs(path, exist_ok=True)
    return ModelVersion(version=version, path=path)


def get_version(version: str) -> ModelVersion:
    return ModelVersion(version=version, path=os.path.join(MODEL_DIR, version))


def set_current(version: str) -> None:
    """
    Promote a version: write the pointer and publish its artefacts to
    `ml/models/current/`, which is what the runtime loads and what is committed.
    """
    import shutil

    os.makedirs(MODEL_DIR, exist_ok=True)
    with open(CURRENT_POINTER, "w", encoding="utf-8") as f:
        json.dump({"current": version}, f, indent=2)
        f.write("\n")

    src = get_version(version)
    os.makedirs(CURRENT_DIR, exist_ok=True)

    # The joblib is deliberately NOT copied: it is a Python pickle the Node
    # runtime cannot read, and it is regenerable by retraining.
    for name in ("model.json", "sklearn_sample.json", "metrics.json", "training_meta.json"):
        source = os.path.join(src.path, name)
        if os.path.exists(source):
            shutil.copyfile(source, os.path.join(CURRENT_DIR, name))


def get_current() -> ModelVersion | None:
    """The promoted version, or None when no model has been trained yet."""
    if not os.path.exists(CURRENT_POINTER):
        return None
    try:
        with open(CURRENT_POINTER, encoding="utf-8") as f:
            version = json.load(f).get("current")
    except (json.JSONDecodeError, OSError):
        return None
    if not version:
        return None
    mv = get_version(version)
    return mv if os.path.isdir(mv.path) else None
