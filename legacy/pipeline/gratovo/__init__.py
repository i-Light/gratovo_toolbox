"""The Gratovo sourcing pipeline.

Layout (everything the pipeline needs, and nothing else):

    pipeline/
      search.py                 the entry point — `python search.py`
      gratovo/
        config.py               paths, .env, settings.json, run_config.json
        store.py                the local SQLite store (works offline, always)
        sync.py                 push/pull between that store and Supabase
        scrapetube/             vendored YouTube scraper
      tools/
        import_existing_data.py one-off bulk import into Supabase
    data/                       .env, settings.json, keywords.json
      database/                 gratovo.db, mailbox.db, email_library.db

This replaced a flat `OLD/old repo code/` folder whose modules imported each
other by bare name and resolved paths with hardcoded Windows backslashes. The
practical consequences of that were real: the scripts only ran when the working
directory happened to be right, and nothing could import them from elsewhere.
"""
