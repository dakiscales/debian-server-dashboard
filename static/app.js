"use strict";

(() => {
  const REFRESH_INTERVAL = 5000;
  // The existing service check can take five seconds. A slow endpoint must not
  // overlap itself or prevent the other endpoints from refreshing on schedule.
  const REQUEST_TIMEOUT = 8000;
  const byId = (id) => document.getElementById(id);
  const sources = {
    health: { path: "/health", state: "loading", detail: "" },
    metrics: { path: "/metrics", state: "loading", detail: "" },
    services: { path: "/services", state: "loading", detail: "" },
  };
  const metricFields = [
    { id: "cpu", key: "cpu_percent", label: "CPU usage" },
    { id: "ram", key: "memory_percent", label: "RAM usage" },
    { id: "disk", key: "disk_percent", label: "Disk usage" },
  ];
  let lastAnnouncement = "";

  function setStatus(id, label, tone) {
    const element = byId(id);
    element.dataset.tone = tone;
    element.querySelector(".status-text").textContent = label;
  }

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function validStatus(value) {
    return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 80;
  }

  function validPercent(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
  }

  function validUptime(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
  }

  function titleCase(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function renderHealth(data, errorLabel) {
    const valid = isRecord(data) && validStatus(data.status);
    const status = valid ? data.status.trim().toLowerCase() : "";
    const healthy = ["healthy", "ok", "up"].includes(status);
    const unhealthy = ["unhealthy", "error", "failed", "down"].includes(status);
    const tone = valid ? (healthy ? "good" : unhealthy ? "danger" : "warning") : errorLabel === "Connection error" ? "danger" : "warning";
    byId("health-value").textContent = valid ? (healthy ? "Backend healthy" : titleCase(status)) : errorLabel;
    byId("health-description").textContent = valid
      ? (healthy ? "The backend is responding normally." : "Status reported by the health endpoint.")
      : "No current health status is available.";
    byId("health-emblem").dataset.tone = tone;
    byId("health-icon").setAttribute("href", healthy ? "#icon-check" : "#icon-alert");
    setStatus("health-status", valid ? titleCase(status) : errorLabel, tone);
    return valid ? 1 : 0;
  }

  function renderMetric(field, value, errorLabel) {
    const valid = validPercent(value);
    const meter = byId(`${field.id}-meter`);
    const fill = byId(`${field.id}-bar`);
    byId(`${field.id}-value`).textContent = valid ? value.toFixed(1) : "—";
    byId(`${field.id}-value`).parentElement.setAttribute("aria-label", valid ? `${field.label}: ${value.toFixed(1)} percent` : `${field.label}: ${errorLabel}`);
    fill.style.width = valid ? `${value}%` : "0%";
    const tone = valid ? (value >= 90 ? "danger" : value >= 70 ? "warning" : "good") : "neutral";
    fill.dataset.tone = tone;
    if (valid) {
      meter.setAttribute("role", "meter");
      meter.setAttribute("aria-label", field.label);
      meter.setAttribute("aria-valuemin", "0");
      meter.setAttribute("aria-valuemax", "100");
      meter.setAttribute("aria-valuenow", String(value));
      meter.setAttribute("aria-valuetext", `${value.toFixed(1)} percent used`);
    } else {
      ["role", "aria-label", "aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-valuetext"].forEach((name) => meter.removeAttribute(name));
    }
    setStatus(`${field.id}-status`, valid ? (value >= 90 ? "High usage" : value >= 70 ? "Elevated usage" : "Normal usage") : errorLabel, valid ? tone : errorLabel === "Connection error" ? "danger" : "warning");
    return valid ? 1 : 0;
  }

  function renderUptime(value, errorLabel) {
    const valid = validUptime(value);
    const element = byId("uptime-value");
    element.replaceChildren();
    if (!valid) {
      element.textContent = "—";
      element.setAttribute("aria-label", `System uptime: ${errorLabel}`);
      setStatus("uptime-status", errorLabel, errorLabel === "Connection error" ? "danger" : "warning");
      return 0;
    }
    const seconds = Math.floor(value);
    const parts = [
      [Math.floor(seconds / 86400), "d", "days"],
      [Math.floor((seconds % 86400) / 3600), "h", "hours"],
      [Math.floor((seconds % 3600) / 60), "m", "minutes"],
      [seconds % 60, "s", "seconds"],
    ];
    parts.forEach(([amount, unit]) => {
      element.append(document.createTextNode(String(amount)));
      const label = document.createElement("span");
      label.className = "uptime-unit";
      label.textContent = unit;
      element.append(label);
    });
    element.setAttribute("aria-label", `System uptime: ${parts.map(([amount, , unit]) => `${amount} ${unit}`).join(", ")}`);
    setStatus("uptime-status", "Reported uptime", "good");
    return 1;
  }

  function renderMetrics(data, errorLabel) {
    const values = isRecord(data) ? data : {};
    const count = metricFields.reduce((total, field) => total + renderMetric(field, values[field.key], errorLabel), 0);
    return count + renderUptime(values.uptime_seconds, errorLabel);
  }

  function renderServices(data, errorLabel) {
    const valid = isRecord(data) && validStatus(data.nginx);
    const status = valid ? data.nginx.trim().toLowerCase() : "";
    const tone = status === "active" ? "good" : ["failed", "inactive", "dead"].includes(status) ? "danger" : "warning";
    setStatus("nginx-status", valid ? titleCase(status) : errorLabel, valid ? tone : errorLabel === "Connection error" ? "danger" : "warning");
    const descriptions = {
      active: "The service is active.",
      inactive: "The service is not running.",
      failed: "The service reported a failure.",
      activating: "The service is starting.",
      deactivating: "The service is stopping.",
      reloading: "The service is reloading.",
      unavailable: "The backend could not read this service status.",
      unknown: "The backend could not determine the service state.",
    };
    byId("nginx-description").textContent = valid ? (descriptions[status] || `Reported state: ${status}.`) : "No current service status is available.";
    return valid ? 1 : 0;
  }

  const renderers = { health: renderHealth, metrics: renderMetrics, services: renderServices };

  function updateConnection() {
    const entries = Object.values(sources);
    const loading = entries.some((source) => source.state === "loading");
    const problems = entries.filter((source) => !["ok", "loading"].includes(source.state));
    const allFailed = entries.every((source) => ["error", "unavailable"].includes(source.state));
    const disconnected = entries.every((source) => source.state === "error");
    const label = loading ? "Connecting" : disconnected ? "Connection lost" : allFailed ? "Data unavailable" : problems.length ? "Partial data" : "Connected";
    byId("connection-label").textContent = label;
    byId("connection-state").dataset.tone = disconnected ? "danger" : loading || problems.length ? "warning" : "good";
    byId("connection-notice").hidden = problems.length === 0;
    const title = disconnected ? "Unable to connect to the backend" : allFailed ? "Server data is unavailable" : "Some server data is unavailable";
    const detail = problems.map((source) => `${source.path}: ${source.detail}`).join(" ");
    byId("notice-title").textContent = title;
    byId("notice-detail").textContent = `${detail} Retrying automatically every 5 seconds. Unavailable values are shown as a dash.`;
    const announcement = problems.length ? `${title}. ${detail}` : loading ? "Connecting to the server." : "Connected. Server information is up to date.";
    if (announcement !== lastAnnouncement) {
      byId("announcements").textContent = announcement;
      lastAnnouncement = announcement;
    }
  }

  async function fetchSource(name) {
    const source = sources[name];
    if (source.pending) return;
    source.pending = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      let response;
      try {
        response = await fetch(source.path, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });
      } catch (error) {
        source.state = "error";
        source.detail = error.name === "AbortError" ? "The request timed out." : "Connection error.";
        renderers[name](null, "Connection error");
        return;
      }
      if (!response.ok) {
        source.state = "unavailable";
        source.detail = `Unavailable (HTTP ${response.status}).`;
        renderers[name](null, "Unavailable");
        return;
      }
      let data;
      try {
        data = await response.json();
      } catch (error) {
        source.state = ["AbortError", "TypeError"].includes(error.name) ? "error" : "unavailable";
        source.detail = error.name === "AbortError" ? "The request timed out." : error.name === "TypeError" ? "Connection error." : "The response is not valid JSON.";
        renderers[name](null, source.state === "error" ? "Connection error" : "Unavailable");
        return;
      }
      const count = renderers[name](data, "Unavailable");
      const expected = name === "metrics" ? 4 : 1;
      source.state = count === expected ? "ok" : count > 0 ? "partial" : "unavailable";
      source.detail = count === expected ? "" : "The response has missing or invalid values.";
      if (count > 0) {
        const now = new Date();
        const updated = byId("last-updated");
        updated.dateTime = now.toISOString();
        updated.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        updated.title = `Last successful data update: ${now.toLocaleString()}`;
        updated.setAttribute("aria-label", updated.title);
      }
    } finally {
      window.clearTimeout(timeout);
      source.pending = false;
      updateConnection();
    }
  }

  function refresh() {
    return Promise.allSettled(Object.keys(sources).map(fetchSource));
  }

  refresh();
  window.setInterval(refresh, REFRESH_INTERVAL);
})();
