const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const packageInfo = require("../package.json");

const PACKAGE_ROOT = path.dirname(__dirname);
const DEFAULT_PIPER_INSTALL_COMMAND = `bash ${shellQuote(path.join(PACKAGE_ROOT, "scripts", "install-piper.sh"))}`;
const DEFAULT_PIPER_VOICES = [
  "en_GB-alan-medium",
  "en_GB-alba-medium",
  "en_GB-jenny_dioco-medium",
];

module.exports = function ajrmMarinePiController(app) {
  const plugin = {};
  let options = normalizeOptions({});
  let lastAction = null;
  let lastSupportAction = null;
  let publishTimer = null;
  let shutdownWatchTimer = null;
  let lastObservedShutdownKey = null;

  plugin.id = "signalk-ajrm-marine-pi-controller";
  plugin.name = "AJRM Marine Pi Controller";
  plugin.description =
    "Simple Signal K webapp for monitoring and controlling a Raspberry Pi.";

  plugin.start = (pluginOptions = {}) => {
    options = normalizeOptions(pluginOptions);
    publishTelemetry().catch((error) => {
      app.error(`[${plugin.id}] telemetry publish failed: ${error.stack || error.message}`);
    });
    publishTimer = setInterval(() => {
      publishTelemetry().catch((error) => {
        app.error(`[${plugin.id}] telemetry publish failed: ${error.stack || error.message}`);
      });
    }, options.publishIntervalSeconds * 1000);
    shutdownWatchTimer = setInterval(() => {
      observeScheduledShutdown().catch((error) => {
        app.debug?.(`[${plugin.id}] scheduled shutdown check failed: ${error.message || error}`);
      });
    }, options.shutdownWatchIntervalSeconds * 1000);
    shutdownWatchTimer.unref?.();
    observeScheduledShutdown().catch(() => {});
    app.setPluginStatus(`Started v${packageInfo.version}`);
  };

  plugin.stop = () => {
    clearInterval(publishTimer);
    clearInterval(shutdownWatchTimer);
    publishTimer = null;
    shutdownWatchTimer = null;
  };

  plugin.schema = {
    type: "object",
    properties: {
      enablePowerControls: {
        type: "boolean",
        title: "Enable power controls",
        description:
          "Allows the webapp to request shutdown and restart commands. Keep disabled if the Signal K webapp is exposed to untrusted users.",
        default: true,
      },
      enableSupportControls: {
        type: "boolean",
        title: "Enable support installers",
        description:
          "Allows explicit support actions such as installing Piper for AJRM Marine Audio. Keep disabled if this Signal K server is exposed to untrusted users.",
        default: true,
      },
      piperInstallCommand: {
        type: "string",
        title: "Piper install command",
        description:
          "Command run when the webapp or AJRM Marine Audio requests Piper installation.",
        default: DEFAULT_PIPER_INSTALL_COMMAND,
      },
      rebootCommand: {
        type: "string",
        title: "Reboot command",
        default: "sudo /sbin/reboot",
      },
      shutdownCommand: {
        type: "string",
        title: "Shutdown command",
        default: "sudo /sbin/shutdown -h now",
      },
      powerActionGraceSeconds: {
        type: "integer",
        title: "Power action grace period seconds",
        description:
          "Seconds to wait after publishing a shutdown/reboot intent before running the configured system command.",
        default: 10,
        minimum: 0,
        maximum: 120,
      },
      diskPaths: {
        type: "array",
        title: "Disk paths to monitor",
        default: ["/"],
        items: {
          type: "string",
        },
      },
      statusRefreshSeconds: {
        type: "integer",
        title: "Web status refresh interval",
        default: 5,
        minimum: 1,
        maximum: 300,
      },
      publishTelemetry: {
        type: "boolean",
        title: "Publish system telemetry to Signal K",
        description:
          "Publishes Raspberry Pi / host telemetry under vessels.self.plugins.ajrmMarinePiController.system so AJRM Marine Logger, Capture, and Snapshot can capture it.",
        default: true,
      },
      publishIntervalSeconds: {
        type: "integer",
        title: "Signal K telemetry publish interval seconds",
        default: 15,
        minimum: 5,
        maximum: 3600,
      },
      shutdownWatchIntervalSeconds: {
        type: "integer",
        title: "Scheduled shutdown watch interval seconds",
        description:
          "How often to check systemd for shutdowns scheduled by external tools such as powerDown.",
        default: 2,
        minimum: 1,
        maximum: 60,
      },
    },
  };

  plugin.registerWithRouter = function registerWithRouter(router) {
    router.get("/status", async (_req, res) => {
      try {
        res.json(await buildStatus());
      } catch (error) {
        app.error(`[${plugin.id}] status error: ${error.stack || error.message}`);
        res.status(500).json({ ok: false, error: error.message });
      }
    });

    router.post("/actions/reboot", async (req, res) => {
      await runPowerAction(req, res, {
        action: "reboot",
        command: options.rebootCommand,
      });
    });

    router.post("/actions/shutdown", async (req, res) => {
      await runPowerAction(req, res, {
        action: "shutdown",
        command: options.shutdownCommand,
      });
    });

    router.post("/actions/install-piper", async (req, res) => {
      await runSupportAction(req, res, {
        action: "install-piper",
        label: "Piper install",
        command: options.piperInstallCommand,
      });
    });
  };

  return plugin;

  function normalizeOptions(value) {
    return {
      enablePowerControls: value.enablePowerControls !== false,
      enableSupportControls: value.enableSupportControls !== false,
      piperInstallCommand: String(
        value.piperInstallCommand || DEFAULT_PIPER_INSTALL_COMMAND,
      ),
      rebootCommand: String(value.rebootCommand || "sudo /sbin/reboot"),
      shutdownCommand: String(
        value.shutdownCommand || "sudo /sbin/shutdown -h now",
      ),
      powerActionGraceSeconds: clampInt(value.powerActionGraceSeconds, 10, 0, 120),
      diskPaths: normalizeDiskPaths(value.diskPaths),
      statusRefreshSeconds: clampInt(value.statusRefreshSeconds, 5, 1, 300),
      publishTelemetry: value.publishTelemetry !== false,
      publishIntervalSeconds: clampInt(value.publishIntervalSeconds, 15, 5, 3600),
      shutdownWatchIntervalSeconds: clampInt(value.shutdownWatchIntervalSeconds, 2, 1, 60),
    };
  }

  function normalizeDiskPaths(value) {
    const paths = Array.isArray(value) ? value : ["/"];
    const clean = paths
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
    return clean.length ? clean : ["/"];
  }

  function clampInt(value, fallback, min, max) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  async function buildStatus() {
    const [disks, temperature] = await Promise.all([
      Promise.all(options.diskPaths.map(readDiskStatus)),
      readCpuTemperature(),
    ]);

    return {
      ok: true,
      plugin: plugin.id,
      version: packageInfo.version,
      timestamp: new Date().toISOString(),
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()} ${os.arch()}`,
      network: readNetworkStatus(),
      uptimeSeconds: Math.round(os.uptime()),
      loadAverage: os.loadavg(),
      memory: {
        totalBytes: os.totalmem(),
        freeBytes: os.freemem(),
        usedBytes: os.totalmem() - os.freemem(),
      },
      temperature,
      disks,
      process: {
        pid: process.pid,
        node: process.version,
        uptimeSeconds: Math.round(process.uptime()),
        memory: process.memoryUsage(),
      },
      controls: {
        powerEnabled: options.enablePowerControls,
        supportEnabled: options.enableSupportControls,
        powerActionGraceSeconds: options.powerActionGraceSeconds,
        statusRefreshSeconds: options.statusRefreshSeconds,
        publishTelemetry: options.publishTelemetry,
        publishIntervalSeconds: options.publishIntervalSeconds,
        shutdownWatchIntervalSeconds: options.shutdownWatchIntervalSeconds,
      },
      support: {
        piper: readPiperStatus(),
      },
      lastAction,
      lastSupportAction,
    };
  }

  async function publishTelemetry() {
    if (!options.publishTelemetry) return;
    const status = await buildStatus();
    const values = [
      { path: "plugins.ajrmMarinePiController.version", value: packageInfo.version },
      { path: "plugins.ajrmMarinePiController.system.hostname", value: status.hostname },
      { path: "plugins.ajrmMarinePiController.system.platform", value: status.platform },
      { path: "plugins.ajrmMarinePiController.system.uptimeSeconds", value: status.uptimeSeconds },
      { path: "plugins.ajrmMarinePiController.system.loadAverage.1m", value: status.loadAverage[0] },
      { path: "plugins.ajrmMarinePiController.system.loadAverage.5m", value: status.loadAverage[1] },
      { path: "plugins.ajrmMarinePiController.system.loadAverage.15m", value: status.loadAverage[2] },
      { path: "plugins.ajrmMarinePiController.system.memory.totalBytes", value: status.memory.totalBytes },
      { path: "plugins.ajrmMarinePiController.system.memory.freeBytes", value: status.memory.freeBytes },
      { path: "plugins.ajrmMarinePiController.system.memory.usedBytes", value: status.memory.usedBytes },
      { path: "plugins.ajrmMarinePiController.system.process.pid", value: status.process.pid },
      { path: "plugins.ajrmMarinePiController.system.process.node", value: status.process.node },
      { path: "plugins.ajrmMarinePiController.system.process.uptimeSeconds", value: status.process.uptimeSeconds },
      {
        path: "plugins.ajrmMarinePiController.system.process.memory.rssBytes",
        value: status.process.memory.rss,
      },
    ];

    if (status.temperature?.celsius !== undefined) {
      values.push({
        path: "plugins.ajrmMarinePiController.system.cpu.temperature",
        value: celsiusToKelvin(status.temperature.celsius),
      });
    }

    status.disks.forEach((disk, index) => {
      const key = safePathKey(disk.mountedOn || disk.path || `disk${index + 1}`);
      values.push(
        { path: `plugins.ajrmMarinePiController.system.disks.${key}.path`, value: disk.path },
        { path: `plugins.ajrmMarinePiController.system.disks.${key}.filesystem`, value: disk.filesystem || null },
        { path: `plugins.ajrmMarinePiController.system.disks.${key}.mountedOn`, value: disk.mountedOn || null },
        { path: `plugins.ajrmMarinePiController.system.disks.${key}.totalBytes`, value: disk.totalBytes || null },
        { path: `plugins.ajrmMarinePiController.system.disks.${key}.usedBytes`, value: disk.usedBytes || null },
        { path: `plugins.ajrmMarinePiController.system.disks.${key}.availableBytes`, value: disk.availableBytes || null },
        { path: `plugins.ajrmMarinePiController.system.disks.${key}.usedRatio`, value: Number.isFinite(disk.usedPercent) ? disk.usedPercent / 100 : null },
      );
      if (disk.error) {
        values.push({ path: `plugins.ajrmMarinePiController.system.disks.${key}.error`, value: disk.error });
      }
    });

    app.handleMessage(plugin.id, {
      context: "vessels.self",
      updates: [
        {
          source: { label: plugin.id },
          timestamp: status.timestamp,
          values,
        },
      ],
    });
  }

  function celsiusToKelvin(value) {
    return Math.round((Number(value) + 273.15) * 100) / 100;
  }

  function safePathKey(value) {
    const text = String(value || "")
      .replace(/^\/$/, "root")
      .replace(/^\//, "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return text || "root";
  }

  async function readDiskStatus(pathName) {
    try {
      const stdout = await execFile("df", ["-Pk", pathName], { timeout: 5000 });
      const lines = stdout.trim().split(/\r?\n/);
      const dataLine = lines[lines.length - 1] || "";
      const parts = dataLine.trim().split(/\s+/);
      if (parts.length < 6) {
        throw new Error(`Unexpected df output for ${pathName}`);
      }
      const totalKb = Number(parts[1]);
      const usedKb = Number(parts[2]);
      const availableKb = Number(parts[3]);
      return {
        path: pathName,
        filesystem: parts[0],
        totalBytes: totalKb * 1024,
        usedBytes: usedKb * 1024,
        availableBytes: availableKb * 1024,
        usedPercent: Number(parts[4].replace("%", "")),
        mountedOn: parts.slice(5).join(" "),
      };
    } catch (error) {
      return {
        path: pathName,
        error: error.message,
      };
    }
  }

  async function readCpuTemperature() {
    const thermalPath = "/sys/class/thermal/thermal_zone0/temp";
    try {
      if (fs.existsSync(thermalPath)) {
        const raw = await fs.promises.readFile(thermalPath, "utf8");
        const milliC = Number(raw.trim());
        if (Number.isFinite(milliC)) {
          return { celsius: Math.round((milliC / 1000) * 10) / 10 };
        }
      }
    } catch {
      // Fall back to vcgencmd below when available.
    }

    try {
      const stdout = await execFile("vcgencmd", ["measure_temp"], {
        timeout: 5000,
      });
      const match = stdout.match(/temp=([0-9.]+)'C/);
      if (match) return { celsius: Number(match[1]) };
    } catch {
      // Non-Raspberry Pi platforms normally do not have vcgencmd.
    }

    return null;
  }

  function readNetworkStatus() {
    const interfaces = Object.entries(os.networkInterfaces() || {})
      .flatMap(([name, addresses]) =>
        (addresses || []).map((address) => ({
          name,
          family: address.family,
          address: address.address,
          internal: Boolean(address.internal),
          mac: address.mac,
          type: classifyNetworkInterface(name),
        })),
      )
      .filter(
        (entry) =>
          entry.family === "IPv4" &&
          !entry.internal &&
          entry.address &&
          entry.address !== "127.0.0.1",
      );

    const primary =
      interfaces.find((entry) => entry.type === "ethernet") ||
      interfaces.find((entry) => entry.type === "wifi") ||
      interfaces[0] ||
      null;

    return {
      primary,
      interfaces,
    };
  }

  function classifyNetworkInterface(name) {
    const normalized = String(name || "").toLowerCase();
    if (/^(eth|en|eno|ens|enp)/.test(normalized)) return "ethernet";
    if (/^(wlan|wifi|wl)/.test(normalized)) return "wifi";
    return "other";
  }

  async function runPowerAction(req, res, { action, command }) {
    try {
      if (!options.enablePowerControls) {
        res.status(403).json({ ok: false, error: "Power controls are disabled" });
        return;
      }
      if (req.body?.confirmed !== true) {
        res.status(400).json({ ok: false, error: "Confirmation is required" });
        return;
      }
      if (!command.trim()) {
        res.status(400).json({ ok: false, error: "Command is blank" });
        return;
      }

      const startedAt = new Date().toISOString();
      const graceSeconds = options.powerActionGraceSeconds;
      const runAt = new Date(Date.now() + graceSeconds * 1000).toISOString();
      lastAction = { action, command, startedAt, runAt, graceSeconds, status: "waiting" };
      const scheduledAction = { ...lastAction };
      publishPowerIntent(lastAction);
      logInfo(`${action} requested; intent published; command scheduled for ${runAt}`);
      app.setPluginStatus(`${action} requested at ${startedAt}`);
      app.debug(`[${plugin.id}] ${action} requested; running command at ${runAt}: ${command}`);

      const timer = setTimeout(() => {
        lastAction = { ...scheduledAction, status: "running", runningAt: new Date().toISOString() };
        publishPowerIntent(lastAction);
        logInfo(`${action} command starting: ${command}`);
        detachedShell(command);
      }, graceSeconds * 1000);
      timer.unref?.();
      res.json({ ok: true, action, startedAt, runAt, graceSeconds });
    } catch (error) {
      lastAction = {
        action,
        command,
        startedAt: new Date().toISOString(),
        status: "failed",
        error: error.message,
      };
      app.error(`[${plugin.id}] ${action} failed: ${error.stack || error.message}`);
      res.status(500).json({ ok: false, error: error.message });
    }
  }

  async function runSupportAction(req, res, { action, label, command }) {
    try {
      if (!options.enableSupportControls) {
        res.status(403).json({ ok: false, error: "Support installers are disabled" });
        return;
      }
      if (req.body?.confirmed !== true) {
        res.status(400).json({ ok: false, error: "Confirmation is required" });
        return;
      }
      if (!command.trim()) {
        res.status(400).json({ ok: false, error: "Command is blank" });
        return;
      }

      const startedAt = new Date().toISOString();
      lastSupportAction = {
        action,
        command,
        startedAt,
        status: "running",
      };
      logInfo(`${label} started: ${command}`);
      app.setPluginStatus(`${label} started at ${startedAt}`);

      const child = childProcess.spawn("/bin/sh", ["-c", command], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout = truncateBufferedText(stdout + chunk.toString());
      });
      child.stderr.on("data", (chunk) => {
        stderr = truncateBufferedText(stderr + chunk.toString());
      });
      child.on("error", (error) => {
        lastSupportAction = {
          ...lastSupportAction,
          status: "failed",
          finishedAt: new Date().toISOString(),
          error: error.message,
          stdout,
          stderr,
        };
        app.error(`[${plugin.id}] ${label} failed: ${error.stack || error.message}`);
      });
      child.on("close", (code, signal) => {
        const ok = code === 0;
        lastSupportAction = {
          ...lastSupportAction,
          status: ok ? "completed" : "failed",
          finishedAt: new Date().toISOString(),
          exitCode: code,
          signal,
          stdout,
          stderr,
        };
        logInfo(`${label} ${ok ? "completed" : "failed"} with exit code ${code}`);
        app.setPluginStatus(`${label} ${ok ? "completed" : "failed"}`);
      });

      res.json({ ok: true, action, startedAt, status: "running" });
    } catch (error) {
      lastSupportAction = {
        action,
        command,
        startedAt: new Date().toISOString(),
        status: "failed",
        error: error.message,
      };
      app.error(`[${plugin.id}] ${action} failed: ${error.stack || error.message}`);
      res.status(500).json({ ok: false, error: error.message });
    }
  }

  function readPiperStatus() {
    const piper = checkExecutable("piper");
    const voicesDir = path.join(os.homedir(), "piper-voices");
    const voices = DEFAULT_PIPER_VOICES.map((voice) => {
      const nestedVoiceFile = path.join(voicesDir, voice, `${voice}.onnx`);
      const flatVoiceFile = path.join(voicesDir, `${voice}.onnx`);
      const voiceFile = fs.existsSync(nestedVoiceFile) ? nestedVoiceFile : flatVoiceFile;
      const voiceJson = `${voiceFile}.json`;
      const voiceReady = fs.existsSync(voiceFile) && fs.existsSync(voiceJson);
      return {
        status: voiceReady ? "ok" : "missing",
        id: voice,
        file: voiceFile,
        metadataFile: voiceJson,
      };
    });
    const voicesReady = voices.every((voice) => voice.status === "ok");
    return {
      ok: piper.status === "ok" && voicesReady,
      executable: piper,
      voice: voices[0],
      voices,
      installCommand: options.piperInstallCommand,
      lastAction: lastSupportAction?.action === "install-piper" ? lastSupportAction : null,
    };
  }

  function checkExecutable(command) {
    const candidates = String(process.env.PATH || "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) => path.join(dir, command));
    for (const candidate of candidates) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return { status: "ok", command, path: candidate };
      } catch {
        // Try the next PATH entry.
      }
    }
    return {
      status: "missing",
      command,
      message: `${command} was not found on PATH`,
    };
  }

  function truncateBufferedText(text) {
    const limit = 12000;
    return text.length > limit ? text.slice(text.length - limit) : text;
  }

  function publishPowerIntent(actionState) {
    const now = new Date().toISOString();
    app.handleMessage(plugin.id, {
      context: "vessels.self",
      updates: [
        {
          source: { label: plugin.id },
          timestamp: now,
          values: [
            {
              path: "plugins.ajrmMarinePiController.power.intent",
              value: {
                action: actionState.action,
                requestedAt: actionState.startedAt,
                runAt: actionState.runAt || null,
                graceSeconds: actionState.graceSeconds || 0,
                status: actionState.status,
              },
            },
          ],
        },
      ],
    });
  }

  async function observeScheduledShutdown() {
    const scheduled = await readScheduledShutdown();
    if (!scheduled) {
      lastObservedShutdownKey = null;
      return;
    }
    const action = powerActionForScheduledMode(scheduled.mode);
    if (!action) return;
    const requestedAt = scheduled.requestedAt || new Date().toISOString();
    const runAt = scheduled.runAt || requestedAt;
    const key = `${action}:${runAt}`;
    if (key === lastObservedShutdownKey) return;
    lastObservedShutdownKey = key;
    const graceSeconds = Math.max(0, Math.round((Date.parse(runAt) - Date.now()) / 1000));
    lastAction = {
      action,
      command: "external scheduled shutdown",
      startedAt: requestedAt,
      runAt,
      graceSeconds,
      status: "waiting",
      source: scheduled.source,
    };
    publishPowerIntent(lastAction);
    logInfo(
      `external ${action} detected from ${scheduled.source}; intent published; scheduled for ${runAt}`,
    );
    app.setPluginStatus(`${action} scheduled by ${scheduled.source} for ${runAt}`);
  }

  async function readScheduledShutdown() {
    return await readScheduledShutdownFromSystemd()
      || await readScheduledShutdownFile();
  }

  async function readScheduledShutdownFromSystemd() {
    const stdout = await execFile("busctl", [
      "get-property",
      "org.freedesktop.login1",
      "/org/freedesktop/login1",
      "org.freedesktop.login1.Manager",
      "ScheduledShutdown",
    ], { timeout: 2000 }).catch(() => "");
    const match = String(stdout).match(/^\(st\)\s+"([^"]*)"\s+(\d+)/);
    if (!match || !match[1]) return null;
    const runAtUsec = Number(match[2]);
    const runAt = usecToIso(runAtUsec);
    if (!runAt) return null;
    return {
      mode: match[1],
      runAt,
      requestedAt: new Date().toISOString(),
      source: "systemd",
    };
  }

  async function readScheduledShutdownFile() {
    const text = await fs.promises.readFile("/run/systemd/shutdown/scheduled", "utf8")
      .catch(() => "");
    if (!text.trim()) return null;
    const fields = Object.fromEntries(
      text.split(/\r?\n/)
        .map((line) => line.split("=", 2))
        .filter((parts) => parts.length === 2 && parts[0]),
    );
    if (!fields.USEC || !fields.MODE) return null;
    const runAt = usecToIso(Number(fields.USEC));
    if (!runAt) return null;
    return {
      mode: fields.MODE,
      runAt,
      requestedAt: new Date().toISOString(),
      source: "systemd-scheduled-file",
    };
  }

  function powerActionForScheduledMode(mode) {
    const normalized = String(mode || "").toLowerCase();
    if (normalized === "reboot") return "reboot";
    if (["poweroff", "halt", "shutdown"].includes(normalized)) return "shutdown";
    return null;
  }

  function detachedShell(command) {
    const child = childProcess.spawn("/bin/sh", ["-c", command], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }

  function logInfo(message) {
    console.log(`[${plugin.id}] ${message}`);
  }
};

function execFile(command, args, options) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

function usecToIso(value) {
  const usec = Number(value);
  if (!Number.isFinite(usec) || usec <= 0) return null;
  return new Date(Math.round(usec / 1000)).toISOString();
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
