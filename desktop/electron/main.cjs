const path = require("path");
const fs = require("fs");
const http = require("http");
const net = require("net");
const { spawn } = require("child_process");
const { app, BrowserWindow, dialog } = require("electron");

const DEFAULT_API_PORT = Number(process.env.SURTAAL_API_PORT || "8000");
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEV_BACKEND_DIR = path.join(REPO_ROOT, "backend");
const APP_FRONTEND_DIST = path.join(REPO_ROOT, "frontend", "dist", "index.html");

let backendProcess = null;
let mainWindow = null;
let apiPort = DEFAULT_API_PORT;
let apiBase = `http://127.0.0.1:${DEFAULT_API_PORT}`;

function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, "127.0.0.1");
  });
}

async function chooseApiPort(startPort = DEFAULT_API_PORT, attempts = 20) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const candidate = startPort + offset;
    if (await isPortFree(candidate)) {
      return candidate;
    }
  }
  throw new Error("Could not find a free localhost port for the Surtaal backend.");
}

function backendLaunchOptions() {
  const packagedBackendExe = process.platform === "win32"
    ? path.join(process.resourcesPath, "backend-dist", "surtaal-backend", "surtaal-backend.exe")
    : path.join(process.resourcesPath, "backend-dist", "surtaal-backend");

  if (app.isPackaged) {
    if (fs.existsSync(packagedBackendExe)) {
      return { command: packagedBackendExe, args: [], mode: "packaged" };
    }

    throw new Error(
      "This Windows build does not include the packaged Surtaal backend yet. " +
      "Rebuild the app after running the Windows backend bundling step " +
      "(`npm run desktop:build:backend:win`) and including the desktop runtime binaries."
    );
  }

  const candidates = [
    { command: path.join(DEV_BACKEND_DIR, "venv", "Scripts", "python.exe"), args: [], mode: "python" },
    { command: path.join(DEV_BACKEND_DIR, "venv", "bin", "python"), args: [], mode: "python" },
    { command: "python", args: [], mode: "python" },
    { command: "python3", args: [], mode: "python" },
    { command: "py", args: ["-3"], mode: "python" },
  ];

  return candidates.find((candidate) => {
    if (candidate.command.includes(path.sep)) {
      return fs.existsSync(candidate.command);
    }
    return true;
  });
}

function runtimePaths() {
  const runtimeRoot = app.isPackaged
    ? path.join(app.getPath("userData"), "runtime")
    : path.join(REPO_ROOT, ".desktop-runtime");

  const uploads = path.join(runtimeRoot, "uploads");
  const outputs = path.join(runtimeRoot, "outputs");
  const models = path.join(runtimeRoot, "models");
  const bins = app.isPackaged
    ? path.join(process.resourcesPath, "bin")
    : path.join(REPO_ROOT, "desktop", "vendor", "bin");

  [runtimeRoot, uploads, outputs, models].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));

  return { runtimeRoot, uploads, outputs, models, bins };
}

function waitForBackend(timeoutMs = 20000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const poll = () => {
      const req = http.get(`${apiBase}/health`, (res) => {
        if (res.statusCode === 200) {
          res.resume();
          resolve();
          return;
        }
        res.resume();
        retry();
      });

      req.on("error", retry);
      req.setTimeout(1500, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("Timed out waiting for the Surtaal backend."));
        return;
      }
      setTimeout(poll, 400);
    };

    poll();
  });
}

async function startBackend() {
  const launch = backendLaunchOptions();
  if (!launch) {
    throw new Error("Could not find a Python runtime for the Surtaal backend.");
  }

  apiPort = await chooseApiPort();
  apiBase = `http://127.0.0.1:${apiPort}`;
  const paths = runtimePaths();
  const backendDir = launch.mode === "packaged"
    ? path.dirname(launch.command)
    : DEV_BACKEND_DIR;

  const backendArgs = launch.mode === "packaged"
    ? launch.args
    : [...launch.args, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(apiPort)];

  backendProcess = spawn(
    launch.command,
    backendArgs,
    {
      cwd: backendDir,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        SURTAAL_API_BASE: apiBase,
        SURTAAL_API_PORT: String(apiPort),
        SURTAAL_API_HOST: "127.0.0.1",
        SURTAAL_UPLOAD_DIR: paths.uploads,
        SURTAAL_OUTPUT_DIR: paths.outputs,
        SURTAAL_MODEL_DIR: paths.models,
        SURTAAL_BIN_DIR: paths.bins,
      },
      stdio: "inherit",
      windowsHide: true,
    }
  );

  backendProcess.once("error", (error) => {
    const detail = launch.mode === "packaged"
      ? error.message
      : `Could not start the Python backend (${error.message}).`;

    dialog.showErrorBox("Surtaal backend could not start", detail);
    if (!app.isQuitting) {
      app.quit();
    }
  });

  backendProcess.on("exit", (code) => {
    backendProcess = null;
    if (!app.isQuitting && code !== 0) {
      dialog.showErrorBox(
        "Surtaal backend stopped",
        `The background audio engine exited unexpectedly with code ${code ?? "unknown"}.`
      );
    }
  });

  await waitForBackend();
}

async function createWindow() {
  if (mainWindow) {
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1200,
    minHeight: 820,
    backgroundColor: "#121218",
    title: "Surtaal",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--surtaal-api-base=${apiBase}`],
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    dialog.showErrorBox(
      "Surtaal desktop could not load",
      `Failed to load ${url || "the frontend"} (${code}): ${description}`
    );
  });

  if (process.env.SURTAAL_ELECTRON_DEV_URL) {
    await mainWindow.loadURL(process.env.SURTAAL_ELECTRON_DEV_URL);
    return mainWindow;
  }

  const frontendDist = APP_FRONTEND_DIST;

  if (!fs.existsSync(frontendDist)) {
    throw new Error("Frontend build missing. Run `npm --prefix frontend run build` first.");
  }

  await mainWindow.loadFile(frontendDist);
  return mainWindow;
}

function stopBackend() {
  if (!backendProcess) return;
  backendProcess.kill();
  backendProcess = null;
}

app.on("before-quit", () => {
  app.isQuitting = true;
  stopBackend();
});

app.whenReady().then(async () => {
  try {
    await startBackend();
    await createWindow();
  } catch (error) {
    dialog.showErrorBox("Surtaal desktop could not start", error.message);
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    try {
      await createWindow();
    } catch (error) {
      dialog.showErrorBox("Surtaal desktop could not reopen", error.message);
    }
  }
});

app.on("window-all-closed", () => {
  stopBackend();
  app.quit();
});
