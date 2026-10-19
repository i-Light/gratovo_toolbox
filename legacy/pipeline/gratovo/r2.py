"""The Cloudflare R2 client — the pipeline's only remote.

Everything the pipeline scrapes is shared through one private R2 bucket, via
its S3-compatible API:

  * `channels/<channel_id>.json.zst`   one object per channel: its details and
                                        its videos, written once the channel's
                                        video pass has finished (see sync.py)
  * `catalog/<worker>/<stamp>-<seq>.jsonl.zst`
                                        an append-only log of what each machine
                                        found, which keyword found it, and what
                                        it archived. Every machine writes only
                                        under its own prefix, so no two machines
                                        ever touch the same key and nothing
                                        needs a lock.

Why R2 and not the shared Postgres: the scraped data is bulk — millions of
rows over time — and every row of it in a database costs storage, egress on
every pull and a realtime message on every change. R2 charges nothing for
egress, an object is a few KB, and an object store is exactly what
"write once, read by everyone who is missing it" wants.

Deliberately thin. `boto3` and `zstandard` are the two dependencies; the
functions below are the handful of calls the sync layer makes, shaped so a
test can swap in an in-memory fake (`sync.py` never imports boto3 itself).
Every method raises `R2Error` on failure, and `connect()` returns None rather
than raising when the bucket is not configured or unreachable — a search must
run, and save locally, whatever the state of the network.
"""

from __future__ import annotations


class R2Error(RuntimeError):
    pass


# --------------------------------------------------------------------------
# Compression
# --------------------------------------------------------------------------
# zstd at level 3: a channel object (one channel, ~15 videos with
# descriptions) compresses roughly 5:1, and the cost of compressing it is a
# few hundred microseconds. Imported lazily so `search.py --status` and the
# tests that never touch R2 do not need the package installed.

def compress(data: bytes) -> bytes:
    import zstandard
    return zstandard.ZstdCompressor(level=3).compress(data)


def decompress(data: bytes) -> bytes:
    import zstandard
    # A streaming decompressor rather than `.decompress(data)`: the one-shot
    # form needs the frame to declare its content size, which a compressor
    # that was fed a stream does not always write.
    with zstandard.ZstdDecompressor().stream_reader(data) as reader:
        return reader.read()


# --------------------------------------------------------------------------
# The client
# --------------------------------------------------------------------------

class R2Client:
    """One bucket. Metadata is a plain {str: str} dict on every object; S3
    stores it under `x-amz-meta-*`, and boto3 hands it back unprefixed."""

    def __init__(self, account_id: str, access_key_id: str,
                 secret_access_key: str, bucket: str):
        if not (account_id and access_key_id and secret_access_key and bucket):
            raise R2Error("R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY "
                          "and R2_BUCKET are all required.")
        import boto3
        from botocore.config import Config as BotoConfig
        self.bucket = bucket
        self._s3 = boto3.client(
            "s3",
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            # R2 is region-less; "auto" is what Cloudflare documents.
            region_name="auto",
            config=BotoConfig(
                retries={"max_attempts": 4, "mode": "standard"},
                connect_timeout=15, read_timeout=60,
            ),
        )

    def _wrap(self, what, call):
        try:
            return call()
        except Exception as exc:  # noqa: BLE001 — botocore raises many types
            raise R2Error(f"{what}: {exc}") from exc

    def ping(self):
        """Cheapest proof the credentials and bucket are both good."""
        self._wrap("list bucket", lambda: self._s3.list_objects_v2(
            Bucket=self.bucket, MaxKeys=1))

    def head(self, key: str):
        """The object's metadata dict, or None if there is no such object."""
        from botocore.exceptions import ClientError
        try:
            response = self._s3.head_object(Bucket=self.bucket, Key=key)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in ("404", "NoSuchKey", "NotFound"):
                return None
            raise R2Error(f"head {key}: {exc}") from exc
        except Exception as exc:  # noqa: BLE001
            raise R2Error(f"head {key}: {exc}") from exc
        return dict(response.get("Metadata") or {})

    def put(self, key: str, data: bytes, metadata: dict | None = None,
            content_type: str = "application/octet-stream"):
        self._wrap(f"put {key}", lambda: self._s3.put_object(
            Bucket=self.bucket, Key=key, Body=data,
            ContentType=content_type,
            Metadata={k: str(v) for k, v in (metadata or {}).items() if v is not None},
        ))

    def get(self, key: str):
        """(bytes, metadata) or None if there is no such object."""
        from botocore.exceptions import ClientError
        try:
            response = self._s3.get_object(Bucket=self.bucket, Key=key)
            body = response["Body"].read()
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in ("404", "NoSuchKey", "NotFound"):
                return None
            raise R2Error(f"get {key}: {exc}") from exc
        except Exception as exc:  # noqa: BLE001
            raise R2Error(f"get {key}: {exc}") from exc
        return body, dict(response.get("Metadata") or {})

    def delete(self, key: str):
        """Idempotent: deleting an object that is not there is not an error."""
        self._wrap(f"delete {key}", lambda: self._s3.delete_object(
            Bucket=self.bucket, Key=key))

    def delete_many(self, keys):
        """Deletes up to thousands of objects, 1,000 per request (the S3
        limit). Idempotent like `delete`. Returns how many were named."""
        keys = list(keys)
        for start in range(0, len(keys), 1000):
            chunk = keys[start:start + 1000]
            self._wrap(f"delete {len(chunk)} objects", lambda chunk=chunk: self._s3.delete_objects(
                Bucket=self.bucket,
                Delete={"Objects": [{"Key": k} for k in chunk], "Quiet": True}))
        return len(keys)

    def list(self, prefix: str):
        """Every key under [prefix], in the order S3 lists them (lexical).
        Paginated — a catalog of thousands of segments is one call per 1,000."""
        keys = []

        def page():
            paginator = self._s3.get_paginator("list_objects_v2")
            for response in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
                for item in response.get("Contents") or []:
                    keys.append(item["Key"])
        self._wrap(f"list {prefix}", page)
        return keys


def connect(config):
    """A client, or None when R2 is not configured or unreachable.

    Returning None rather than raising is deliberate: a search must still run
    and still save its results locally when the bucket is unreachable. The
    caller prints what happened so it is never a silent degradation.
    """
    if not config.r2_configured:
        return None
    try:
        client = R2Client(config.r2_account_id, config.r2_access_key_id,
                          config.r2_secret_access_key, config.r2_bucket)
        client.ping()
        return client
    except (R2Error, ImportError) as exc:
        print(f"[sync] R2 unavailable ({exc}) — continuing local-only.", flush=True)
        return None
