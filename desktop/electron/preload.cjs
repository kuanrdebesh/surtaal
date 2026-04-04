const { contextBridge } = require("electron");

function findArg(prefix) {
  return process.argv.find((arg) => arg.startsWith(prefix)) || "";
}

const apiBaseArg = findArg("--surtaal-api-base=");

contextBridge.exposeInMainWorld("surtaalDesktop", {
  apiBase: apiBaseArg ? apiBaseArg.replace("--surtaal-api-base=", "") : "http://127.0.0.1:8000",
});
