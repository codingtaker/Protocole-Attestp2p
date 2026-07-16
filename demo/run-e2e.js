#!/usr/bin/env node
// Lanceur portable de la démo end-to-end (demo/sprint4-e2e.sh).
// - Windows : utilise Git Bash (C:\Program Files\Git\bin\bash.exe) et NON le
//   bash.exe de WSL (qui n'est pas un shell POSIX complet).
// - Linux / macOS : utilise le bash du système.

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const script = path.join(__dirname, "sprint4-e2e.sh");

function findBash() {
  if (os.platform() !== "win32") return "bash";
  const candidates = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Git", "bin", "bash.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Git", "bin", "bash.exe"),
    process.env.ProgramW6432 && path.join(process.env.ProgramW6432, "Git", "bin", "bash.exe"),
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ].filter(Boolean);
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch {} }
  // Dernier recours : dériver depuis l'emplacement de git.
  try {
    const r = spawnSync("where", ["git"], { encoding: "utf8" });
    if (r.status === 0) {
      const gitExe = r.stdout.split(/\r?\n/)[0].trim();          // ...\Git\cmd\git.exe
      const guess = path.join(path.dirname(gitExe), "..", "bin", "bash.exe");
      if (fs.existsSync(guess)) return guess;
    }
  } catch {}
  return null;
}

const bash = findBash();
if (!bash) {
  console.error("Git Bash introuvable sur Windows. Installez Git for Windows (https://git-scm.com/download/win),");
  console.error("ou lancez manuellement depuis PowerShell :");
  console.error("  & 'C:\\Program Files\\Git\\bin\\bash.exe' demo/sprint4-e2e.sh");
  process.exit(1);
}

const res = spawnSync(bash, [script], { stdio: "inherit" });
process.exit(res.status == null ? 1 : res.status);
