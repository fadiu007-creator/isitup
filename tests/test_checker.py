import json
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from uptime_checker.checker import (
    URLValidationError,
    check_url,
    validate_url,
    validate_urls,
)
from uptime_checker.server import make_server


class _StubHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        code = 500 if self.path == "/fail" else 200
        self.send_response(code)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *args):
        pass


class ValidationTests(unittest.TestCase):
    def test_accepts_http_and_https(self):
        self.assertEqual(validate_url(" https://example.com "), "https://example.com")
        self.assertEqual(validate_url("http://localhost:8000/x"), "http://localhost:8000/x")

    def test_rejects_empty(self):
        with self.assertRaises(URLValidationError):
            validate_url("   ")

    def test_rejects_bad_scheme(self):
        for bad in ("ftp://x.com", "example.com", "javascript:alert(1)"):
            with self.subTest(bad=bad), self.assertRaises(URLValidationError):
                validate_url(bad)

    def test_rejects_missing_host(self):
        with self.assertRaises(URLValidationError):
            validate_url("http://")

    def test_rejects_bad_port(self):
        with self.assertRaises(URLValidationError):
            validate_url("http://example.com:99999x")

    def test_rejects_non_string(self):
        with self.assertRaises(URLValidationError):
            validate_url(123)

    def test_validate_urls_list_rules(self):
        with self.assertRaises(URLValidationError):
            validate_urls([])
        with self.assertRaises(URLValidationError):
            validate_urls("https://example.com")
        with self.assertRaises(URLValidationError):
            validate_urls(["https://a.com"] * 21)
        self.assertEqual(validate_urls(["https://a.com"]), ["https://a.com"])


class CheckerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stub = ThreadingHTTPServer(("127.0.0.1", 0), _StubHandler)
        cls.stub_port = cls.stub.server_address[1]
        threading.Thread(target=cls.stub.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.stub.shutdown()
        cls.stub.server_close()

    def test_up_site(self):
        r = check_url(f"http://127.0.0.1:{self.stub_port}/")
        self.assertTrue(r.up)
        self.assertEqual(r.status_code, 200)
        self.assertIsNotNone(r.response_time_ms)
        self.assertIsNone(r.error)

    def test_server_error_is_down(self):
        r = check_url(f"http://127.0.0.1:{self.stub_port}/fail")
        self.assertFalse(r.up)
        self.assertEqual(r.status_code, 500)
        self.assertEqual(r.error, "HTTP 500")

    def test_unreachable_is_down_without_raising(self):
        # Port 1 on loopback is essentially always closed.
        r = check_url("http://127.0.0.1:1/", timeout=2)
        self.assertFalse(r.up)
        self.assertIsNone(r.status_code)
        self.assertIsNotNone(r.error)


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = make_server("127.0.0.1", 0)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.port}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def _post(self, body: bytes, content_type="application/json"):
        req = urllib.request.Request(
            self.base + "/api/check", data=body, method="POST",
            headers={"Content-Type": content_type},
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read())

    def test_index_served(self):
        with urllib.request.urlopen(self.base + "/", timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            self.assertIn(b"Uptime Checker", resp.read())

    def test_health(self):
        with urllib.request.urlopen(self.base + "/api/health", timeout=5) as resp:
            self.assertEqual(json.loads(resp.read()), {"status": "ok"})

    def test_check_returns_up_and_down(self):
        body = json.dumps({"urls": [
            "http://127.0.0.1:1/",
        ]}).encode()
        status, data = self._post(body)
        self.assertEqual(status, 200)
        self.assertEqual(len(data["results"]), 1)
        self.assertFalse(data["results"][0]["up"])

    def test_bad_json(self):
        status, data = self._post(b"{not json")
        self.assertEqual(status, 400)
        self.assertIn("error", data)

    def test_bad_url_in_body(self):
        status, data = self._post(json.dumps({"urls": ["ftp://x"]}).encode())
        self.assertEqual(status, 400)
        self.assertIn("http", data["error"])

    def test_missing_urls_key(self):
        status, _ = self._post(json.dumps({}).encode())
        self.assertEqual(status, 400)

    def test_empty_body(self):
        status, _ = self._post(b"")
        self.assertEqual(status, 400)


if __name__ == "__main__":
    unittest.main()
