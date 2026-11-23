"""Core logic: validate URLs and check whether a site is up."""

from __future__ import annotations

import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from typing import Optional

DEFAULT_TIMEOUT = 5.0
MAX_URLS = 20
MAX_WORKERS = 10
USER_AGENT = "uptime-checker/0.1"


class URLValidationError(ValueError):
    """Raised when a URL is empty, malformed, or uses an unsupported scheme."""


@dataclass
class CheckResult:
    url: str
    up: bool
    status_code: Optional[int]
    response_time_ms: Optional[float]
    error: Optional[str]

    def to_dict(self) -> dict:
        return asdict(self)


def validate_url(raw: str) -> str:
    """Return a normalized URL or raise URLValidationError."""
    if not isinstance(raw, str):
        raise URLValidationError("URL must be a string")
    url = raw.strip()
    if not url:
        raise URLValidationError("URL is empty")
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ("http", "https"):
        raise URLValidationError(f"URL must start with http:// or https://: {url}")
    if not parsed.hostname:
        raise URLValidationError(f"URL has no host: {url}")
    try:
        parsed.port  # raises ValueError for invalid ports
    except ValueError:
        raise URLValidationError(f"URL has an invalid port: {url}")
    return url


def validate_urls(raw_list) -> list[str]:
    """Validate a list of URLs, enforcing count limits."""
    if not isinstance(raw_list, list):
        raise URLValidationError("'urls' must be a list")
    if not raw_list:
        raise URLValidationError("'urls' must contain at least one URL")
    if len(raw_list) > MAX_URLS:
        raise URLValidationError(f"at most {MAX_URLS} URLs per request")
    return [validate_url(u) for u in raw_list]


def check_url(url: str, timeout: float = DEFAULT_TIMEOUT) -> CheckResult:
    """Perform a HEAD-then-GET style check. Never raises for network errors."""
    req = urllib.request.Request(url, method="GET", headers={"User-Agent": USER_AGENT})
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            elapsed = (time.perf_counter() - start) * 1000
            code = resp.status
            return CheckResult(url, code < 400, code, round(elapsed, 1), None)
    except urllib.error.HTTPError as exc:
        elapsed = (time.perf_counter() - start) * 1000
        return CheckResult(url, exc.code < 400, exc.code, round(elapsed, 1),
                           None if exc.code < 400 else f"HTTP {exc.code}")
    except urllib.error.URLError as exc:
        return CheckResult(url, False, None, None, f"unreachable: {exc.reason}")
    except TimeoutError:
        return CheckResult(url, False, None, None, "timed out")
    except OSError as exc:
        return CheckResult(url, False, None, None, f"connection error: {exc}")
    except Exception as exc:  # defensive: never let one bad site break the batch
        return CheckResult(url, False, None, None, f"unexpected error: {exc}")


def check_urls(urls: list[str], timeout: float = DEFAULT_TIMEOUT) -> list[CheckResult]:
    """Check URLs concurrently, preserving input order."""
    if not urls:
        return []
    with ThreadPoolExecutor(max_workers=min(len(urls), MAX_WORKERS)) as pool:
        return list(pool.map(lambda u: check_url(u, timeout=timeout), urls))
