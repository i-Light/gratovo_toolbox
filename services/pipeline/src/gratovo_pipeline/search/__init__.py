"""The keyword search: find channels, read their details and recent uploads, and decide which
are kept (ported from the old `pipeline.py`).

- `context`: what a search runs with (the store, the rules, a source, the pacing, the events).
- `discover`: the live source, over scrapetube and the Data API.
- `keyword`: one keyword, end to end.
- `auto_clean`: the rule's subscriber gate, before any upload is read.
- `backfill`: the backlog of channels still missing their uploads.
- `signals`: sponsorship and found emails, derived from the stored text.
- `pacing`: the waits between scraped pages.
"""
