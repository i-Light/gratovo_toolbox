"""`python -I -u -m gratovo_pipeline.gemini`: the Gemini bridge, the long-lived process main runs
(plan D2; `daemon.py`). There is no subcommand: the old command line is not ported (plan D13)."""

import sys

from gratovo_pipeline.gemini.daemon import main

if __name__ == "__main__":
    sys.exit(main())
