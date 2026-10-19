import html
import re
import subprocess
import sys
from pathlib import Path

import shutil
import sysconfig

def ensure_deno():
    deno_path = shutil.which("deno")
    scripts_dir = sysconfig.get_path("scripts")

    if not deno_path:
        print("=" * 70)
        print("ERROR: 'deno' executable not found in your system PATH.")
        print("yt-dlp requires Deno to solve YouTube JavaScript challenges.\n")
        print("Setup Instructions:")
        print("1. Download the latest Windows release (deno-x86_64-pc-windows-msvc.zip):")
        print("   https://github.com/denoland/deno/releases\n")
        print("2. Extract 'deno.exe' and move it directly into your Python Scripts folder:")
        print(f"   {scripts_dir}\n")
        print("   (because This folder is already registered in your PATH).")
        print("=" * 70)
        sys.exit(1)

    # Check for / apply updates to Deno
    try:
        print("Checking for Deno updates...")
        subprocess.run(["deno", "upgrade"], check=False)
    except Exception as e:
        print(f"Notice: Could not check Deno update status ({e}). Continuing...")


def clean_vtt_file(vtt_path: Path) -> Path:
    """Strips timestamps, formatting tags, and progressive caption rolls."""
    txt_path = vtt_path.with_suffix(".txt")

    with open(vtt_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    cleaned_tokens = []

    for raw_line in lines:
        line = raw_line.strip()

        # Skip headers, metadata, and timestamp cue lines
        if not line or line.startswith(("WEBVTT", "Kind:", "Language:", "NOTE")) or "-->" in line:
            continue

        # Strip inline styling and timing tags (<c>, <00:00:00.000>)
        line = re.sub(r"<[^>]+>", "", line)
        line = html.unescape(line).strip()

        if not line:
            continue

        # Deduplicate YouTube's progressive caption rolls
        if cleaned_tokens and line.startswith(cleaned_tokens[-1]):
            cleaned_tokens[-1] = line
        elif cleaned_tokens and cleaned_tokens[-1].startswith(line):
            continue
        elif not cleaned_tokens or line != cleaned_tokens[-1]:
            cleaned_tokens.append(line)

    # Merge into a single continuous text body
    full_text = " ".join(cleaned_tokens)
    full_text = re.sub(r"\s+", " ", full_text).strip()

    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(full_text + "\n")

    return txt_path


def download_and_clean(
    url: str,
    lang: str = "en",
    use_firefox_cookies: bool = True,
    keep_vtt: bool = False,
) -> Path:
    ensure_deno()
    print(f"Fetching subtitles for: {url}")

    output_template = "%(title)s [%(id)s].%(ext)s"

    # Working command flags matching your successful terminal run
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "--extractor-args", "youtube:player_client=-tv_downgraded,web_embedded",
        "--remote-components", "ejs:github",
        "--write-auto-sub",
        "--skip-download",
        "--sub-lang", lang,
        "--output", output_template,
    ]

    if use_firefox_cookies:
        cmd.extend(["--cookies-from-browser", "firefox"])

    cmd.append(url)

    # Execute yt-dlp
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if result.returncode != 0:
        print("yt-dlp error:\n", result.stderr)
        sys.exit(1)

    # Locate the generated .vtt file
    id_match = re.search(r"(?:v=|\/|be\/)([0-9A-Za-z_-]{11})", url)
    if id_match:
        video_id = id_match.group(1)
        vtt_matches = list(Path(".").glob(f"*{video_id}*.vtt"))
    else:
        vtt_matches = sorted(Path(".").glob("*.vtt"), key=lambda p: p.stat().st_mtime, reverse=True)

    if not vtt_matches:
        print("Error: Subtitle file was not found.")
        sys.exit(1)

    vtt_path = vtt_matches[0]
    print(f"Downloaded subtitle: {vtt_path.name}")

    # Clean and write out .txt
    txt_path = clean_vtt_file(vtt_path)

    # Delete the temporary .vtt file
    if not keep_vtt:
        vtt_path.unlink()

    return txt_path


if __name__ == "__main__":
    if len(sys.argv) > 1:
        video_url = sys.argv[1]
    else:
        video_url = input("Enter YouTube URL: ").strip()

    if not video_url:
        print("No URL provided. Exiting.")
        sys.exit(1)

    output = download_and_clean(video_url)
    print(f"Transcript saved to: {output.resolve()}")