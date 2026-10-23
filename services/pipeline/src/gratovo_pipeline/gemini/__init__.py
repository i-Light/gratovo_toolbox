"""The Gemini bridge: drives the Gemini web page through a browser extension (step 3e-3).

Python runs a WebSocket server on 127.0.0.1; the extension (step 6) connects to it and clicks and
types in a gemini.google.com tab. Main runs the bridge as one long-lived process and talks JSON
lines to it (`daemon.py`, `gemini.schema.json`). The wire contracts are the old app's
`legacy/pipeline/gemini_bridge/PROTOCOL.md` (with the extension) and `DAEMON.md` (with main).
"""

__version__ = "0.2.0"
