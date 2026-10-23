"""Where the pipeline's own shipped data lives: `services/pipeline/data/`.

The comms playbook, its Gemini skills and test cases (`data/comms/`) and the keyword and classifier
prompts (`data/gemini-skills/`) travel with the code. This is the one place that knows where; every
other module asks here, and nothing reads the old repository's `data/` folder.

The data is not inside the package because it is large and edited by its own tools; the packaged
app (step 3h) ships `services/pipeline/` as it is, so the relative path holds there too.
"""

from __future__ import annotations

from pathlib import Path

# src/gratovo_pipeline/paths.py → services/pipeline
_PIPELINE_ROOT = Path(__file__).resolve().parent.parent.parent

DATA_DIR = _PIPELINE_ROOT / "data"
COMMS_DIR = DATA_DIR / "comms"
PLAYBOOK_DIR = COMMS_DIR / "playbook"
COMMS_SKILL_DIR = COMMS_DIR / "skill"
COMMS_TESTS_DIR = COMMS_DIR / "tests"
GEMINI_SKILLS_DIR = DATA_DIR / "gemini-skills"
