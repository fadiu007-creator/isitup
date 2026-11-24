(function () {
  "use strict";

  const TIMEOUT_MS = 5000;
  const MAX_URLS = 20;

  const form = document.getElementById("check-form");
  const textarea = document.getElementById("urls");
  const submitBtn = document.getElementById("submit");
  const buttonLabel = submitBtn.querySelector("span");
  const message = document.getElementById("message");
  const output = document.getElementById("output");
  const summary = document.getElementById("summary");
  const tbody = document.querySelector("#results tbody");

  function showMessage(text, kind) {
    message.textContent = text;
    message.className = "banner " + (kind || "error");
    message.hidden = false;
  }

  function clearMessage() {
    message.textContent = "";
    message.hidden = true;
  }

  function parseUrls(raw) {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  // Accept URLs, protocol-relative addresses, or bare hosts. Bare hosts use
  // HTTPS by default. Keep this behavior aligned with checker.validate_url.
  function normalizeUrl(raw) {
    const value = raw.trim();
    if (!value || /[\u0000-\u001f]/.test(value)) return null;

    let candidate;
    if (value.startsWith("//")) {
      candidate = "https:" + value;
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
      candidate = value;
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      const authority = value.split(/[/?#]/, 1)[0];
      if (!/^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\]):[0-9]+$/i.test(authority)) return null;
      candidate = "https://" + value;
    } else {
      candidate = "https://" + value;
    }

    // Avoid URL() silently trimming or encoding whitespace that the API-side
    // validator rejects, so invalid input never enters the fallback checks.
    if (/\s/.test(candidate)) return null;
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch (e) {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    if (/^\d+(?:\.\d+){3}$/.test(parsed.hostname) && parsed.hostname.split(".").some((part) => Number(part) > 255)) return null;
    if (/^\d+(?:\.\d+){3}$/.test(parsed.hostname)) {
      // Valid IPv4 literal.
    } else if (parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")) {
      const ipv6 = parsed.hostname.slice(1, -1);
      if (!/^[0-9a-f:.]+$/i.test(ipv6) || !ipv6.includes(":")) return null;
    } else if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(parsed.hostname)) {
      const labels = parsed.hostname.split(".");
      if (labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) return null;
    }
    if (parsed.port === "0") return null;
    return parsed.href;
  }

  // ---- Check via the Python API (local `python3 -m uptime_checker`) ----
  async function checkViaApi(urls) {
    const resp = await fetch("api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: urls }),
    });
    // GitHub Pages has no /api/check endpoint and returns a static 404; that's
    // the expected signal to use browser checks. Preserve other HTTP API errors.
    if (!resp.ok && resp.status !== 404) {
      const error = new Error("API returned HTTP " + resp.status);
      error.apiResponse = true;
      throw error;
    }
    if (resp.status === 404) throw new Error("no API at this address");
    const isJson = (resp.headers.get("content-type") || "").toLowerCase().includes("application/json");
    if (!isJson) throw new Error("no API at this address");
    let data;
    try {
      data = await resp.json();
    } catch (err) {
      throw new Error("API returned invalid JSON");
    }
    if (!data || !Array.isArray(data.results)) throw new Error("unexpected response");
    return data.results;
  }

  // ---- Check from the browser (works on GitHub Pages) ----
  // Tries a CORS request first to read the real HTTP status. A no-cors
  // fallback can produce an opaque response, but cannot distinguish HTTP
  // errors from success, so that result is explicitly UNKNOWN.
  async function fetchWithTimeout(url, mode, signal) {
    return fetch(url, {
      method: "GET",
      mode: mode,
      cache: "no-store",
      redirect: "follow",
      signal: signal,
    });
  }

  async function checkViaBrowser(url) {
    const start = performance.now();
    const elapsed = () => Math.round((performance.now() - start) * 10) / 10;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      try {
        const resp = await fetchWithTimeout(url, "cors", controller.signal);
        const code = resp.status;
        return {
          url: url,
          up: code < 400,
          status_code: code,
          response_time_ms: elapsed(),
          error: code < 400 ? null : "HTTP " + code,
        };
      } catch (corsErr) {
        if (corsErr.name === "AbortError") {
          return { url: url, up: false, status_code: null, response_time_ms: null, error: "timed out" };
        }
        // A no-cors response only establishes that a response arrived. It
        // cannot distinguish a successful page from an HTTP error.
        try {
          const resp = await fetchWithTimeout(url, "no-cors", controller.signal);
          if (resp.type !== "opaque") throw new Error("unreadable response");
          return {
            url: url,
            up: null,
            status_code: null,
            response_time_ms: elapsed(),
            error: "response received; HTTP status hidden by the site's CORS policy",
          };
        } catch (err) {
          const timedOut = err.name === "AbortError";
          return {
            url: url,
            up: false,
            status_code: null,
            response_time_ms: null,
            error: timedOut ? "timed out" : "unreachable (DNS, TLS, or connection failed)",
          };
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async function checkAllViaBrowser(urls) {
    return Promise.all(urls.map(checkViaBrowser));
  }

  // ---- Rendering ----
  function cell(text, className) {
    const td = document.createElement("td");
    td.textContent = text;
    if (className) td.className = className;
    return td;
  }

  function statusCell(up) {
    const td = document.createElement("td");
    const badge = document.createElement("span");
    const state = up === null ? "unknown" : (up ? "up" : "down");
    badge.className = "badge " + state;
    badge.textContent = state.toUpperCase();
    td.appendChild(badge);
    return td;
  }

  function renderSummary(results) {
    const upCount = results.filter((r) => r.up === true).length;
    const downCount = results.filter((r) => r.up === false).length;
    const unknownCount = results.filter((r) => r.up == null).length;
    summary.replaceChildren();
    for (const text of [results.length + " checked", upCount + " up", downCount + " down", unknownCount + " unknown"]) {
      const pill = document.createElement("span");
      pill.textContent = text;
      summary.appendChild(pill);
    }
  }

  function renderResults(results) {
    tbody.replaceChildren();
    for (const r of results) {
      const tr = document.createElement("tr");
      tr.appendChild(cell(r.url));
      tr.appendChild(statusCell(r.up));
      tr.appendChild(cell(r.status_code == null ? "-" : String(r.status_code)));
      tr.appendChild(cell(r.response_time_ms == null ? "-" : r.response_time_ms + " ms"));
      tr.appendChild(cell(r.error || "OK", r.error ? "muted" : ""));
      tbody.appendChild(tr);
    }
    renderSummary(results);
    output.hidden = results.length === 0;
  }

  // ---- Form handling ----
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();

    const lines = parseUrls(textarea.value);
    if (lines.length === 0) {
      showMessage("Please enter at least one website address.", "error");
      return;
    }
    if (lines.length > MAX_URLS) {
      showMessage("Please check at most " + MAX_URLS + " sites at a time.", "error");
      return;
    }

    const urls = [];
    for (const line of lines) {
      const url = normalizeUrl(line);
      if (!url) {
        showMessage("Not a valid website address (use a domain or an http(s) URL): " + line, "error");
        return;
      }
      urls.push(url);
    }

    submitBtn.disabled = true;
    buttonLabel.textContent = "Checking...";
    output.hidden = true;
    try {
      let results;
      try {
        results = await checkViaApi(urls);
        clearMessage();
      } catch (apiErr) {
        // Fall back only when the API is absent/unreachable. Preserve real API
        // validation and server errors instead of hiding them with a second check.
        if (apiErr.apiResponse) throw apiErr;
        results = await checkAllViaBrowser(urls);
        showMessage(
          "Checked from your browser. For exact HTTP status codes on any site, " +
            "run the app locally: python3 -m uptime_checker --port 8000",
          "info"
        );
      }
      renderResults(results);
    } catch (err) {
      showMessage("Could not check these websites. Please try again. " + (err.message || ""), "error");
    } finally {
      submitBtn.disabled = false;
      buttonLabel.textContent = "Check websites";
    }
  });
})();
