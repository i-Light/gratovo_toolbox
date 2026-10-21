"""`python -I -u -m gratovo_pipeline`: the process the app starts for a job (ADR 0013).

It says `ready`, reads one `start` line, then watches stdin for `stop` (or for stdin to close)
while the job runs. Every way out writes an `end` line last; the exit code is 0 once it has.
"""

from __future__ import annotations

import io
import sys

from gratovo_pipeline import protocol, run_control
from gratovo_pipeline.jobs import search


def _utf8(stream: object) -> None:
    """A pipe on Windows defaults to the system code page and \\r\\n line ends: a channel name
    with an emoji would end the run. The protocol is UTF-8 with plain \\n."""
    if isinstance(stream, io.TextIOWrapper):
        stream.reconfigure(encoding="utf-8", newline="\n")


def main() -> int:
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        _utf8(stream)
    emitter = protocol.Emitter(sys.stdout)
    emitter.ready()
    try:
        start = protocol.parse_start(sys.stdin.readline(protocol.MAX_LINE))
    except protocol.BadStartError as error:
        emitter.end(state="failed", at=0, found=0, kept=0, error=("bad_start", str(error)))
        return 0
    protocol.listen_for_stop(sys.stdin, run_control.request_stop)
    search.run(start, emitter)
    return 0


if __name__ == "__main__":
    sys.exit(main())
