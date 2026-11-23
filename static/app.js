(function () {
  "use strict";

  const form = document.getElementById("check-form");
  const textarea = document.getElementById("urls");
  const submitBtn = document.getElementById("submit");
  const message = document.getElementById("message");
  const output = document.getElementById("output");
  const summary = document.getElementById("summary");
  const table = document.getElementById("results");
  const tbody = table.querySelector("tbody");

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
    for (const text of [
      results.length + " checked",
      upCount + " up",
      downCount + " down",
    ]) {
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

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();

    const urls = parseUrls(textarea.value);
    if (urls.length === 0) {
      showMessage("Please enter at least one website address.", "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Checking...";
    output.hidden = true;
    try {
      const resp = await fetch("api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: urls }),
      });
      const isJson = (resp.headers.get("content-type") || "").includes("application/json");
      const data = isJson ? await resp.json() : null;

      if (!resp.ok) {
        showMessage((data && data.error) || "Request failed (HTTP " + resp.status + ").", "error");
        return;
      }
      if (!data || !Array.isArray(data.results)) {
        showMessage("Unexpected response from the server.", "error");
        return;
      }
      renderResults(data.results);
    } catch (err) {
      // Typical on GitHub Pages: there is no Python API behind the static files.
      showMessage(
        "Could not reach the checker API (" + err.message + "). " +
          "Run the app locally with: python3 -m uptime_checker --port 8000",
        "error"
      );
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Check sites";
    }
  });
})();
