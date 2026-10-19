"""Starts the Gemini bridge -- what the app runs instead of `python -m gemini_bridge`.

    python -u run_gemini_daemon.py daemon --port 8765 --data-dir <data>

Any `gemini_bridge` command works the same way (`... run_gemini_daemon.py
firefox status`), because this only puts the package on the import path and
then runs it exactly as `-m` would.

Why a script and not `-m`: the installed app runs the bundled embeddable
CPython, and its `python312._pth` switches the interpreter into isolated
mode -- neither the working directory nor PYTHONPATH is on `sys.path`, and
the script's own folder is not added either. `-m gemini_bridge` therefore
answered "No module named gemini_bridge", the daemon never started, and the
extension had nothing to connect to, while the same app run from VS Code
(system Python, where `-m` adds the working directory) worked. Every other
entry point (`search.py`, `tools/*.py`) inserts its own folder for the same
reason; tests/test_run_gemini_daemon.py runs this under `python -I` so the
difference cannot come back unnoticed.
"""

import os
import runpy
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

if __name__ == "__main__":
    # alter_sys: argv[0] and sys.modules["__main__"] become the package's, as
    # under -m, so argparse names the program correctly and the rest of argv
    # (`daemon --port ...`) reaches the CLI untouched.
    runpy.run_module("gemini_bridge", run_name="__main__", alter_sys=True)
