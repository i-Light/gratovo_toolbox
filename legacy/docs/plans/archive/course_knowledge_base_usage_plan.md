# A growing, AI-queryable knowledge base over the course + business corpus

## Context

The IMA Accelerator course has been fully scraped to `E:\IMA work\Learning` — 328
lesson pages, 575 coaching-call transcripts, 78 lesson videos, and a few business PDFs. Right
now it is **inert**: ~6.5 million words of JSON that nothing can query. Meanwhile
`gratovo_toolbox` already has an AI layer (`lib/core/ai/`), a Gemini browser bridge, and an
81 KB hand-written email-drafting skill whose doctrine came out of that course by hand.

The goal is to make the corpus **queryable, citable and growing**, so that:

1. a tool-using agent (Claude Code) or NotebookLM can **learn and answer from all of it**;
2. the **outreach drafting and email-roasting** flows are grounded in what the course actually
   teaches, not in what an LLM guesses;
3. **new material plugs in** — more course content, lesson-video transcripts, and entirely new
   corpora of PDFs/docs/markdown from elsewhere — without a rewrite each time.

Intended outcome: one command indexes everything, a CLI (later MCP) answers questions with
citations, and the `gemini skills/` files get **regenerated from the corpus instead of
hand-maintained**.

---

## The finding that shapes the design

Measured, not estimated:

| | words | share |
|---|---|---|
| Taught curriculum (modules 1–6, 8) | **87,747** | 1.4% |
| Module 7 pages (call-recording indexes) | 134,269 | 2.1% |
| **575 call transcripts** | **6,244,044** | **96.5%** |
| Lesson video, once transcribed (est.) | ~301,560 | |
| **Total** | **~6.77 M** | |

**The entire taught curriculum is ~117k tokens — it fits in one context window.** Retrieval is
not needed for it; it can be handed to an agent whole. The 6.2 M words of coaching calls are
70× larger and are the *only* reason a search layer must exist.

So: **this is a search engine over 778 hours of coaching calls, with the curriculum as a small
always-loadable companion.** Both are doctrine — the calls are real situations and often carry
more weight than a lesson page — but they need different access paths.

A second measured finding: **FTS5 alone is already good on this corpus.** A real index over all
of it built in **3.6 seconds** using nothing but stdlib `sqlite3`, answered in 40–66 ms, and
returned correct top hits for natural questions ("how do I stop sounding desperate in a first
email" → `1.2. Learn how to Communicate`: *"Avoid sounding needy, desperate, or overly
excited"*). 778 hours of people talking means almost any phrasing already appears verbatim.
Embeddings are therefore a **refinement, not a foundation** — which is why they are optional.

---

## Architecture

```
E:\IMA work\Learning\                     the corpus (unchanged, read-only to us)
  course scraping toolkit\                existing: manager.py run already captures & updates
    course content\pages json\            328 page JSONs  {link, html, text, video}
    course content\transcripts.json       575 calls, speaker-attributed, @mm:ss inline
    course content\course videos\         91 .mp4 captured by the toolkit (see note below)
  Learning Material\*.pdf                 Cold Email Sauce, checklist, IMA Playbook
  Learning Material\The course\**\*.mp4   78 files / 35.9 h  -> Whisper backfill

c:\IMA work\gratovo_code\
  pipeline\knowledge\                     NEW — everything below
  data\database\knowledge.db              NEW — the index (gitignored, like the other three)
  data\knowledge\                          NEW — editable config + review files
  data\gemini skills\                     EXISTING — the OUTPUT, regenerated from the corpus
```

The roots are siblings on `E:`, not nested, and the folder names contain spaces. Both
`sources.json` and the Whisper step must quote them. **Two video folders exist:** the toolkit's
`course videos\` (91 files) and `Learning Material\The course\` (78 files). Before Phase 4,
check how far they overlap and pick one root, so no lesson is transcribed or indexed twice.
The 78 also include **8 `Success Stories` videos, which D19 puts out of scope**. Leaving them
out gives 70 files. Re-ffprobe the in-scope set, because the 35.9 h / ~9 h figures cover all 78.

**Storage: local only** (D1). R2 + multi-machine sync is a documented appendix, not built.

### New module layout — `pipeline/knowledge/`

| File | Responsibility |
|---|---|
| `config.py` | loads `data/knowledge/sources.json`; resolves roots; honours `_private/` exclusion |
| `store.py` | `knowledge.db` open + **append-only migrations** (mirrors `gratovo/store.py:init_db` idiom) |
| `parsers/page_json.py` | 328 page JSONs → documents (uses `text`, drops `html` — D6) |
| `parsers/transcripts.py` | `transcripts.json` → one document per call + all metadata |
| `parsers/pdf.py` | text-layer extraction via `pypdf` (D10); spot-check the 3 outputs before trusting them |
| `parsers/plain.py` | `.md` / `.txt` / `.docx` for future corpora |
| `parsers/media.py` | Whisper output (`.json` sidecars) → documents |
| `chunk.py` | structure-aware chunking, versioned (`CHUNKER_VERSION`); labels each turn coach/student |
| `classify.py` | topic tags **per chunk**, rolled up to call-level module(s); coach/type resolution; writes the review file |
| `index.py` | the orchestrator: walk → hash → skip unchanged (file hash **and** parser/chunker version) → parse → chunk → store |
| `embed.py` | **optional**; no-op unless embeddings are enabled |
| `search.py` | hybrid via Reciprocal Rank Fusion; FTS5-only when no vectors exist |
| `export.py` | curriculum file, per-module files, themed bundles (participant emails stripped) |
| `skills.py` | regenerate skill files and **propose per-section replacements**, headings locked |
| `examples.py` | derived example sets: roast-call critiques and PDF templates (Phase 9) |
| `evals.py` | score retrieval against a question set |
| `cli.py` | `python -m knowledge <cmd>` — JSON on stdout |
| `mcp_server.py` | thin stdio MCP wrapper over the same functions (Phase 6) |

**Dependency discipline** (the point of D17's FTS5-only mode): base install is **stdlib +
`pypdf`**. Heavy extras go in separate files so a weak machine can run everything but vectors.

```
pipeline/requirements-knowledge.txt            pypdf            (base — FTS5 works with this)
pipeline/requirements-knowledge-embed.txt      sentence-transformers, torch, sqlite-vec
pipeline/requirements-knowledge-whisper.txt    faster-whisper   (ffmpeg already on PATH)
```

All verified to resolve on the installed **Python 3.14.6**: `torch 2.14.1` (cp314),
`sentence-transformers 6.1.0`, `faster-whisper 1.2.1` + `ctranslate2 4.8.2` (cp314),
`sqlite-vec 0.1.9` (win_amd64), `pypdf 6.19.0`. Local SQLite is **3.50.4 with FTS5 and
extension loading both available**.

---

## Schema — `data/database/knowledge.db`

Append-only migration list, WAL, `synchronous=FULL`, following
`lib/core/local_db/local_db_io.dart` and `gratovo/store.py` exactly. **Never edit a shipped
migration; only append.**

```sql
-- v1 ---------------------------------------------------------------------
CREATE TABLE corpora (                -- one row per watched root
  id           TEXT PRIMARY KEY,      -- 'course', 'business', ...
  label        TEXT NOT NULL,
  root         TEXT NOT NULL,
  kind         TEXT NOT NULL,         -- which parser family applies
  sensitivity  TEXT,                  -- NULL in v1, reserved (D11)
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE documents (
  id            TEXT PRIMARY KEY,     -- stable: corpus_id + hash(rel_path)
  corpus_id     TEXT NOT NULL REFERENCES corpora(id),
  source_type   TEXT NOT NULL,        -- 'curriculum'|'call'|'lesson_video'|'pdf'|'note'
  rel_path      TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,        -- VERBATIM full text. Never summarized (D9)
  content_hash  TEXT NOT NULL,        -- sha256(body): change detection + duplicate flagging
  file_hash     TEXT,                 -- sha256(source unit): skip unchanged on re-index.
                                      --   per CALL for transcripts.json, not per file
  module        TEXT,                 -- primary module; all topics live in chunk_topics
  module_source TEXT,                 -- 'title'|'content'|'manual'  <- auditable
  module_conf   REAL,
  coach         TEXT,
  call_type     TEXT,                 -- roast|negotiation|brands|influencers|qa|support|...
  occurred_on   TEXT,
  duration_min  INTEGER,
  url           TEXT,                 -- Skool / Fathom link, for citation
  video_path    TEXT,
  duplicate_of  TEXT REFERENCES documents(id),   -- FLAGGED, never dropped (D18)
  sensitivity   TEXT,                 -- NULL in v1, reserved (D11)
  parser_ver    INTEGER NOT NULL,     -- bumping PARSER_VERSION re-parses (D27)
  chunker_ver   INTEGER NOT NULL,
  indexed_at    TEXT NOT NULL
);
CREATE INDEX documents_corpus  ON documents (corpus_id, source_type);
CREATE INDEX documents_module  ON documents (module);
CREATE INDEX documents_hash    ON documents (content_hash);

CREATE TABLE chunks (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ord         INTEGER NOT NULL,
  text        TEXT NOT NULL,
  start_char  INTEGER NOT NULL,       -- offsets into documents.body ->
  end_char    INTEGER NOT NULL,       --   expand-to-full-source (D13)
  speakers    TEXT,                   -- free: already in the transcript text
  speaker_role TEXT,                  -- 'coach'|'student'|'mixed'|NULL (D29)
  at_marker   TEXT,                   -- nearest @mm:ss; free, same reason
  header      TEXT,                   -- "<title> · <call_type> · <coach> · <date>",
                                      --   built from metadata; NOT part of `text` (D30)
  embedding   BLOB,                   -- NULL in FTS5-only mode
  embed_model TEXT
);
CREATE INDEX chunks_doc ON chunks (document_id, ord);

CREATE TABLE chunk_topics (           -- many topics per call; Q&A calls are not one module
  chunk_id    TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  module      TEXT NOT NULL,
  source      TEXT NOT NULL,          -- 'title'|'content'|'llm'|'manual'
  confidence  REAL,
  PRIMARY KEY (chunk_id, module)
);
CREATE INDEX chunk_topics_module ON chunk_topics (module);

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text, header,                       -- header is indexed, weighted low in bm25()
  content='chunks', content_rowid='rowid',
  tokenize='porter unicode61'          -- unicode61 also covers the 31 partly-Arabic calls
);
-- plus the three standard sync triggers keeping chunks_fts in step with chunks
```

`header` replaces the old `title UNINDEXED`. With the title unindexed, a search for
"negotiation" could not match a call titled "Negotiation…", and no chunk carried its coach or
call type as searchable text. A metadata header fixes both at no cost. It sits in its own
column, so `start_char`/`end_char` still point into a verbatim `body`, and D9's byte-identical
`get` still holds.

Projected size: ~45,000 chunks, **~120 MB** FTS5-only; +70–180 MB if embeddings are enabled.

**Why `source_type` matters:** it is the authority label (D-authority). Retrieval returns it on
every hit so the AI can say *"the curriculum says X, but Ammar on the 24/1 roast call says Y"*
rather than silently picking one.

**Ranking does not boost by `source_type`.** Weighting the curriculum above calls would contradict
the stance that calls often carry more weight. It would also be redundant, because the
curriculum is loaded whole anyway. Inside a call, the authority question that matters is a
*student* voicing a bad idea versus a *coach* correcting it. `speaker_role` covers that (D29).

---

## Ingestion

One command, incremental, idempotent:

```
python -m knowledge index              # everything in sources.json that changed
python -m knowledge index --corpus course --force
python -m knowledge status             # what's indexed, how fresh, what's missing
```

Flow per source unit: **hash → skip only if `file_hash`, `parser_ver` *and* `chunker_ver` are
all unchanged → parse → chunk → upsert → reindex FTS**. A corpus with nothing new is a no-op in
under a second.

Two things this guards against:

- **Parser fixes that never land.** Skipping on file hash alone means a fixed parser changes
  nothing until someone remembers `--force`. `PARSER_VERSION` works like `CHUNKER_VERSION`:
  bump it and the next index re-parses (D27).
- **One file holding 575 calls.** `transcripts.json` is a single file, so its "file hash" is
  computed per call (over that call's record). Otherwise one new call would re-parse all 575.
  That only costs seconds, but it would also churn `indexed_at` on every call.

**Hook it onto the existing capture chain.** `manager.py run` already does
crawl → capture → text → videos → transcripts → manifest → verify, and already knows what is
new vs changed (`--refresh` rewrites only pages whose text or video changed). Add `index` as a
final step so new course content becomes searchable in the same run that captures it. That is
the whole of "dynamically growing".

### Chunking (`chunk.py`, versioned)

Structure-aware per `source_type`, because a 68,000-char speaker-attributed call and a
900-word lesson page are not the same object:

- **Calls** — split on `@mm:ss - Speaker` turn boundaries, accumulating turns to a target
  ~1,200 chars, never splitting mid-turn. Records the turn's speakers and the leading `@mm:ss`,
  and sets `speaker_role` from a coach list in `settings.json` (Ammar, Osama, Fawaz, Dylan, …).
  Anyone not on the list counts as a student. Coach labels in Fathom carry `(Imaccelerator)`,
  which is more reliable than names. Fathom also files coach replies under the student's label
  (31 of 40 sampled), so `speaker_role` is a first guess. Anything used as evidence goes through
  attribution (D37).
- **Curriculum / PDFs / markdown** — split on headings, then paragraphs, same target.
- **Overlap** ~15% so an answer straddling a boundary is still found whole.
- `CHUNKER_VERSION` is stored per document; bumping it re-chunks on the next index.

Targets live in config, because re-chunking is **4 seconds** in FTS5-only mode — cheap enough
to tune empirically rather than theorise about.

### Duplicates (D18)

Exact `content_hash` match → the later document gets `duplicate_of` set. **Nothing is skipped.**
Search collapses flagged duplicates in results by default (`--show-duplicates` to see them).

**Measured: across all 575 call transcripts there are 0 exact duplicates.** So whole-document
hashing will not, by itself, stop the monthly "All Q/A Calls in December" page and its
individual calls from filling the same top ten. That only happens if their bodies are
byte-identical, which is unlikely for a page that lists calls. Before relying on D18 for this,
measure how much the Module 7 pages overlap with the calls they list. If they do overlap, add a
per-chunk `content_hash` and collapse at chunk level. Near-duplicate detection stays deferred.

### Call → module classification (`classify.py`)

Measured on the real titles: **type parses from 70%, coach from 50%, date from 100%** (the
`date` field, not the title). The remaining **133 calls are bare dates** like `23/1`, `30/1` —
no topic in the title at all.

A strict re-measure finds **83 titles that are nothing but a date**, and every one of them comes
from a monthly "All Q/A Calls in <month>" (or "All Fawaz Calls") page. Re-check the 133 against
this before Phase 2. Either way the lesson is the same: **these are general Q&A calls that
range over several modules.** Assigning one module per call hides most of what is in them
(D21, amended).

So classification works **per chunk**, not per call:

1. **Title parse** where the title says something. That applies to the whole call:
   `call_type` and `coach`, plus a module when the type implies one (a roast call → outreach).
2. **Content scoring per chunk:** score each chunk against each module's own text (stdlib
   TF-IDF cosine, no new dependency). Every module above a threshold goes into `chunk_topics`.
   The call's `module` is the one covering the most chunks. All its topics stay queryable.
3. **Optional LLM pass** over the rows still low-confidence after step 2, through the app's
   existing Anthropic API provider. The Gemini bridge drives a browser and is not a batch API.
   The LLM sees the chunks, not "the first N words", because a Q&A call changes topic all the
   way through. That is ~2 M input tokens across the bare-date calls. It **reduces** review;
   it does not replace it.

Everything goes to an editable review file with provenance and confidence:

`data/knowledge/call_map.json`
```json
{ "L1n_d6D29ab…": { "modules": ["module 2 influencers", "module 3 brands"],
                     "primary": "module 2 influencers", "call_type": "negotiation",
                     "coach": "osama", "source": "content", "confidence": 0.41 } }
```

`source: "manual"` is **never overwritten** by a re-index. You review the low-confidence rows,
not all 575.

TF-IDF has a known weakness here. People talking on a call use different words from a polished
lesson page, so expect low confidence across the board on Q&A calls. That is what step 3 and
the review file are for. Phase 3 evals show whether module filtering is accurate enough to
rely on.

### Lesson video backfill (Whisper, D7)

**35.9 hours** across 78 files (ffprobe'd, not estimated). `faster-whisper`, model `small`,
int8, CPU — the RX 580 is Polaris, so **no CUDA and no ROCm on Windows**; GPU is not an option
without switching to whisper.cpp/Vulkan, and is not needed.

```
python -m knowledge transcribe --status          # what's done, what's left
python -m knowledge transcribe --model small     # ~9 h, resumable, one file at a time
```

Writes a `.json` sidecar next to each video (segments + timestamps) so a crash resumes and a
re-index never re-transcribes. Benchmark one representative file first and confirm ~4×
realtime before committing the overnight run.

**Seed the decoder with the course's vocabulary.** faster-whisper's `initial_prompt` (and
`hotwords`) takes a lexicon from `settings.json`: coach names, "Skool", "IMA", "ROAS", "CPM",
"follow-up", "roast". It costs nothing, and FTS5 can only find words that were spelled right.
The scale of the problem, measured on the existing Fathom transcripts: "fall-up" / "fall up"
appears 29 times against ~7,000 correct "follow-up". It is small but real, and lesson videos
are dense with exactly this jargon. Speed is not a reason to move to whisper.cpp/Vulkan,
because this is one overnight run. The only reason would be running a larger model for
accuracy, if the spot-check shows `small` mangling terms.

---

## Retrieval (`search.py`)

**Hybrid, with FTS5-only as a first-class mode** (D17) so a weak machine installs nothing heavy:

```
score = 1/(60 + fts_rank) + 1/(60 + vector_rank)     when embeddings exist (RRF)
score = bm25(chunks_fts, 1.0, 0.3)                    otherwise: text, header weights
```

**Reciprocal Rank Fusion, not a blend of normalised scores.** BM25 has no upper bound and
cosine sits in [-1, 1]. Combining the two raw scores needs a normalisation that drifts with the
corpus. RRF combines *ranks*, so there is nothing to keep re-tuning. The constant 60 is the
standard default. Tune it with Phase 3 evals only if they ask for it.

The seam is one function. `embeddings.enabled: false` in config means `embed.py` never imports
torch and `chunks.embedding` stays NULL. Nothing else changes.

```
python -m knowledge search "how do I price a 200k sub channel"     # ranked chunk hits
python -m knowledge search "..." --module "module 3 brands" --type call --coach osama
python -m knowledge search "..." --role coach                      # coach turns only
python -m knowledge get <document_id>                              # the FULL verbatim document
python -m knowledge get <chunk_id> --context 2                     # chunk ± 2 neighbours
python -m knowledge get <chunk_id> --expand                        # chunk's document, whole
```

`--module` filters through `chunk_topics`, so it finds the brands discussion inside a general
Q&A call. `--context N` is the cheap middle step. A student may spend three minutes laying out
their situation before a coach gives a thirty-second rule. The neighbours bring back that
setup without pulling a whole 68,000-char call.

Every hit carries `document_id`, `title`, `source_type`, `url`, `module`, `coach`,
`occurred_on`, `speaker_role`, `at_marker` and a snippet, so an agent can rank, then pull whole
sources on demand. **`occurred_on` matters most when sources disagree.** D22 surfaces conflicts
instead of resolving them, and "the 2025 call says X, the 2024 lesson says Y" is the first
thing you need to judge one. That pairing is how
D13 reconciles chunked search with **D9: no information loss**. Nothing is ever summarized at
ingest, and the full verbatim text is always one call away.

**Agent access (D-agent): CLI first, MCP second.** The CLI is the real interface — testable by
hand, callable from any script or agent today. `mcp_server.py` is a thin wrapper over the same
functions, added once the function signatures have settled.

---

## Exports

### The curriculum file + per-module files

```
python -m knowledge export curriculum     # modules 1-6,8 course text only — 87,747 words
python -m knowledge export modules        # one file per module: course text + its mapped calls
```

- **`curriculum.md`** — the whole taught course, **course text only, no calls**, ~117k tokens.
  Hand it to any agent wholesale: no retrieval, no chunking, nothing missed. Highest
  value-per-line in this plan.
- **`module-N-*.md`** — that module's course text **plus the full text of every call mapped to
  it**, because the calls are doctrine too. These get large (a topical module may pull ~1 M
  words), so they **auto-split at a configurable word cap** with `part N of M` naming. A call
  is included in every module whose `chunk_topics` coverage passes a threshold. A general Q&A
  call can therefore appear in several module files, which is correct: it taught all of them.

### NotebookLM bundles

Packed **by theme** (roast-my-email, negotiations, brands, influencers, mindset/productivity,
support), driven by `data/knowledge/themes.json` which you can edit.

```
python -m knowledge export bundles --limit-words 450000
```

Honest constraints, which is why this is a file-writer and nothing more: NotebookLM is
cloud-hosted Google, uploads are manual in a browser (no API to plan around), sources are
static snapshots that go stale as the corpus grows, and the ~500k-word-per-source cap means
individual call identity is lost inside a bundle. It is a **reading and synthesis tool for
you** — it cannot feed drafting, QA or skill generation. The local DB does that. The exporter
is ~150 lines because the DB already holds everything.

> **Amended 2026-10-01.** Built in the sandbox (`notebook-export/export.py`, 29 sources), and two
> of the limits above turned out not to hold:
> - **Call identity:** it survives once a `[still in CALL: title | date]` tag is repeated every 800
>   words.
> - **Skill generation:** the notebook does feed it. Claude asks it through the Gemini bridge in
>   parallel tabs. It is used for *discovery* only. Every quote it returns is verified against the
>   raw KB before it counts (D36).
>
> Changed sources are re-uploaded by hand, using the export manifest (NEW / CHANGED / REMOVED).

**Bundles strip participant email addresses.** Fathom speaker labels look like
`@0:07 - Name (address@gmail.com)`, so students' addresses are in the transcript text.
NotebookLM is cloud-hosted, so every bundle reduces labels to the name alone. This is the
first place D5 ("private now") actually bites. The local DB and local exports keep the text
verbatim (D9).

---

## The skill factory (sandbox session, 2026-10-01)

Built and tested outside the repo in `E:\IMA work\Sandbox\kb-session\`:
- `notebook-export/`: the NotebookLM packer;
- `bridge/`: questions to Gemini over the notebook, in parallel tabs;
- `factory/`: cards, evidence ledger, attribution, the page, the bench.

The page where the owner reads and decides is a private artifact,
`https://claude.ai/artifact/9BunH3arYx6Er7PW3QJD6x`. Its decisions and bench verdicts live in its db.

**How to run it** (update with new content only, or relearn everything) is a separate document:
[skill_factory_instructions.md](skill_factory_instructions.md). That file is the factory's
standing instructions, not a skill, and never goes into a drafting prompt.

**Where this section and "Skill regeneration" below disagree, this section wins** (D34).

### What the session measured

| Finding | Number | Consequence |
|---|---|---|
| NotebookLM packed by topic fits the free tier | 29 sources (18 call bundles, 7 curriculum modules, 4 PDFs) of the 50 allowed | Phase 5 is done in the sandbox |
| Gemini cited the wrong call when a passage was far from the call's header | correct citations went from 0/6 to 6/7 once a `[still in CALL: title \| date]` tag was repeated every 800 words | the tag is part of the export format |
| Gemini's quotes are not evidence by themselves | 53 of 388 quoted lines (14%) are not in the KB at all | every quote is looked up verbatim in the raw KB (exact or close) before it counts |
| Fathom files coach replies under the student's label | of 40 quotes sitting in student turns, Gemini judged 31 to be the coach | a coach list (D29) is not enough. An automated attribution pass decides who said it (D37) |
| Most "conflicts" in the KB are different situations | e.g. "never mention money" vs "'around the $2,000 range' gets the reply" = general outreach vs a live deal | split doctrine by situation (knobs) before calling anything a conflict |
| No email in the transcripts appears as a clean block | but coaches read submitted emails aloud with critique mixed in: 135 roast calls carry 364 coach praise lines | roast calls may be the largest source of example emails. To be tested (experiment E1, under "Example sets") |
| Only the cards that apply are sent | about 4 KB of rules per draft, against the 80 KB drafter skill | no "send everything and hope" |
| First test bench, 5 real creators × 2 variants | judge average 7.6 with cards only, 7.0 with the PDF examples added | examples stay optional, and on only where the bench shows they help |

### How it fits together

```
 KB: course pages · 575 calls · PDFs · my-emails/
   │  export.py: packed by topic, call tag every 800 words, emails stripped,
   │             manifest NEW / CHANGED / REMOVED
   ▼
 NotebookLM notebook ──► Gemini via the bridge (parallel tabs, "@Gemini Notebook")
   │                      question bank: bridge/questions/*.json (versioned, only grows)
   ▼
 answers ──► ledger.py      every quote located verbatim in the raw KB
         ──► attribution.py who really said it: coach / student / unclear
   ▼
 content.py:  KNOBS ──► CARDS ──► RULES (+ evidence, use, when)  +  DECISIONS
   ▼                                                     ▲
 factory page: read the evidence, decide in the inbox ───┘  (saved in the page's db)
   ▼
 bench.py: real creators × knobs ──► drafts ──► lint + judge + repeat test ──► owner's verdicts
   ▼
 skill output: cards the app assembles per draft (below)
```

### The pieces

**Knobs** describe the situation. Outreach has 13. Each knob appears only when it matters (its
`show` condition):

| Knob | Values |
|---|---|
| Who reads it | creator · creator's manager/agency · brand |
| Stage | first email · follow-up 1 · follow-up 2 · last follow-up · answering their reply · re-engaging |
| Channel | email · Instagram DM · LinkedIn DM |
| What I have | nothing yet · creators on my roster · a brand in hand · a deal with a budget |
| Brands in mind | none · brands that fit them (never implying a connection) |
| Their sponsors | unknown · none lately · some · every video · sells own product |
| What I'm pitching *(brand)* | one creator · several. You never email a brand without creators to pitch |
| Closed deals / case studies *(brand)* | none yet · some |
| Brand type | already runs influencer campaigns · never did · B2B/SaaS · apps/games · e-commerce · affiliate/gifting only |
| Brand size | small (about 50 employees or fewer) · big |
| Their reply *(creator)* | 10 reply types (interested, which brand?, media kit, budget?, gifting, …) |
| Their reply *(brand)* | 7 reply types (send creators, states budget, case studies, not now, …) |
| Their English | native · non-native |

**Cards** hold the rules for one knob value. 57 outreach cards exist so far, plus the negotiation
cards. Each card owns certain email **slots**, and a card can only change its own:

```
            subject  opener  offer  proof  CTA  length
 CORE          ●       ●       ●      ●     ●     ●     always loaded
 who reads             ●                    ●     ●
 stage         ●                            ●     ●
 what I have                   ●      ●
 their sponsors        ●                    ●
```

This is what stops cards from fighting. Where several cards share a slot (the CTA), a bench case
covers that combination.

**Rules** carry:
- **evidence**: verbatim fragments with call, date, speaker, and whether the speaker is a coach.
- **`dec`**: the rule is live only when decision X has option Y.
- **`yours`** or **`house`**: the owner's own words. These are never reworded.
- **`use`**: `draft`, `research`, `checker` or `ops`. Only `draft` rules reach the writer.
- **`when`**: a rule-level knob filter, e.g. "follow-up 2 only".

**The decision inbox** is everything the KB cannot settle by itself:

| Kind | Meaning |
|---|---|
| policy | how the factory weighs sources |
| house | style calls for the owner |
| evolution | a coach changed his advice over time |
| conflict | two rules disagree in the same situation |
| skill | old skills and how they're treated |
| gap | the KB is silent |

The owner's 28 decisions so far are saved in the page's db, which is the source of truth for them.
The ones that shape the system itself are recorded here:

| | Owner decision |
|---|---|
| P1 | A newer statement from the same coach wins only if both dates are known and it is at least a year newer. Otherwise ask |
| P2 | Calls win over lesson pages |
| P3 | One verified coach quote is enough for a rule |
| P4 | Close (reworded) matches count as evidence |
| P5 | Quotes in student turns are attributed **automatically**, with no manual reading |
| P6 | When the KB is silent, ask |
| P7 | Abu Numaan counts as a coach |
| S1 | The old `email drafter skill.md` is **not a source, not a base and not a reference**. Never learn from it |
| D16 | Every generated email differs in words, structure and flow, never a template. Banned words are never used |
| G3 | Example emails come from the PDFs plus the owner's own (`my-emails/`, `.md` or `.txt`) |

### In the app: the knob panel and live preview (D35)

The factory page's "pick the knobs, see what loads" console becomes the app's drafting step. The
pieces it replaces already exist:

| Today | Becomes |
|---|---|
| `GeminiDraftDialog` → `_RulesSection` ("Choose the situation", ticks from `email drafter rules.json`) | **knob chips**, shown or hidden by each knob's `show` condition and prefilled from the record (below). Next to them, a **live preview**: which cards load and why, the rule count, the prompt size, and each rule expandable to its evidence quote |
| `drafting_rules.py` assembling sections of the 80 KB skill | assembles the **draft rules of the loaded cards**, plus the facts block. The guarantees stay: off unless switched on, facts quoted verbatim, fail loud |
| `_LintSummary` | runs the bench's lint, with each flag naming the card rule or decision it enforces |
| `ai_brief_builder.dart` facts | unchanged. Facts stay facts and are never turned into rules |

Prefill comes only from data the app already holds:
- reader = creator for an influencer record;
- stage from the email thread;
- "their sponsors" from the recent videos, when they were classified;
- English from the country.

Anything the app can't infer stays **unknown**, and the "unknown" card loads. The app never
guesses a knob.

The rest of the factory page moves into the app too, each part to the screen where it is used. See
"Implementation: the factory page moves into the app" below. The cards ship as data files that the
app reads, the same way the app reads `data/gemini skills/` today.

### Keeping skills current

There are two modes. Both are specified step by step in
[skill_factory_instructions.md](skill_factory_instructions.md).

```
 UPDATE (after each capture run)              RELEARN (when the way we read the KB changes)
 ────────────────────────────────             ───────────────────────────────────────────
 only sources whose hash changed              whole KB, built in the shadow (factory/next/)
 raw new text + card index → Gemini           question bank + per-source sweep + a floor check
                                                that re-finds every live rule
 verify quotes, attribute speakers            same
 add evidence / add rule / open decision      match findings to the old rule ids, so decisions
 NEVER reword an existing rule                  and verdicts carry over
 bench only the changed knob combinations     bench old vs new on the same cases + goldens
 promote, changelog                           owner reads the diff; promote card by card;
                                                old version kept for rollback
```

A full relearn doesn't lose quality for four reasons:
1. The live cards are a **floor**. Every rule must be found again, or the owner is told why it
   wasn't.
2. Owner text and decisions are **frozen**, keyed by stable ids.
3. Every quote is **re-verified** against the raw KB.
4. A card is promoted only if it **beats or matches the old one on the bench**.

### CTA fix (2026-10-01, second bench round)

In the first bench run, 8 of 10 drafts ended by asking the creator to do work ("send your rates",
"drop a screenshot", "send a time"). The cause was a factory mistake, not the course. Decision D8
offered "assume interest, no yes/no question". That misread Ammar's line. In context (RME
2026-07-29) he says the opposite: "Let me know is soft. I'm leaving you an option… strong CTA is
you don't give them option to decide. They have to answer you… Should I say more details? Are you
interested?"

The course is consistent on CTAs: lesson 2 (influencers), both PDFs, and Ammar from 2025 through
2026, with Imam and Dylan agreeing. The cards now say:

| Rule | Applies to | Key evidence |
|---|---|---|
| One ask per email: the last line, on its own line, ending in "?" | all emails | lesson 2: "The CTA is the last line of your email"; Ammar: "we said one CTA per email" |
| The ask is a short yes/no question, and a yes leads to a specific next step | all emails | lesson 2: "framed as a yes-or-no question"; Ammar 2026-04-04: "CTA should be yes or no question, and you are golden" |
| Never soft: no "let me know (if)", "feel free", "would you be open", "are you open" | first email | Ammar 2026-07-29; Blueprint: "'Would you be open?' = They can just ignore it" |
| The first email asks for nothing that takes work: no rates, media kit, analytics, screenshots, or call times | first email | Ammar 2025-10-15: "I don't send analytics, I don't send rates in first email" |
| Follow-ups may be softer | follow-ups | Blueprint: "In follow-ups, you can be softer. But in initial emails, be strong" |
| Offer to send "details" only when real details exist | all emails | lesson 2: "unless you actually have details ready to send" (D7) |
| To a brand: no "are you open / interested"; the yes/no offers something concrete (the creator's profile) | brand emails | Ammar 2026-01-10 (brands RME) |
| Reply to "which brand?": answer first, then one linked ask (analytics or rates) | "which brand?" replies | Imam 2026-08-23 |

Decision D8 and its knock-on conflict X1 are **retired**. One genuine coach disagreement is left,
and it went to the inbox:
- **X3:** may a brand's first email offer a call? Ammar and Osama say yes for small brands or
  brands new to influencer marketing. Farhad says never (attribution confirmed it was Farhad).
- **Decided (owner, 2026-10-01): A.** A call is allowed for small brands and for brands new to
  influencer marketing. The call rules are on in the export.

**Bench results (same 5 cases, A = cards only, B = cards + PDF examples):**

| Run | What changed | Judge avg | Lint flags | Repeats | CTAs asking for work |
|---|---|---|---|---|---|
| 1 | first cards | 7.3 | 3 (after the opener fix) | 4 | 8 of 10 |
| 2 | course CTA rules, lint checks the CTA | 8.7 | 5 (4 "I noticed…" openers, 1 lint false positive) | 6 (same-case pairs) | 0 |
| 3 | the opener rule moved to core for every reader; personalization scoped to sends; repeat test compares across recipients only | 8.7 | **0** | **0** | 0 |

Every first-email CTA in runs 2 and 3 is one yes/no question ("Should I send the brief?", "Should I
send his channel metrics?").

**Next tuning item.** Two creator drafts ended on the same vague ask, "Should I send an outline of
how we'd work together?". The new CTA repeat check (4-word runs in the ask line, across recipients)
flags it. The fix is a per-"What I have" rule: the yes names the concrete thing you hold (the two
brands, the brief, the creator's numbers). Lesson 2 gives "Are you interested?" for the
no-brands case.

**Fixed 2026-10-02 (owner's live draft).** With "nothing yet" and "no brands in mind", a draft
asked "Should I send over a few brands we have in mind for the channel?". The stage-first rule's
example, "(the brands you have in mind, …)", loaded for every first email and suggested that ask.
The changes:
- The example is gone from the stage-first rule, which now says "something you really have".
- The `inmind-none` card owns the ask: never offer brands, ask whether they want the service. The
  evidence is lesson 2.6: "Sell the service: 'I can find brands that fit your content.'" and
  "'Are you interested?' is enough."
- A new lint check, `no-brand-offer`, flags sending, sharing or showing brands, "brands we have in
  mind" and "brand list".
- This is export v3.

### Not built yet

These are needed before the factory leaves the sandbox:
- stable rule ids;
- `state.json`;
- the delta extraction step;
- the relearn shadow build;
- golden cases built from verdicts;
- running the judge twice per draft.

---

## Implementation: the factory page moves into the app

The factory page (the artifact) was the sandbox's console. Every part of it the owner actually
uses moves into the app, **onto the screen where that job is done**. The parts that are only the
factory's own machinery stay out. Once slices 1–3 land, the artifact page retires.

### Where each part goes

| Factory page part | Goes to (app) | Why there | Slice |
|---|---|---|---|
| Knob console + "what gets loaded" preview | **Draft with Gemini** dialog, step 1 (replaces "Choose the situation") | you pick the situation where you draft | 1 |
| Lint chips naming the rule they enforce | Draft dialog, Result step (`_LintSummary`) | you fix the draft there | 1 |
| Card library: cards, rules, knob conditions, evidence quotes | **Skills page**: an "Outreach" skill whose deck is its cards | the Skills page is where the prompts that feed Gemini are kept | 2 |
| Decision inbox (policy, house, evolution, conflict, gap) | Skills page, the Outreach deck, a "To decide" banner and panel | a decision changes cards, so it sits with them | 2 |
| "Your rules" (yours/house) and switching a rule off | Skills page, on the card ("Add my rule", a switch per rule) | same | 2 |
| Prompt preview for any knob combination ("try a situation") | Skills page, the Outreach deck's right pane (where other decks show the Markdown preview) | to check a card change without opening a thread | 2 |
| What changed in this version (changelog) | Skills page, the Outreach deck header | you see it when you open the skill | 2 |
| Test bench drafts, judge roast, lint, repeat hits | **Email Critique Library**: "Test drafts" records | the library already holds "an email + an expert verdict on it" | 3 |
| Good/bad verdict + why (goldens and regression cases) | Library record (verdict field) + "Rate this draft" in the draft dialog's Result step | real drafts get rated where they are made | 3 |
| My own example emails (`my-emails/`, G3) | Library records marked "my example" | same corpus, same tabs (creator / brand) | 3 |
| Evidence ledger (all 388 quotes), attribution, "What the KB taught us", factory diagram, workflow map | **stay out of the app** (factory internals and docs) | a rule's evidence quote in the Skills page covers what you need while working | — |

**How data moves.** The factory and the app share files. Neither writes the other's files.

```
 factory (sandbox, run by Claude)                    app
 ───────────────────────────────                    ───
 writes  outreach/cards.json      ───────────────►  Skills page + draft dialog (read)
         outreach/inbox.json      ───────────────►  "To decide" panel (read)
         outreach/changelog.json  ───────────────►  deck header (read)
         outreach/bench/latest.json ─────────────►  Library imports as "Test drafts"
 reads   outreach/decisions.json  ◄───────────────  writes: choices, notes, my rules, rules off
         email_library.db (read-only) ◄───────────  writes: verdicts on drafts, my examples
```

All files are under `data/gemini skills/outreach/`. Every write is atomic (`.tmp-<micros>` +
rename). The factory reads the library with `tools/email_library.py`, which already opens it
read-only.

### Do now, later, or drop

| Do now (slices 1–3) | Later | Drop for now |
|---|---|---|
| `cards.json` exported from the factory, read by the daemon | Update / Relearn automation (F3–F4). Until then Claude runs the factory by hand in the sandbox | `knowledge.db`, FTS5, embeddings, MCP (Phases 1–7). The factory doesn't need them yet |
| Knob panel + live card preview in the draft dialog | Running the bench from the app (a "Run test drafts" button: the daemon already assembles prompts after slice 1) | Whisper backfill (Phase 4) |
| Daemon assembles the prompt from the loaded cards | Replies, negotiation and brand outreach as their own knob sets (F6) | `skill propose` against the old drafter skill (Phase 8, replaced by D34) |
| Lint checks for CTA, openers, length and banned words, naming the rule they enforce | | The dialog's "shorter and casual" toggle (length is a card now) |
| Outreach cards, inbox, my rules, changelog in the Skills page (slice 2) | | |
| Test drafts, verdicts and my examples in the Email Critique Library (slice 3) | | |

---

## Slice 1: the draft dialog (knobs, preview, cards-based prompt)

Everything this slice needs already works in the sandbox (cards, verified evidence, prompt
assembly, lint, bench). It changes one dialog and one daemon action, and it retires the 80 KB skill
for outreach drafting.

### The controls

They sit in the existing "Draft with Gemini" dialog, in step 1. They replace "Choose the situation"
(`_RulesSection`).

```
┌ Draft with Gemini ─────────────────────────────────────────────────────┐
│ 1. Situation  ›  2. Drafting  ›  3. Result                             │
│                                                                        │
│ Who reads it    (Creator●) (Manager) (Brand)                    auto   │
│ Stage           (First email●) (Follow-up 1) (Follow-up 2) (Last)  auto │
│ What I have     (Nothing yet●) (Roster) (Brand in hand) (Deal)         │
│ Brands in mind  (None) (Yes●)                                          │
│    Which brands, and why they fit   [Rogue Fitness: …; LMNT: …    ]    │
│ Their sponsors  (Unknown) (None lately●) (Some) (Every video) (Own)    │
│                 check their last 5 videos                              │
│ Their English   (Native●) (Non-native)                          auto   │
│                                                                        │
│ ▸ Gemini gets 9 cards · 38 rules · 3.9 KB                              │
│ ▸ Facts (the brief)                                                    │
│ ☐ Omit audience numbers                                                │
│                                                  [Cancel]  [Draft]     │
└────────────────────────────────────────────────────────────────────────┘
```

**Rules for the controls:**
- **One row per knob, one choice per row** (choice chips). A knob shows only when its `show`
  condition is met. In the common cases that is 5–6 rows, never 13.
- **Prefill only what the app knows for certain**, and mark it `auto`. Tapping overrides it.
  - *Who reads it*: from the thread (an influencer thread means creator).
  - *Stage*: from the thread (nothing sent → first email; n sends with no reply → follow-up n).
  - *Their English*: from the influencer's country.
  - *Their sponsors* and *What I have* start empty, so the Draft button waits for them. The app
    stores no sponsor data, so it never guesses one.
- **A "needs" field appears only when a loaded card needs a fact**, e.g. "Which brands, and why
  they fit" for *Brands in mind: yes*, or "The brand's name" for *Brand in hand*. Draft stays
  disabled until required needs are filled. The fact is quoted verbatim into the prompt, as
  `drafting_rules.py` does today.
- **The preview is one collapsed line**: card count, rule count, prompt size. Expanded, it lists
  each card with the rules it adds, and each rule can open its evidence (quote, coach, date). This
  is the factory page's console, shrunk to one line.
- **Leave the options with no card behind them alone.** "Omit audience numbers" stays.
  "Shorter and casual" goes, because length is a card rule. "Lead with latest upload" becomes the
  personalization card's job.

### Data contract: `data/gemini skills/outreach/cards.json`

The factory writes this file with every decision already resolved. The app and daemon never see
undecided rules, evidence ledgers or the inbox.

```json
{
  "version": 8,
  "generatedAt": "2026-10-01T21:00",
  "workflow": "outreach",
  "knobs": [
    {"id": "reader", "label": "Who reads it", "hint": null,
     "options": [["creator", "Creator"], ["manager", "Creator's manager / agency"], ["brand", "Brand"]],
     "show": {}}
  ],
  "cards": [
    {"id": "inmind-yes", "title": "Brands in mind: yes",
     "when": {"reader": ["creator", "manager"], "inmind": "yes", "have": ["nothing", "roster"]},
     "needs": [{"id": "brands", "label": "Which brands, and why they fit", "required": true}],
     "rules": [
       {"id": "inmind-yes.fit-not-sponsored", "text": "Name 1–2 brands that fit them and haven't sponsored them yet.",
        "when": {}, "why": {"quote": "name 2 brands that are a strong fit for the creator", "who": "Ammar", "date": null, "where": "Lesson 2"}}
     ]}
  ]
}
```

A need may carry its own `when`, in the same form as a rule's. The field is then asked for only under
those knob values. For example, "Sponsor reads on the last ~5 videos" is not asked for while "their
sponsors" is unknown or unset (owner, 2026-10-02). A change to a card's needs bumps the version, and
the changelog lists it under `needsChanged`.

Only `use: "draft"` rules are exported. House rules are exported with the owner's text, and rules
switched off by a decision are left out. The file is written atomically (`.tmp-<micros>` +
rename), the same idiom the app already uses.

### Daemon (`pipeline/gemini_bridge/`)

| Change | Detail |
|---|---|
| new `outreach_cards.py` | `load()`, `catalog()` (knobs + card summaries for the UI), `plan(knobs)` (visible knobs, loaded cards, active rules, needs), `prompt(plan, facts, needs)`. The algorithm is the bench's `loaded_cards` / `rule_applies` / `build_prompt`, moved over unchanged |
| new off-page action `outreach_knobs` | returns `catalog()`, like `draft_rules` does today |
| `draft_email` gets a third mode, `knobs` | today: `scenarios` absent means the whole skill; present means rules mode. `knobs` present means cards mode. The result adds `loadedCards` and `promptStats` (cards, rules, bytes) |
| lint | the bench's checks move into `tools/blueprint_lint.py` (or beside it), knob-aware. Each flag names its card rule, so a chip in the Result step says *why* |
| sequence | stage = first email still returns email 1 + follow-ups, as today. The shared cards go in once, then one short section per follow-up with that stage's card rules and send day (cadence card) |

### App (Dart)

| File | Change |
|---|---|
| `gemini_draft_dialog.dart` | `_SituationSection` replaces `_RulesSection`: chips, needs fields, preview line |
| `gemini_draft_controller.dart` | holds knob values (seeded by the prefill), needs text, catalog loading; `draft()` sends `knobs` + `needs` |
| a small `draft_knobs.dart` model | knob / card / rule types for the catalog JSON (decoded leniently: an unknown field is ignored, never a crash) |
| prefill helper | the three certain knobs from thread + influencer. Unit-tested |

The old rules path (`email drafter rules.json`, `_RulesSection`) stays until slice 1 passes, then
is removed in one commit.

### Done when

1. **Prompts match the bench byte for byte.** For each bench case, the daemon's prompt is
   byte-identical to `bench.py --assemble`'s prompt. That is a pytest with the 5 prompts as golden
   files.
2. **Dialog behaviour is tested.** Widget tests cover:
   - knobs hide and show by `show`;
   - needs fields appear only when needed, and block Draft until filled;
   - the preview count changes with knob changes;
   - the prefill marks `auto`.
3. **Live drafts pass.** In the app, against live Gemini, each bench case drafts with the
   checks below. The bench also gets one **sequence case** (email 1 + its follow-ups in one call),
   because the bench has never tested a sequence:
   - no lint flags;
   - judge ≥ 8;
   - repeat test clean.
4. **The owner judges the real drafts.** The owner marks 10 real drafts from the app good or bad,
   and the bad ones become bench cases. Until slice 3 adds "Rate this draft", this happens on the
   factory page.
5. **Nothing else breaks.** `python -m pytest pipeline/tests/` and `flutter test` stay green, and
   so does CI (format, analyze, pytest).

### Order of work

1. **Factory export:** `factory/export_app.py` writes `cards.json`; add stable rule ids (F1).
2. **Daemon:** `outreach_cards.py` with golden-prompt tests, then the `outreach_knobs` action and
   the `knobs` mode in `draft_email`.
3. **Lint:** port the checks and their tests.
4. **App:** model + controller, then the `_SituationSection` widget and prefill, with widget tests.
5. **Live:** run the bench cases through the app, then collect owner verdicts, then retire the old
   rules path.

---

## Slice 2: Outreach cards in the Skills page

The Skills page shows every skill as a tile that opens into a deck: cards on the left, a preview on
the right (`SkillGroupDeck`). Outreach becomes one more tile. Its deck is built from `cards.json`
instead of a Markdown file, so the page stays familiar while the content changes shape.

```
┌ Skills › Outreach ──────────────── v9 · updated 2026-10-08 · 2 new rules ▸ ─┐
│ ⚑ 1 to decide: X3 "A call in a brand's first email"            [Decide ▸]  │
├────────────────────────────────────────┬────────────────────────────────────┤
│ Core (always)                     21 ▾ │ Try a situation                    │
│   One ask per email, last line, "?"    │ Who reads it (Creator●)(Brand)     │
│     Ammar · 2025-09-10            [on] │ Stage (First●)(FU1)(FU2)(Last)     │
│   The ask is a short yes/no question … │ What I have (Nothing●)(Roster)…    │
│     Ammar · 2026-04-04 · "CTA should   │                                    │
│     be yes or no question…"       [on] │ 9 cards · 38 rules · 3.9 KB        │
│ Who reads it                           │ ───────────────────────────────────│
│   Reader: creator                  5 ▸ │ You write ONE outreach email …     │
│   Reader: brand                    6 ▸ │ ## Core voice + deliverability     │
│ Stage                                  │ - One ask per email. It is the …   │
│   Stage: first email               4 ▸ │ …  (the exact prompt Gemini gets)  │
│ What I have …                          │                                    │
│ [+ Add my rule to this card]           │                                    │
└────────────────────────────────────────┴────────────────────────────────────┘
```

- **Left pane: cards grouped by knob.** Core comes first, then one group per knob, in knob order.
  - Each card is collapsible, with its rule count. Each rule shows its text, a source badge (coach
    and date, *PDF*, *lesson*, *yours*) and an on/off switch. Tapping the badge opens the quote
    with call and date.
  - Rule text from the KB is **read-only**. Wording changes go through the factory, which keeps
    evidence and ids intact. Your own words go in with **"Add my rule"**, which saves a `yours`
    rule.
- **Right pane: "Try a situation".** The same chips as the draft dialog, plus the full assembled
  prompt (from the daemon's `prompt()`, so it is exactly what Gemini will get). This is the right
  pane every deck already has; here it shows the prompt instead of Markdown.
- **"To decide" banner.** It shows only when `inbox.json` has open items. The panel shows each
  decision's question, its options with their quotes, and choice chips plus a note field, like the
  factory page's inbox.
  - A choice saves to `decisions.json` and takes effect at the factory's next export.
  - The banner says so in plain words: "applies after the next factory run".
- **Header: version and changelog.** For example "2 new rules · 1 reworded (you approved)". Tap to
  see the entries.

**Files:**

| File | Change |
|---|---|
| `skills_library_view.dart` | an Outreach tile, shown when `outreach/cards.json` exists |
| new `outreach_cards_deck.dart` | the two panes above, reusing the deck's splitter and colors |
| new `outreach_decisions_panel.dart` | inbox items, choice chips, note field |
| new `outreach_skill_repository.dart` | reads `cards.json`, `inbox.json` and `changelog.json`; writes `decisions.json` atomically |

**Status (2026-10-02): built, uncommitted.** The app side is in the files above plus
`outreach_skill_controller.dart`, `outreach_card_groups.dart` and `skill_split_pane.dart`; the
factory side is `factory/appio.py` (reads `decisions.json`; the later `at` wins over the page's db)
and `export_app.py`. The four checks below passed in a scratch copy of the factory and repo. The
owner hasn't tried it in the app yet.

**Done when:**
- Switching a rule off in the app drops it from the next export. The bench prompt for an affected
  case changes, and no other prompt does.
- Choosing X3 in the app turns the call rules on or off at the next export.
- "Add my rule" appears as a `yours` rule on the card after export.
- The right pane's prompt matches `bench.py --assemble` for the same knobs.

## Slice 3: test drafts, verdicts and examples in the Email Critique Library

The library already holds "an email + an expert verdict on it", with creator and brand tabs and a
stage tag. Test drafts and your verdicts become one more kind of record there. The library's own
notes say this corpus is what the drafting skills get sharpened against. These records are that
loop, made concrete.

- **"Test drafts" filter.** It shows records imported from `outreach/bench/latest.json`:
  - the draft (subject and body);
  - its knob values, as tags;
  - the lint flags and the judge's roast, as the critique;
  - the repeat hits.

  Unreviewed drafts are marked until you rate them.
- **Verdict on every draft record: Good / Bad + why.** That needs one new column (append-only
  migration on `email_library.db`).
  - **Good** drafts become goldens: later card versions must still pass them.
  - **Bad** drafts plus your "why" become regression cases.
- **"Rate this draft" in the draft dialog's Result step.** Two buttons. They save the real draft,
  its knobs and your verdict as a library record. Your best real emails become your own examples
  this way, without keeping files by hand.
- **"My example".** Your own emails (`my-emails/` today) become library records with that tag.

**Files:**

| File | Change |
|---|---|
| `email_record.dart` + library store | `verdict`, `verdictNote`, `source` (`video` / `test-draft` / `app-draft` / `mine`), `knobs` |
| `email_library_screen.dart` | the "Test drafts" filter, verdict chips, import of `bench/latest.json` |
| `gemini_draft_dialog.dart` | Rate this draft (Result step) |
| `pipeline/tools/email_library.py` | `--verdicts` output for the factory: goldens and regression cases |

**Status (2026-10-02): built, uncommitted.**

| Where | What changed |
|---|---|
| Library schema | Migration v6 adds `verdict`, `verdict_note`, `verdict_at`, `source`, `source_ref`, `knobs` and `facts`, exactly the columns `email_library.py` reads |
| Library page | Opening it imports `bench/latest.json`. A draft already imported is skipped, so its verdict survives a re-import. Stage tags come from the stage knob |
| Library page | A source filter (All · From videos · Test drafts · My drafts · My examples) and Good / Bad on draft cards. Bad asks why |
| Record editor | The verdict and its why on drafts; a "My example" switch on every other record |
| Draft dialog | "Rate this draft" sits at the bottom of the Result step. It saves email 1 with its knobs and its facts (the brief, plus needs under their labels), and rating it again updates the same record |
| Factory side | `--verdicts` also returns `examples` (records marked as yours). The bench's B variant adds up to two of them for the case's audience. The goldens (variant A) are unchanged |

Checked end to end: the app's own repository wrote a real library file, then `email_library.py --verdicts`
and `bench.py` read it back as a golden (re-linted clean), a regression case (with its knobs, facts and
reason) and an example.

**Done when:**
- A bench run shows up in the library.
- A verdict set in the app is read back by the factory and becomes a golden or a regression case on
  the next bench run.
- "Rate this draft" saves a record with the knobs it was drafted with.

---

## Skill regeneration (D15 + D-skillgate)

> **Amended 2026-10-01 (D34).** The outreach skill is now built from the skill factory's cards
> (section above), not proposed as per-section diffs against `email drafter skill.md`. That file is
> not a source and not a base (S1). The heading-lock rule (D31) below still applies to any
> prose skill that stays a Markdown file. The "no new Dart" stance is replaced by D35 for the
> drafting step.

The `gemini skills/` files are the **output** of this system, not an input to it. They are not
indexed as a source.

```
python -m knowledge skill propose "email drafter skill.md"
```

Reads the live skill's section tree with the **existing** `drafting_rules.parse_skill()`, finds
corpus support for each section, and writes a **proposed diff per section** with the sources
it drew on cited inline. Nothing touches the live 81 KB file until you accept a section.

**Headings are locked (D31).** The model proposes **body text for a section ID**, never a
heading. Code writes the heading back unchanged. This matters because `email drafter
rules.json` points at sections by ID. `parse_skill()` does not crash on a renamed heading. It
widens the unresolved ref to the whole Part or the whole skill, so the failure is
**silent**. Heading edits through the app's Skills page have already unlinked refs once, and
the skill's opening instructions dropped out of every Gemini draft (fixed in `ffc311e`). So a
proposal that would add, remove or rename a section is a separate, explicit proposal type,
shown as such. It is never folded into a body edit. The skill stays prose. Converting it to a
JSON rule registry was considered and rejected, because it loses the nuance and conflicts with
the Skills page that edits the Markdown.

This deliberately changes nothing downstream: the app's Gemini drafting flow keeps reading
`data/gemini skills/*.md` exactly as it does today, and `drafting_rules.py` keeps assembling
them section by section. **The Flutter app gets no new code and no new dependency** — v1 job
(c) "draft outreach grounded in course doctrine" is delivered entirely through better skill
files. Writes use the existing atomic `.tmp-<micros>` + rename idiom, since Python may be
mid-prompt.

Only *action* tasks get skills (outreach drafting, email QA). Learning and reference need none
— agents and NotebookLM read the corpus directly.

### Example sets (`examples.py`, Phase 9)

Rules ("don't sound desperate") steer a model less than real before/after examples do. There
are **88 roast calls**. A sampled one (Sept 10, Ammar) shows what they contain: the student's
original email *is* read aloud, but it is mixed in with banter. The coach's critique is
verbal. The improved email is rarely dictated in full. So:

- From roast calls, extract **original snippet + critique + the rule it illustrates**, each
  with `document_id` + `at_marker`. Any rewritten email is **written by the model, not
  quoted**, and is stored and shown with `derived: true`. It never passes as something a coach
  said.
- For clean "good email" examples, the PDFs (Cold Email Sauce, the checklist, *The Cold Email
  Blueprint*) hold actual templates. Prefer them over reconstructions.
- **Measured 2026-10-01: PDF examples, inconclusive.** In bench run 1, the Blueprint's two
  examples **lowered** the judge average (7.0 against 7.6 cards-only) and pulled drafts toward a
  banned "Noticed…" opener. After the CTA and opener fixes, they **raised** it (9.25 against 8.2 in
  run 2, 9.25 against 7.6 in run 3). With 5 cases and one judge pass each, that is noise-level
  evidence. Examples stay "shape and length, never wording", per knob combination, and only
  where a proper test (E1 below) shows they help. The owner's own emails join them (G3).

#### Experiment E1: the roast calls as a source of example emails (owner's idea, 2026-10-01)

**Why it could be big.** The roast-my-email calls are the course's largest store of real emails
with an expert verdict. The coach reads each submitted email aloud and comments as he goes.
Measured locally across the roast bundles:
- **135 calls** contain coach praise lines ("this email is way better", "10 out of 10", "send
  it"): 364 such lines;
- the coach discusses a subject line 257 times;
- he often dictates a better line ("this is CTA, this is how we do it").

So "no complete email in the transcripts" was the wrong conclusion. No email appears *as a clean
block*, but most are there, interleaved with commentary. They fit exactly what the Email Critique
Library already stores: an email, plus what an expert said about it.

**What to extract, per email read aloud:**

| Field | Content |
|---|---|
| `email` | the email as read, with the coach's comments removed. Only words that were said; gaps are marked `[…]`, never filled in |
| `audience`, `stage`, knob values | creator or brand, first email or follow-up, what the sender had (nothing / roster / brand) |
| `verdict` | `praised` / `roasted` / `mixed`, with the coach's verdict line quoted |
| `critique` | the coach's points, each quoted with its `@mm:ss` |
| `rewrites` | lines the coach dictated as better, quoted, as before → after pairs |
| provenance | call, date, coach, the `@mm:ss` range |

**How to test it (sandbox first, before any of it enters the app):**
1. **Extract** from 10 roast calls: 5 creator and 5 brand, spread over 2025 and 2026. Send the
   raw text to Gemini with the §4.2 style of prompt from `skill_factory_instructions.md` (raw
   text, not the notebook).
2. **Verify** each extracted email with `kb.locate()`, sentence by sentence. Keep an email only
   if at least 90% of its sentences match the call (exact or close) and every critique and rewrite
   quote matches. Measure:
   - verified emails per call;
   - % kept;
   - the praised / roasted / mixed split.
3. **Fidelity check by the owner.** 10 extracted emails, shown next to the call's transcript
   excerpt. Are they faithful, with nothing invented and nothing important dropped?
4. **Bench, four variants on the same cases.** Use **10 cases or more** (5 is too noisy), and
   run the judge **twice** per draft:
   - **A**: cards only;
   - **B**: cards + the PDF examples;
   - **C**: cards + 2 *praised* roast-call emails that match the case's knobs (same audience,
     stage and "what I have"), framed as "shape, never wording";
   - **D**: cards + 2–3 coach *before → after* line pairs, chosen for the loaded cards (e.g. CTA
     pairs when the CTA card loads).
5. **Copy check.** No 6-word run shared between a draft and the examples it was shown. That
   enforces D16 (never a stamp) mechanically.

**Pass:**
- extraction yields 3 or more verified emails per call;
- the owner rates at least 8 of 10 faithful;
- C or D beats A by 0.5 or more on the judge average, with no new lint flags, repeats or copy
  hits.

**Then:**
- extraction runs over all roast calls;
- the results become Email Critique Library records (`source: roast-call`, slice 3);
- the drafter gets per-knob examples.

**If it fails:**
- the extracted critiques and rewrites still feed the factory as **evidence for rules**. A coach
  rewriting a CTA live is the strongest evidence a CTA rule can have.
- examples stay off.

**Guards:**
- An extracted email is the *student's* email, so it is never doctrine by itself. Only the coach's
  verdict and rewrites carry authority (P5 attribution applies to them).
- Nothing reconstructed is ever shown as something a coach said.
- Participant names and addresses inside read-aloud emails are stripped before anything leaves the
  machine (D33).
- Stored as Email Critique Library records (slice 3), with `source` set to `roast-call`, `pdf`
  or `mine`. They are derived data next to the verbatim corpus and never replace it (D9). The
  factory picks examples per knob combination from there. *(Amended 2026-10-01: this replaces the
  separate `examples` table and the `skill propose` route.)*

### Own outcomes as a corpus

Emails you sent that got a positive reply or a booked call are evidence the course can't give
you. Adding them is one `sources.json` entry (D12). Give them their own `source_type`
(`own_outcome`), because they are a small, survivor-biased sample, not doctrine, and D22 should
label them as such. If the app already records sent emails and their replies, read them from
there instead of exporting `.txt` files by hand. Your own recorded calls (e.g. the 1-on-1
meeting under `IMA course\`, which already has `.vtt` transcripts) plug in the same way, with
`source_type = 'own_call'` and kept under `_private/` until D5 says otherwise.

### Open decision — retrieval at draft time (D32)

D15/D23 route all doctrine to the app **offline, through skill files**. Skill files can carry
rules and a fixed set of examples. They **cannot** carry "what the coaches said about *this*
prospect's niche or *this* situation", which is the most direct reading of v1 job (c).

The alternative needs no Dart: the Python daemon already sits between the app and Gemini, so it
could call `search.py` for each draft and add the top few cited hits (plus matching
`examples`) to the prompt. The costs are a runtime dependency on `knowledge.db`, prompts that
change as the corpus changes, and a reversal of D15's "no runtime coupling".

**Not decided.** Phases 1–8 do not depend on it. Decide before Phase 9, once Phase 3 evals show
whether retrieval is good enough to put in front of every draft.

---

## Evaluation (`evals.py`)

```
python -m knowledge eval
```

Scores retrieval against `data/knowledge/evals.json` — 20–30 questions you'd actually ask,
each naming the lesson or call that should answer it. Reports recall@5 / recall@10 and which
questions regressed, so chunking and ranking changes are **measured, not vibed**. Precedent in
your repo: `data/gemini skills/Source knowledge/influencer-marketing/evals/evals.json`.

Seed it with the four questions already tested by hand; the weakest was *"my open rate is
terrible"*, which latched onto the literal word "terrible" and ranked the right hit only 5th —
a good first regression target.

**Expected answers are documents (or document + time range), never chunk IDs.** Chunk IDs
change every time the chunker is re-tuned, which is exactly when the eval needs to stay
stable. 778 hours of calls also repeat themselves, so several chunks can answer one question.
Scoring against one chunk would count right answers as misses.

To avoid tuning toward 20–30 questions, add a **secondary synthetic set** (`evals.synthetic.json`,
reported separately). Sample chunks and have a model write the question a student would ask,
**told to paraphrase and avoid the chunk's own words**. Questions copied from a chunk's
vocabulary flatter FTS5 and measure the wrong thing. The hand-written set stays the gate.

---

## Config files — `data/knowledge/`

| File | Purpose | Edited by |
|---|---|---|
| `sources.json` | watched roots: path, kind, sensitivity. **Adding a corpus is one entry, no code** (D12) | you |
| `call_map.json` | call → modules (+ primary)/coach/type, with provenance + confidence; `manual` never overwritten | you, after review |
| `themes.json` | theme → call-type/keyword rules for bundling | you |
| `evals.json` | the question set (the gate); `evals.synthetic.json` is the secondary set | you |
| `settings.json` | chunk targets, topic threshold, coach list (for `speaker_role`), `embeddings.enabled`, whisper model + lexicon, word caps | you |

`_private/` anywhere under a watched root is **never walked** (D11). The `sensitivity` columns
ship nullable and unused in v1 — adding a column later is cheap under append-only migrations,
but backfilling it across a grown corpus is not, which is the whole reason it goes in now.

---

## Design values inherited from the existing code (non-negotiable)

Lifted from `drafting_rules.py`, `schema.sql`, `ai_brief_builder.dart` and `pipeline/README.md`:

- **Absent fields are omitted, never `null`** — a `null` in a prompt becomes an invented fact.
- **Fail loud.** A missing skill file raises `SKILL_FILE_MISSING` rather than prompting without
  doctrine; retrieval that cannot resolve a source says so.
- **Widen, never narrow,** when a reference fails to resolve.
- **Nothing is more permissive by accident.**
- **Local-first**: write locally before anything goes anywhere; a run with no connection
  produces identical data.
- **Append-only migrations.** Never edit a shipped one.
- **Atomic writes** for anything another process may be reading.
- **Surface disagreement, never resolve it.** Retrieval labels every hit by `source_type` and
  the AI is instructed to present conflicts and attribute them, never to silently pick a side.

---

## Phases

| Phase | Ships | Why here |
|---|---|---|
| **1** | schema (incl. `parser_ver`, `speaker_role`, `header`), `sources.json`, page + transcript + PDF parsers, chunking, FTS5, `index` / `search` / `get` (`--context`, `--expand`) / `status` | the core. stdlib + pypdf only. Proven to work in 3.6 s |
| **2** | `export curriculum` + `export modules`, `classify.py` (per-chunk topics) + `call_map.json` review | highest value-per-line; makes the corpus usable by any agent immediately |
| **3** | `evals.json` + `eval` (+ synthetic secondary set), tune chunking against it | measure before adding machinery |
| **4** | Whisper backfill, 35.9 h, model `small`, lexicon-seeded | one overnight run; independent of everything else |
| **5** | `export bundles` (themes, emails stripped) | NotebookLM, once themes are informed by real usage |
| **6** | `embed.py` + RRF hybrid (opt-in) | only if Phase 3 shows FTS5 actually falling short |
| **7** | `mcp_server.py` | once CLI signatures have settled. Agents with a shell already use the CLI from Phase 1 |
| **8** | `skill propose` with per-section diffs, headings locked | needs Phases 1–3 to be trustworthy first |
| **9** | `examples.py`; decide D32 (retrieval at draft time) | needs Phase 8's proposal flow and Phase 3's evidence |

Phases 1–2 are the shippable slice: everything after is additive.

**Skill factory track (added 2026-10-01).** The factory runs on the NotebookLM export and a
verbatim lookup, both already working in the sandbox. So it does **not** wait for Phases 1–3. When
`knowledge.db` exists, `kb.locate()` switches to FTS5 `search`/`get` with the same contract.

| Step | Ships | Done when |
|---|---|---|
| **F1** | stable rule ids, `state.json`, run logs, changelog | the first Relearn has written `state.json` |
| **F2** | outreach cards settled: inbox empty, bench verdicts in, CTA and leak issues fixed | every standing case judged ≥ 8 and marked good by the owner |
| **F3** | Update mode (delta extraction, routing, gates) | one week of new calls added with no existing rule reworded |
| **F4** | Relearn mode (shadow build, floor check, per-card promotion) | a Relearn on an unchanged KB reproduces every live rule |
| **F5** | app, slices 1–3: knob panel + preview in the draft dialog; outreach cards, inbox and my rules in the Skills page; test drafts and verdicts in the Email Critique Library | each slice's "Done when"; then the factory page retires |
| **F6** | other workflows (replies, negotiation, brand outreach depth), same machinery | per workflow: cards + inbox + bench |
| **E1** | experiment: roast calls as example emails (under "Example sets"). Runs in the sandbox **in parallel with slice 1**, because examples are off by default and nothing in slice 1 waits on it | its pass criteria; then records flow into the library in slice 3 |

---

## Appendix — going R2 + local later (D1)

Nothing in the design blocks this; here is the exact delta, following `pipeline/gratovo/sync.py`:

1. **Objects.** `knowledge/<document_id>.json.zst` — one zstd object per document, with
   `content-hash` as object metadata so a `HEAD` before `PUT` skips unchanged uploads.
2. **Catalog.** `catalog-knowledge/<worker>/<stamp>-<seq>.jsonl.zst`, append-only, each machine
   writing only under its own prefix so nothing needs a lock. Record types: `document`,
   `blob`, `mapping` (a corrected `call_map.json` row), `removed`.
3. **Flags.** Add `announced_at` to `documents`, mirroring `channels.announced_at`. A failed
   write leaves the flag alone and the next share says it again.
4. **Pull.** `_applied_segments` by segment key, then download objects whose
   `blob_version` > `blob_applied_version`. Reuse the pattern verbatim.
5. **Local-only wins.** `call_map.json` rows with `source: "manual"` are human-typed — they
   belong in the catalog as `mapping` records, never clobbered by an index run.
6. **Gate it.** `sync.enabled: false` in config by default, so the private course corpus
   (D5) can never leave the machine by accident. Flipping it is a deliberate act.
7. **`reset_manifest.json`.** Any breaking change to `knowledge.db` adds an action naming
   `database/knowledge.db`, per the rule in `pipeline/README.md`.

Not built now. Documented so it stays a half-day's work rather than a redesign.

---

## Verification

**Phase 1**
```
python -m knowledge index --corpus course          # expect 328 + 575 + 3 docs, ~45k chunks
python -m knowledge status                          # counts, freshness, 0 parse failures
python -m knowledge index --corpus course           # second run: no-op, under a second
python -m knowledge search "how much should I charge a brand"
```
Pass: the March 5th negotiations call and `2.4. Understanding Influencer Pricing` both rank
top-5 (both did in the throwaway test). Every hit carries `source_type`, `url`, `module`,
`occurred_on` and `speaker_role`.

```
# bump PARSER_VERSION, then:
python -m knowledge index --corpus course
```
Pass: every document re-parses without `--force`, and a second run is a no-op again.
`search "negotiation"` returns calls whose *title* says negotiation, through `header`.

```
python -m knowledge get <a call document_id> | wc -c
```
Pass: byte-identical to that call's `transcript` field in `transcripts.json` — **proves D9**.

**Phase 2**
```
python -m knowledge export curriculum
```
Pass: ~87,747 words, no call content, every lesson present, module order preserved.
```
python -m knowledge export modules
```
Pass: each file is its module's text plus its mapped calls; splits respect the word cap;
`call_map.json` has ≤140 low-confidence rows to review. Spot-check five bare-date Q&A calls:
each lists more than one module, and `search "..." --module "module 3 brands"` reaches the brands
discussion inside at least one of them.

**Phase 3** — `python -m knowledge eval` reports recall@5 ≥ 0.8 on the question set, and the
*"my open rate is terrible"* case now ranks its correct hit in the top 3.

**Phase 4** — benchmark one file first (`transcribe --only "1.1. Welcome!.mp4"`), confirm
≈4× realtime, spot-check the transcript against the audio **and the lexicon terms in
particular**, then run the full set. Pass: one sidecar per in-scope video, no file left
partial, `index` picks them up as `source_type='lesson_video'`.

**Phase 5** — no bundle contains an `@`-address in a speaker label.

**Phase 8** — `skill propose` produces a diff that does **not** modify the live file; applying
one section leaves `drafting_rules.parse_skill()` still resolving every ref in
`email drafter rules.json` (its existing tests are the gate), and the app drafts normally. A
body proposal leaves the section's heading line byte-identical. A test feeds a model output
with a renamed heading and checks that it is rejected, not applied.

**Regression guard throughout:** `python -m pytest pipeline/tests/` and
`flutter test` must stay green. Phases 1–7 touch no Dart at all.

---

## Decisions register

| # | Decision |
|---|---|
| D1 | Local-only storage; R2 is the documented appendix |
| D2/D17 | Hybrid FTS5 + embeddings, with **FTS5-only as a first-class mode** for weak machines |
| D3 | Consumers: existing Gemini bridge + tool-using agents (Claude Code) + NotebookLM |
| D4 | Single user (owner) |
| D5 | Course material private now, team later; sync gated off by default |
| D6 | Ingest clean `text`, drop `html` |
| D7 | Local Whisper, model `small`, ~9 h for 35.9 h of video, resumable |
| D8 | New module under `gratovo_code/pipeline/`, built for extra corpora from day one |
| D9 | **No information loss.** Verbatim bodies kept; never summarize at ingest |
| D10 | PDFs via text layer now; images recorded not indexed; vision captions deferred |
| D11 | `_private/` excluded now; `sensitivity` columns ship nullable for later |
| D12 | Watched folders in `sources.json`; new corpus = one config entry |
| D13 | Chunk hits that expand to the full source document |
| D14 | Document-level citation (timestamps ride along free, already in the text) |
| D15 | Skills are **authored from** the corpus, one-way, offline; no runtime coupling |
| D16 | v1 jobs: answer with citations · roast/QA an email · draft outreach grounded in doctrine |
| D18 | Index everything, **flag** duplicates; collapse in results, never drop |
| D19 | v1 scope: course pages + 575 transcripts + 3 PDFs + lesson-video transcripts. Audiobook and Success Stories out. `gemini skills/` is **output, not source** |
| D20 | Skill changes arrive as a **per-section diff proposal**; live files untouched until accepted |
| D21 | Calls mapped to modules by title parse + **per-chunk** content scoring (optional LLM pass on low-confidence rows), many modules per call, into an editable review file; `manual` never overwritten |
| D22 | **Surface disagreement, never resolve it** — every hit labelled by `source_type` |
| D23 | App gets doctrine **via regenerated skill files only**; no new Dart code in v1. *Amended by D35* |
| D24 | Evaluation by a question set with expected sources |
| D25 | CLI first, MCP second, over identical functions |
| D26 | Arabic is incidental (31 of 575 calls); `unicode61` covers it, no special handling |
| D27 | `PARSER_VERSION` per document, like `CHUNKER_VERSION`; skip-unchanged checks file hash **and** both versions |
| D28 | Hybrid ranking uses Reciprocal Rank Fusion; no `source_type` boosting |
| D29 | Call turns labelled `speaker_role` (coach/student) from a configured coach list. *A first guess; evidence uses D37* |
| D30 | Chunk metadata lives in an indexed `header` column, never inside verbatim `text` |
| D31 | Skill proposals edit section bodies only; headings locked; structural changes are a separate proposal type |
| D32 | **Open:** whether drafting retrieves from the corpus at draft time through the daemon (reverses D15's "no runtime coupling"). Decide before Phase 9 |
| D33 | Participant email addresses stripped from anything that leaves the machine (NotebookLM bundles) |
| D34 | **Skills are built by the skill factory: knobs → cards → rules with verified evidence.** Supersedes `skill propose` against the old drafter skill (Phase 8) for outreach |
| D35 | **Amends D23:** the factory page's working parts move into the app, each to its screen: knobs and preview in the draft dialog; cards, inbox, my rules and changelog in the Skills page; test drafts, verdicts and my examples in the Email Critique Library. The daemon assembles prompts from loaded cards |
| D36 | Gemini/NotebookLM answers are leads, never evidence. A quote counts only once it is found verbatim (exact or close) in the raw KB |
| D37 | Who said a quote is decided by the transcript plus an automated attribution pass, never by Gemini's citation or a name list alone |
| D38 | `email drafter skill.md` is not a source, not a base, not a reference (owner, S1). Generated emails are never templated and never use banned words (owner, D16) |
| D39 | Factory rules have a `use` scope. Only `draft` rules reach the writer. Rule text is an instruction, never a line to paste |
| D40 | Two update modes: **Update** (delta only, never rewords) and **Relearn** (shadow build, live cards as a floor, per-card promotion), as specified in `skill_factory_instructions.md` |
| D41 | The owner's decisions (`outreach/decisions.json`) and verdicts (`email_library.db`) are written by the app, keyed by stable ids. The factory reads them and never changes them. Until slices 2–3 land, they live in the factory page's db |

### Considered and not adopted

Recorded so they aren't re-proposed without new evidence:

- **LLM-written context added to every chunk** (~45k calls). The metadata `header` and
  `get --context` give most of the benefit for free. Revisit only if Phase 3 evals point at
  missing context.
- **Boosting the curriculum in ranking.** Contradicts D22, and the curriculum is loaded whole
  anyway. See D28.
- **Prompt caching for the curriculum in drafts.** Drafts never carry the curriculum (D23), and
  the Gemini path is a browser with no caching API.
- **Compiling skills from a JSON rule registry.** Loses the prose and conflicts with the Skills
  page. D31 handles the real risk.
- **whisper.cpp/Vulkan for speed.** The run is a single overnight job. Only worth it to run a
  larger model, if `small` fails the lexicon spot-check.
- **Replacing `pypdf` up front.** There are three PDFs. Look at the output first.
- **Moving MCP earlier.** Claude Code already reaches the CLI through its shell from Phase 1.
