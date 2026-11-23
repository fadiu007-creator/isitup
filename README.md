# Uptime Checker

A small web app that tells you whether websites are UP or DOWN. Standard library only, no install step.

## Run

    python3 -m uptime_checker --port 8000

Then open http://127.0.0.1:8000 in your browser.

## Test

    python3 -m unittest discover -s tests -v

## API

POST /api/check with JSON:

    {"urls": ["https://example.com", "https://httpbin.org/status/200"]}

Response:

    {"results": [{"url": "...", "up": true, "status_code": 200,
                  "response_time_ms": 123.4, "error": null}]}

Rules: http/https only, 1 to 20 URLs, each check times out after 5 seconds.
A site counts as UP when it responds with a status below 400.

GET /api/health returns {"status": "ok"}.

## Layout

    uptime_checker/checker.py   URL validation and site checks
    uptime_checker/server.py    HTTP server and API routes
    uptime_checker/__main__.py  entry point
    static/                     frontend (HTML, JS, CSS)
    tests/test_checker.py       unit and API tests
