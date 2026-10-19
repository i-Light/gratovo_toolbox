@echo off
rem Opens the video quote review page (see pipeline/comms/quote_review.py). Close this window to stop it.
cd /d "%~dp0pipeline"
python -m comms.quote_review
pause
