(function () {
  "use strict";

  const form = document.getElementById("check-form");
  const textarea = document.getElementById("urls");
  const submitBtn = document.getElementById("submit");
  const message = document.getElementById("message");
  const table = document.getElementById("results");
  const tbody = table.querySelector("tbody");

  function showError(text) {
    message.textContent = text;
    message.hidden = false;
  }

  function clearError() {
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

  function renderResults(results) {
    tbody.replaceChildren();
    for (const r of results) {
      const tr = document.createElement("tr");
      tr.appendChild(cell(r.url));
      tr.appendChild(cell(r.up ? "UP" : "DOWN", r.up ? "up" : "down"));
      tr.appendChild(cell(r.status_code == null ? "-" : String(r.status_code)));
      tr.appendChild(cell(r.response_time_ms == null ? "-" : String(r.response_time_ms)));
      tr.appendChild(cell(r.error || "OK"));
      tbody.appendChild(tr);
    }
    table.hidden = results.length === 0;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError();

    const urls = parseUrls(textarea.value);
    if (urls.length === 0) {
      showError("Please enter at least one URL.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Checking...";
    try {
      const resp = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: urls }),
      });
      let data = {};
      try {
        data = await resp.json();
      } catch (_) {
        /* non-JSON response */
      }
      if (!resp.ok) {
        showError(data.error || "Request failed (HTTP " + resp.status + ").");
        table.hidden = true;
        return;
      }
      renderResults(data.results || []);
    } catch (err) {
      showError("Could not reach the uptime checker server: " + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Check sites";
    }
  });
})();
