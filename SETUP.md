# Set up your own assistant

The desktop launcher supports Windows. Each friend runs their own local copy,
with their own models, credentials, settings and memories. No shared server or
paid AI account is required for local chat and voice.

## Install once

- [Git for Windows](https://git-scm.com/downloads/win).
- [Node.js](https://nodejs.org/en/download): Node 22 LTS, version 22.13 or newer.
- [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/):
  complete its WSL 2 setup, enable Linux containers, and open Docker Desktop.
- [Ollama for Windows](https://ollama.com/download/windows): install and open it.

Reopen PowerShell after installing so the commands are on PATH. Internet access
is needed for dependencies and model downloads. Leave enough disk space for
several GB of models plus Docker images. Memory use varies with the model and
other apps; the complete stack can be tight on an 8 GB machine.

## Clone, prepare, launch

Replace the repository URL with the one your friend shared:

```powershell
git clone https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
cd YOUR-REPOSITORY
npm run setup
npm run desktop:start
```

`setup` installs the locked npm dependencies, generates a private `.env.local`,
downloads and verifies Silero VAD, creates the Docker model cache, builds the
voice images, downloads/checks Moonshine and the default Kokoro voice, pulls the
configured Ollama chat model, and builds the app. Initial downloads can take a
while. It stops on errors; fix the reported problem and rerun the same command.
An existing `.env.local` is kept byte-for-byte, including its credentials and
integration settings. Rerunning installs dependencies again and checks/builds
the remaining resources; it does not erase memories or model caches.

The desktop app manages its own local server on port 3002 and starts the voice
services. Open the gear → **General → Assistant name** to rename it and set its
personality. Enable **Use mic / wake word** or hold **Hold to talk**. Allow
Windows microphone access for desktop apps if needed.

For a different local brain, install a model with `ollama pull MODEL_NAME`, then
open **Settings → General → Local brain model · Ollama → Refresh models**.
Select it and click **Save chat model**. The choice persists on your PC and
applies to local chat, planning, workflow generation and desktop preloading.
Use **Ollama · local** in the main Brain menu to force it. Larger models need
more RAM/VRAM; the picker shows disk size, not runtime memory requirements.

Desktop login is automatic. If you use a browser, its login credentials are
`JIMMY_AUTH_USERNAME` and `JIMMY_AUTH_PASSWORD` in your own `.env.local`; setup
does not print them. The files and credentials stay on your PC.

Use the tray → **Shut down … and unload models** when finished. To launch again:

```powershell
npm run desktop:start
```

Optional launch at Windows sign-in:

```powershell
npm run desktop:startup:enable
```

## Optional features

| Feature | Extra setup |
| --- | --- |
| Screen understanding | Run `ollama pull qwen3-vl:2b` (or the model set in `OLLAMA_VISION_MODEL`). |
| Codex / ChatGPT | Follow the Codex sign-in section in [README.md](README.md); each friend uses their own account. |
| n8n and Gmail | Run your own n8n and configure your own API key, workflows and credentials. See [README.md](README.md#local-services). |
| Image generation | Install your own ComfyUI, models and API workflow; fill in the optional `COMFYUI_*` settings. |
| Obsidian memory | Set `OBSIDIAN_VAULT_PATH` to your own vault, or leave blank for local SQLite. |
| Browser activity journal | Follow [browser-extension/README.md](browser-extension/README.md). Recording is opt-in. |
| App locations / website shortcuts | Auto-discovery handles standard Windows installs. Use your own optional paths/links in `.env.local`. |

New `.env.local` files allow localhost only. The main desktop setup is Windows
only; browser and voice-service development details are in [README.md](README.md)
and [voice-service/README.md](voice-service/README.md). To-do day boundaries and
generated n8n workflow schedules currently use Asia/Manila.

## Updating

Shut down the assistant from its tray first, then:

```powershell
git pull --ff-only
npm run setup
npm run desktop:start
```

Your `.env.local` and `storage/` data are not replaced. If you moved the project,
rerun `npm run desktop:startup:enable` to refresh an enabled startup task's path.

## If something fails

- **Command not found:** finish the prerequisite installation and reopen PowerShell.
  If PowerShell blocks `npm.ps1`, use `npm.cmd` in place of `npm`.
- **Docker unavailable:** open Docker Desktop, finish WSL setup, and wait for its
  Linux engine. Run `docker info` to see Docker's own error.
- **Ollama unavailable:** open Ollama and check `ollama list`.
- **Download/build failed:** check your connection and free disk space, then
  rerun `npm run setup`. No manual credential regeneration is needed.
- **Port 3002 occupied:** shut down the other assistant instance before launching.
- **Voice cannot start:** inspect `npm run voice:logs` and
  `.jimmy-runtime/desktop-server.log`; choose **Retry startup** in the tray after
  fixing the issue. Setup checks the default voice; selecting another voice may
  need a first-use download.

## Publishing this repository to GitHub

Create an empty GitHub repository, then run these from this project directory:

```powershell
git add .
git diff --cached --name-only
git diff --cached
git commit -m "Prepare assistant for shared setup"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```

Review the staged changes before committing. Include the source, lockfile,
`.env.local.example`, fonts with their license, and the setup script. `.gitignore`
excludes `.env.local`, all `storage/` data, runtime logs/Codex sessions, model
binaries, dependencies, build output and local agent/credential directories.
Share the GitHub URL, not a zip of your working folder. Your friends generate
their own secrets and connect their own integrations.

If your Git remote or branch already exists, use those existing settings rather
than repeating the corresponding creation commands. Ignoring a file does not
remove it from existing commits; inspect any existing history before publishing.
