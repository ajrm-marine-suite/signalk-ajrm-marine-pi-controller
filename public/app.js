const elements = {
  banner: document.getElementById("statusBanner"),
  refreshButton: document.getElementById("refreshButton"),
  host: document.getElementById("host"),
  network: document.getElementById("network"),
  uptime: document.getElementById("uptime"),
  load: document.getElementById("load"),
  temperature: document.getElementById("temperature"),
  memoryBar: document.getElementById("memoryBar"),
  memoryText: document.getElementById("memoryText"),
  diskList: document.getElementById("diskList"),
  pluginVersion: document.getElementById("pluginVersion"),
  nodeVersion: document.getElementById("nodeVersion"),
  processUptime: document.getElementById("processUptime"),
  powerHelp: document.getElementById("powerHelp"),
  rebootButton: document.getElementById("rebootButton"),
  shutdownButton: document.getElementById("shutdownButton"),
  piperStatus: document.getElementById("piperStatus"),
  piperLastAction: document.getElementById("piperLastAction"),
  piperActionOutput: document.getElementById("piperActionOutput"),
  installPiperButton: document.getElementById("installPiperButton"),
  sdCardBackupStatus: document.getElementById("sdCardBackupStatus"),
  sdCardBackupLastAction: document.getElementById("sdCardBackupLastAction"),
  sdCardBackupOutput: document.getElementById("sdCardBackupOutput"),
  backupSdCardButton: document.getElementById("backupSdCardButton"),
};

let refreshTimer = null;
let pendingPowerAction = null;

elements.refreshButton.addEventListener("click", refreshStatus);
elements.rebootButton.addEventListener("click", () => runAction("reboot"));
elements.shutdownButton.addEventListener("click", () => runAction("shutdown"));
elements.installPiperButton.addEventListener("click", () => runSupportAction("install-piper"));
elements.backupSdCardButton.addEventListener("click", runSdCardBackupAction);

refreshStatus();

async function refreshStatus() {
  try {
    const status = await getJson("../plugins/signalk-ajrm-marine-pi-controller/status");
    renderStatus(status);
    if (pendingPowerAction) {
      setBanner(powerActionMessage(pendingPowerAction));
    } else {
      setBanner(`Updated ${new Date(status.timestamp).toLocaleTimeString()}`);
    }
    scheduleRefresh(status.controls?.statusRefreshSeconds || 5);
  } catch (error) {
    if (pendingPowerAction) {
      setBanner(`${powerActionMessage(pendingPowerAction)} Waiting for the Pi to go offline or return.`);
    } else {
      setBanner(error.message, true);
    }
    scheduleRefresh(10);
  }
}

function renderStatus(status) {
  elements.host.textContent = `${status.hostname} (${status.platform})`;
  elements.network.textContent = formatNetwork(status.network);
  elements.uptime.textContent = formatDuration(status.uptimeSeconds);
  elements.load.textContent = (status.loadAverage || [])
    .map((value) => Number(value).toFixed(2))
    .join(" / ");
  elements.temperature.textContent = status.temperature?.celsius
    ? `${status.temperature.celsius.toFixed(1)} C`
    : "Not available";

  const memory = status.memory || {};
  const used = Number(memory.usedBytes || 0);
  const total = Number(memory.totalBytes || 0);
  const percent = total > 0 ? Math.round((used / total) * 100) : 0;
  elements.memoryBar.style.width = `${percent}%`;
  elements.memoryText.textContent = `${formatBytes(used)} used of ${formatBytes(total)} (${percent}%)`;

  renderDisks(status.disks || []);
  elements.pluginVersion.textContent = `${status.plugin} v${status.version}`;
  elements.nodeVersion.textContent = status.process?.node || "-";
  elements.processUptime.textContent = formatDuration(
    status.process?.uptimeSeconds || 0,
  );

  renderPowerControls(status);

  const supportEnabled = Boolean(status.controls?.supportEnabled);
  renderPiperStatus(status.support?.piper || null);
  const piperRunning = status.support?.piper?.lastAction?.status === "running";
  elements.installPiperButton.disabled = !supportEnabled || status.support?.piper?.ok === true || piperRunning;
  renderSdCardBackup(status.sdCardBackup || null);
}

function renderDisks(disks) {
  if (!disks.length) {
    elements.diskList.innerHTML = "<p>No disk paths configured.</p>";
    return;
  }
  elements.diskList.innerHTML = disks
    .map((disk) => {
      if (disk.error) {
        return `<div class="disk"><div class="disk-header"><span class="disk-path">${escapeHtml(disk.path)}</span><span class="disk-detail">${escapeHtml(disk.error)}</span></div></div>`;
      }
      const percent = Number(disk.usedPercent || 0);
      return `<div class="disk">
        <div class="disk-header">
          <span class="disk-path">${escapeHtml(disk.path)}</span>
          <span class="disk-detail">${formatBytes(disk.availableBytes)} free of ${formatBytes(disk.totalBytes)} (${percent}% used)</span>
        </div>
        <div class="meter"><span style="width:${percent}%"></span></div>
      </div>`;
    })
    .join("");
}

async function runAction(action) {
  const label = action === "shutdown" ? "shut down" : "restart";
  if (!window.confirm(`Are you sure you want to ${label} the Pi now?`)) return;

  try {
    pendingPowerAction = {
      action,
      status: "requesting",
      startedAt: new Date().toISOString(),
    };
    renderPowerControls();
    setBanner(powerActionMessage(pendingPowerAction));
    const result = await postJson(
      `../plugins/signalk-ajrm-marine-pi-controller/actions/${action}`,
      { confirmed: true },
    );
    pendingPowerAction = {
      action,
      status: "waiting",
      startedAt: result.startedAt,
      runAt: result.runAt,
      graceSeconds: result.graceSeconds,
    };
    renderPowerControls();
    setBanner(powerActionMessage(pendingPowerAction));
    scheduleRefresh(1);
  } catch (error) {
    pendingPowerAction = null;
    renderPowerControls();
    setBanner(error.message, true);
  }
}

function renderPowerControls(status = null) {
  const serverAction = status?.lastAction || null;
  if (serverAction && ["waiting", "running"].includes(serverAction.status)) {
    pendingPowerAction = serverAction;
  }
  const powerEnabled = status ? Boolean(status.controls?.powerEnabled) : true;
  const active = pendingPowerAction;
  const action = active?.action || "";
  const waiting = active?.status === "waiting" || active?.status === "requesting";
  const running = active?.status === "running";

  if (!powerEnabled) {
    elements.powerHelp.textContent = "Power controls are disabled in the plugin configuration.";
  } else if (active) {
    elements.powerHelp.textContent = powerActionMessage(active);
  } else {
    elements.powerHelp.textContent = "Restarting or shutting down requires confirmation.";
  }

  elements.rebootButton.disabled = !powerEnabled || Boolean(active);
  elements.shutdownButton.disabled = !powerEnabled || Boolean(active);
  elements.rebootButton.textContent =
    action === "reboot" && (waiting || running) ? "Rebooting..." : "Restart Pi";
  elements.shutdownButton.textContent =
    action === "shutdown" && (waiting || running) ? "Shutting down..." : "Shut Down Pi";
}

function powerActionMessage(actionState) {
  const action = actionState?.action === "shutdown" ? "shutdown" : "reboot";
  const verb = action === "shutdown" ? "Shutting down" : "Rebooting";
  if (actionState?.status === "requesting") {
    return `${verb} request is being sent.`;
  }
  if (actionState?.status === "waiting" && actionState.runAt) {
    return `${verb} at ${formatTime(actionState.runAt)}. Waiting for apps to close files.`;
  }
  if (actionState?.status === "running") {
    return `${verb} now. The web page may stop responding.`;
  }
  return `${verb} requested.`;
}

async function runSupportAction(action) {
  const label = action === "install-piper" ? "install Piper" : action;
  if (!window.confirm(`Are you sure you want to ${label} on this Pi now?`)) return;

  try {
    const result = await postJson(
      `../plugins/signalk-ajrm-marine-pi-controller/actions/${action}`,
      { confirmed: true },
    );
    setBanner(`${label} requested at ${new Date(result.startedAt).toLocaleTimeString()}`);
    scheduleRefresh(2);
  } catch (error) {
    setBanner(error.message, true);
  }
}

function renderPiperStatus(piper) {
  if (!piper) {
    elements.piperStatus.textContent = "Piper status unavailable.";
    elements.piperLastAction.textContent = "";
    elements.piperActionOutput.hidden = true;
    elements.piperActionOutput.textContent = "";
    return;
  }
  elements.piperStatus.textContent = piper.ok
    ? `Piper ready: ${piper.executable?.path || "piper"} with ${piper.voice?.id || "voice"}`
    : "Piper is not ready for AJRM Marine Audio.";
  const last = piper.lastAction;
  elements.piperLastAction.textContent = last
    ? `Last action: ${last.status} at ${formatTime(last.finishedAt || last.startedAt)}${last.error ? ` - ${last.error}` : ""}`
    : "";
  const output = [last?.stdout, last?.stderr].filter(Boolean).join("\n").trim();
  elements.piperActionOutput.hidden = !output;
  elements.piperActionOutput.textContent = output;
  if (last?.status === "running") scheduleRefresh(2);
}

function renderSdCardBackup(sdCardBackup) {
  const target = sdCardBackup?.target || null;
  const last = sdCardBackup?.lastAction || null;
  const running = ["starting", "running"].includes(last?.status);
  const enabled = Boolean(target?.enabled);
  const ready = target?.status === "ok";

  if (!target) {
    elements.sdCardBackupStatus.textContent = "SD-card backup status unavailable.";
  } else if (!enabled) {
    elements.sdCardBackupStatus.textContent = target.message || "SD-card backup is disabled.";
  } else if (target.status === "ok") {
    elements.sdCardBackupStatus.textContent =
      `${target.label || "Backup USB"} ready as ${target.path}` +
      `${target.model ? ` (${target.model})` : ""}` +
      `${target.sizeBytes ? `, ${formatBytes(target.sizeBytes)}` : ""}.`;
  } else {
    elements.sdCardBackupStatus.textContent = target.message || "Backup target is not ready.";
  }

  elements.sdCardBackupLastAction.textContent = last
    ? `Last action: ${last.status} at ${formatTime(last.finishedAt || last.startedAt)}${last.error ? ` - ${last.error}` : ""}`
    : "";
  const output = String(last?.output || "").trim();
  elements.sdCardBackupOutput.hidden = !output;
  elements.sdCardBackupOutput.textContent = output;
  elements.backupSdCardButton.disabled = !enabled || !ready || running;

  if (running) scheduleRefresh(2);
}

async function runSdCardBackupAction() {
  if (!window.confirm("Run rpi-clone now? The configured backup USB device will be detected and overwritten.")) return;

  try {
    const result = await postJson(
      "../plugins/signalk-ajrm-marine-pi-controller/actions/backup-sd-card",
      { confirmed: true },
    );
    setBanner(`SD-card backup requested at ${new Date(result.startedAt).toLocaleTimeString()}`);
    scheduleRefresh(2);
  } catch (error) {
    setBanner(error.message, true);
  }
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(responseBody.error || `HTTP ${response.status}`);
  }
  return responseBody;
}

function setBanner(message, isError = false) {
  elements.banner.textContent = message;
  elements.banner.classList.toggle("error", isError);
}

function scheduleRefresh(seconds) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refreshStatus, Math.max(1, seconds) * 1000);
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatNetwork(network) {
  const primary = network?.primary;
  if (!primary?.address) return "No IPv4 address found";
  const typeLabel =
    primary.type === "ethernet"
      ? "Ethernet"
      : primary.type === "wifi"
        ? "Wi-Fi"
        : "Network";
  return `${typeLabel} ${primary.address} (${primary.name})`;
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleTimeString();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
