(function () {
  "use strict";

  const TIMEOUT_MS = 5000;
  const MAX_URLS = 20;

  const form = document.getElementById("check-form");
  const textarea = document.getElementById("urls");
  const submitBtn = document.getElementById("submit");
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

  // Accept HTTP(S) URLs and bare website addresses, defaulting bare hosts to HTTPS.
  function normalizeUrl(raw) {
    const value = raw.trim();
    if (!value || /[\s\u0000-\u001f]/.test(value)) return null;
    let candidate = value;
    if (candidate.startsWith("//")) {
      candidate = "https:" + candidate;
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
      // Keep explicit HTTP(S), and recognize host:port as a bare host.
      if (!/^https?:\/\//i.test(candidate)) {
        if (/^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\]):[0-9]+(?:[/?#]|$)/i.test(candidate)) candidate = "https://" + candidate;
        else return null;
      }
    } else {
      candidate = "https://" + candidate;
    }
    let parsed;
    try { parsed = new URL(candidate); } catch (e) { return null; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.href;
  }

  // ---- Check via the Python API (local `python3 -m uptime_checker`) ----
  async function checkViaApi(urls) {
    const resp = await fetch("api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: urls }),
    });
    const isJson = (resp.headers.get("content-type") || "").includes("application/json");
    if (!isJson) throw new Error("no API at this address");
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "HTTP " + resp.status);
    if (!data || !Array.isArray(data.results)) throw new Error("unexpected response");
    return data.results;
  }

  // ---- Check from the browser (works on GitHub Pages) ----
  // Tries a CORS request first to read the real HTTP status. If the site
  // does not allow cross-origin reads, falls back to a no-cors request,
  // which only tells us whether the site answered at all.
  async function fetchWithTimeout(url, mode) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, {
        method: "GET",
        mode: mode,
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function checkViaBrowser(url) {
    const start = performance.now();
    const elapsed = () => Math.round((performance.now() - start) * 10) / 10;
    try {
      const resp = await fetchWithTimeout(url, "cors");
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
      // CORS blocked the read, or the site is down. Ask again without CORS.
      try {
        await fetchWithTimeout(url, "no-cors");
        return {
          url: url,
          up: true,
          status_code: null,
          response_time_ms: elapsed(),
          error: "reachable; HTTP status hidden by the site's CORS policy",
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
    badge.className = "badge " + (up ? "up" : "down");
    badge.textContent = up ? "UP" : "DOWN";
    td.appendChild(badge);
    return td;
  }

  function renderSummary(results) {
    const upCount = results.filter((r) => r.up).length;
    const downCount = results.length - upCount;
    summary.replaceChildren();
    for (const text of [results.length + " checked", upCount + " up", downCount + " down"]) {
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
        showMessage("Not a valid http:// or https:// address: " + line, "error");
        return;
      }
      urls.push(url);
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Checking...";
    output.hidden = true;
    try {
      let results;
      try {
        results = await checkViaApi(urls);
        clearMessage();
      } catch (apiErr) {
        // No Python server here (e.g. GitHub Pages). Check from the browser.
        results = await checkAllViaBrowser(urls);
        showMessage(
          "Checked from your browser. For exact HTTP status codes on any site, " +
            "run the app locally: python3 -m uptime_checker --port 8000",
          "info"
        );
      }
      renderResults(results);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Check sites";
    }
  });
})();
