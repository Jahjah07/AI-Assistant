# Jimmy Local AI Assistant

Jimmy is a local-first Next.js assistant UI with a arc reactor clock, voice wake word, Ollama chat, Moonshine streaming transcription, YouTube playback, ComfyUI image generation, app launching, memory, and optional web facts.

## First-time Windows setup

Install Git, Node.js 22.13+, Docker Desktop (WSL 2 / Linux containers), and Ollama.
Open Docker Desktop and Ollama, then in your cloned project run:

```powershell
npm run setup
npm run desktop:start
```

Setup generates your own credentials and prepares dependencies, voice models,
Docker images and the app build. Existing `.env.local` files are preserved.
See **[SETUP.md](SETUP.md)** for clone instructions, optional integrations,
updates, troubleshooting and publishing to GitHub. Each friend gets their own
assistant and can rename it in **Settings → General**.

Change the UI accent in **Settings → General → UI color**. The picker updates
the reactor, controls, panels and canvas immediately and saves the color for
that browser or desktop profile. **Restore cyan** returns to the original color.

Settings uses a readable system font by default. Under **General → Settings font**,
choose System default, Arial, Verdana, Monospace or Orbitron. You can also upload
a WOFF, WOFF2, TTF or OTF file up to 1 MiB. Font choices and uploaded files stay
in your current browser or desktop profile, survive restarts, and apply across
the settings sections. **Remove uploaded font** removes the local copy. Other
parts of the interface keep their existing fonts.

Say **Open dashboard** or **Show dashboard** to open the full interface.
**Circle mode** returns to the floating reactor. **Minimize** hides the assistant
and its canvas to the Windows tray while voice listening continues if enabled;
it does not switch to circle mode. The toolbar’s **−** button also minimizes,
and **○** switches to circle mode. Say your assistant’s name followed by
**open dashboard**, or use the tray icon/menu, to bring it back.

Choose a local brain in **Settings → General → Local brain model · Ollama**.
Select an installed text-generation model and click **Save chat model**. To add a
model, run `ollama pull MODEL_NAME`, then click **Refresh models**. The selection
is saved on that PC and takes effect for the next local chat, plan or generated
workflow, without restarting. The main **Brain** menu’s **Ollama · local** choice
uses it; Auto uses it whenever a request is routed locally. Codex continues to
use the connected ChatGPT account.

The saved model overrides `OLLAMA_MODEL`, which remains the initial default.
Switching unloads the previous chat model; **Keep voice and chat models loaded**
also preloads the new selection. Model sizes in the picker are disk sizes, not
RAM/VRAM requirements. Choose a model your hardware can run with the app’s chat
context; embedding-only and cloud models cannot be saved as the local brain.

## Run

For browser development after setup:

```bash
npm run dev
```

Open `http://localhost:3000`.

Use Node.js 22.13 or newer for the built-in SQLite backend.

The microphone starts off. Hold **Hold to talk** (or focus it and hold Space/Enter),
wait for **Listening**, then speak and release. No wake word is needed. The existing
voice service finishes transcription after a short silence. **Use mic / wake word**
enables continuous listening for “Jimmy”; press it again to disable capture.

The **Brain** selector defaults to **Auto**. Everyday chat goes to the selected local Ollama model
Instruct; coding requests and explicitly complex/in-depth tasks go to Codex when
connected. Short follow-ups keep the preceding task's route. New topics are routed
again. **Last reply** shows the actual brain and any fallback reason. You can force
**Ollama · local** or **Codex · ChatGPT account** at any time.

Auto uses simple text rules, so ambiguous requests can be misclassified. It falls
back to the selected local model if Codex is not signed in or cannot start the reply; failures after
streaming begins are shown as errors. Local commands still run directly. To enable Codex:

1. Install [Codex CLI](https://learn.chatgpt.com/docs/cli) if it is not already installed: `npm install -g @openai/codex`.
2. Open Jimmy on localhost, choose **Codex · ChatGPT account**, and click **Sign in with ChatGPT**.
3. Follow **Continue to ChatGPT sign-in**, complete the browser login, and return to Jimmy. It will show **ChatGPT connected**.

No OpenAI API key is required. Your account needs Codex access, and ChatGPT plan
usage limits apply. Optional `CODEX_MODEL` selects a model; leave it unset to use
Codex's default. For a nonstandard installation, set `CODEX_CLI_PATH` to the native
executable or npm JS entrypoint. Chat and up to 30 selected saved memories are sent to
OpenAI when Codex is selected manually or by Auto. Select Ollama to keep model chat local.

Jimmy stores its separate Codex session under `.jimmy-runtime/codex` (gitignored).
Signing out of Jimmy leaves your IDE/CLI login alone. Sign-in controls are available
only through localhost. Codex runs with shell, apps, plugins, web search, and agent
tools disabled where supported, in a restricted read-only sandbox. Local commands
continue through Jimmy's existing handlers. Conversations use ephemeral Codex threads.

Keyboard push-to-talk: use **Tab** to focus **Hold to talk**, hold **Space** or
**Enter**, then release to send. These keys work while that button is focused;
they are not system-wide shortcuts. Pointer/touch holding also works. Moving focus
away or switching windows stops capture. Wait for **Listening** before speaking.

To change personality, open the gear (**Voice settings**), edit **Personality**, and
click **Save personality**. For example:

> Call me Jahred. Be calm, warm, and lightly witty. Use short conversational replies. Explain technical topics clearly and avoid calling me Sir.

This is saved per browser and sent to local Ollama or Codex on the next chat request.
It changes tone, wording, and how Jimmy addresses you; the accent/voice chooser
changes the actual speaking voice. Direct-command acknowledgements and voice previews
keep their existing wording. Empty personality text restores the default friendly,
concise “Sir” style. The limit is 1,200 characters.

Existing `JOHNNY_*` environment settings and saved voice preferences still work;
new configuration uses `JIMMY_*`. The workspace folder can keep its current name.

Jimmy requires HTTP Basic authentication. Configure a unique username,
password, and explicit host allowlist in `.env.local`:

```env
JIMMY_AUTH_USERNAME=jimmy
JIMMY_AUTH_PASSWORD=replace-with-a-long-random-password
JIMMY_ALLOWED_HOSTS=localhost,127.0.0.1,192.168.1.57
```

Your browser will prompt once for these credentials. Add a temporary ngrok
hostname to `JIMMY_ALLOWED_HOSTS` before using a tunnel. Local application
launch and close commands remain restricted to localhost even when other
features are available over LAN or a tunnel. Network access must use HTTPS so
Basic Auth credentials are never sent over plain HTTP.

For LAN testing with another device:

```bash
npm run dev:https
```

Open `https://YOUR_PC_LAN_IP:3000`. Phone microphone access requires a secure browser origin. If the phone does not trust the self-signed HTTPS certificate, the browser may still block the mic.

For phone microphone testing through ngrok, use production mode instead of `npm run dev`:

```bash
npm run build
npm run start:lan
```

In another terminal:

```bash
ngrok http 3000
```

Open the HTTPS ngrok URL on the phone. Production mode avoids Next.js dev HMR requests like `/_next/webpack-hmr`, which can be unreliable through tunnels.

## Local Services

### Create n8n workflows

Say **“Jimmy, create an n8n workflow that…”** or type the same request in chat.
For example: **“Create an n8n workflow with a manual trigger that sets a message
to Hello from Jimmy.”** Jimmy first plans the workflow with local Qwen, asking
one clarifying question at a time when needed. Answer in chat or by voice;
say “Jimmy” before a spoken answer if the follow-up window has expired. Once
Jimmy shows the plan, say **“Create it”** or use the **Create it** button to save
an inactive draft in n8n. Requests such as “Create a Gmail workflow” and
“I want you to create a workflow that…” also enter planning without requiring
the word n8n. You can revise the plan before confirming, or say
**“Cancel plan”**. The saved draft's reply includes **Open workflow in n8n**.

Say **“Jimmy, plan…”** to explicitly start planning another task. Workflow
requests automatically enter planning; simple commands such as fullscreen still
execute immediately. Planning other tasks produces a conversational plan and
does not automatically execute those tasks. Plans are kept for the current
session and cleared by cancellation, successful creation, or page reload.
Failed creation keeps the plan available. If ordinary chat already discussed
a workflow, “Create it” can use the recent conversation; without clear context,
Jimmy asks for the workflow requirements instead of claiming he lacks the tool.

Set `N8N_URL=http://localhost:5678` and `N8N_API_KEY` in `.env.local`, then restart
Jimmy. Create the key in n8n under **Settings → n8n API**. Keep it server-only;
do not use a `NEXT_PUBLIC_` variable or paste it into chat. The key is sent only
to the configured n8n API, never to Qwen or the browser.

This tool creates new **inactive drafts**; it does not activate, run, update, or
delete workflows. It supports common built-in nodes and ordinary main
connections, including Manual Trigger, Edit Fields, HTTP Request, Schedule,
Gmail, IF, Merge, Code, Webhook, and Google Sheets. Credentials must be selected
in n8n after creation. Review node settings before running a draft; generated
parameters for complex workflows can require corrections. Requests are limited
to 20 nodes. If creation times out, check n8n before retrying to avoid duplicates.

Run `node tests/n8n-workflow.mjs` for the mocked checks. The opt-in live check
`$env:VERIFY_LIVE_N8N='1'; node tests/n8n-live.mjs` creates and leaves one inactive
**Jimmy API test** workflow in the configured n8n instance.

### Screen understanding

Say **“Jimmy, can you see my screen?”**, **“Jimmy, describe my screen”**, or type
the same command. The desktop app captures one snapshot of the monitor Jimmy
is on and uses local Ollama vision to describe it. In a browser, the command
asks you to click **Share screen** and choose a screen, window, or tab. The
capture stream stops immediately after the snapshot. You can also click
**Look at screen** in the expanded desktop app.

Install the separate vision model with `ollama pull qwen3-vl:2b` (about 1.9 GB).
Set `OLLAMA_VISION_MODEL` to choose another Ollama image-capable model.
The default text model remains `qwen3:4b-instruct`. Screen images are sent only
to local Ollama and are not saved to disk by Jimmy. The description appears
in chat and is spoken; it can be included in later chat context according to
the selected Brain. No background screen monitoring is performed. The vision
model unloads after each request to reduce memory use, so the next capture may
have a cold-start delay. Small text may be unreadable, and descriptions can be
wrong. Restart/rebuild the desktop app after adding this feature.

### Laptop hardware and GPU acceleration

Verified on 14 October 2026: Lenovo model 83DV, Intel Core i5-13450HX
(10 cores / 16 threads), 8 GB DDR5-5600 RAM, NVIDIA RTX 4050 Laptop GPU
(6 GB VRAM), and Intel UHD integrated graphics. This laptop has no AMD GPU.
Ollama 0.40.4 automatically loaded `qwen3:4b-instruct` with **100% GPU**
execution at a 4,096-token context; no GPU override or AMD backend is needed.
Chat now requests a 16,384-token context to accommodate instructions, history
and email pages. The measurements here used 4,096 tokens; the larger context
can increase memory use and affect GPU allocation or speed.
Use `ollama ps` while the model is loaded to check its processor allocation.

Two short direct Ollama tests generated about 58–59 tokens/second. The first
request took 45 seconds, including 26.5 seconds of model loading; the warm
request generated 199 tokens in 3.86 seconds with 0.02 seconds of load time.
The loaded model occupied about 3.2 GB according to `ollama ps`; total GPU
memory usage was about 4.1 GB including other applications. The model runner's
Windows working set was approximately 481 MB, excluding GPU memory.

System RAM is the current constraint: Windows reported only 0.45–0.69 GB
available during the checks. Overall CPU snapshots ranged from 12–39% and
include other applications; these are not Jimmy-only measurements. Voice
containers were stopped during these tests, so these figures do not measure
the complete microphone-to-speech pipeline. Close unused applications and
unrelated containers when RAM is tight. Jimmy's Silero, Moonshine, and Kokoro
services currently run on CPU; Qwen uses the NVIDIA GPU through Ollama.

The gear button opens Jimmy’s settings with **Voice**, **Audio devices**, and
**General** sections. The message bubble beside it shows or hides the floating
conversation panel without moving the reactor. You can also close the panel
with its close button or press Escape while typing; drafts are preserved.
The conversation scrollbar uses Jimmy’s cyan theme.
Voice includes Kokoro voice and accent selection with previews.
Audio devices lets you switch microphones and Jimmy’s speech output immediately,
without restarting. Choices are saved for this browser; **System default** follows
your default device. Allow microphone access to reveal device names, or refresh
after connecting hardware. Speaker selection requires a supported browser on
HTTPS or localhost and applies to Jimmy’s speech and previews, not YouTube.
If a saved device is unavailable, select another device or System default.
**Use laptop speakers** selects a matching physical built-in/Realtek output;
when labels are unavailable or ambiguous, choose the exact device manually.
**Jimmy voice volume** changes speech and voice previews only and is saved
separately from music volume. Choosing a physical voice output keeps speech there
when Windows changes its default after a Bluetooth connection. If that output
becomes unavailable, Jimmy reports it and keeps the reply in chat rather than
silently switching to another speaker.

For Bluetooth music plus quiet laptop speech: open **Audio devices → Pair /
connect Bluetooth device**, pair/connect in Windows, then use **Open Windows
volume mixer** to select the Bluetooth output for your music app. Back in Jimmy,
select your laptop speakers and reduce Jimmy voice volume. Windows handles the
Bluetooth pairing/connection; these buttons open its settings and do not silently
pair hardware or change the music app's output. Supported voice/chat commands:

- “Jimmy, open Bluetooth settings.”
- “Use laptop speakers for your voice.”
- “Speak through Headphones.” (use a unique available output name)
- “Set your voice volume to 30 percent.”
- “Open Windows volume mixer.”

General includes personality and chat visibility. Microphone capture is paused
while settings are open.

Jimmy handles these voice controls directly, without an Ollama request:

- “Jimmy, fullscreen” or “Jimmy, show full dashboard” opens the expanded desktop
  interface across the monitor’s usable area and shows chat. The window refits
  when moved between monitors or when display scaling changes, and panels scale
  to the available width and height. “Jimmy, circle mode” or “Jimmy, go small” returns
  to the small circle at its previous position.
  These commands also work in typed chat. In a browser, the full-dashboard command
  reveals chat; compact circle mode requires the desktop app.
  Opening apps, browser shortcuts, searches, or YouTube automatically returns
  the desktop app to its small circle before launch so you can see the screen.
  Planning and ordinary conversation keep your chosen window size.
- The dashboard shows live CPU load, RAM use, GPU load, and VRAM use on the left
  (across the top on narrow screens). Readings describe the computer hosting Jimmy
  and refresh every five seconds while visible. NVIDIA GPU readings use
  `nvidia-smi`; unavailable GPU telemetry is shown as a dash. Monitoring stops
  when the desktop is collapsed to the small circle.
  Colored trend lines and usage bars show up to three minutes of CPU, RAM, GPU
  and VRAM history. The history stays in this dashboard session, uses a fixed
  0–100% scale, and leaves gaps for missing readings or suspended polling.
- Backend status appears below the resource readings for Kokoro TTS, Silero VAD,
  Moonshine STT, Ollama, the configured chat and vision models, and ComfyUI.
  Checks use the existing refresh cycle and do not load models. Kokoro and
  Moonshine show Online when ready, Loading during startup, or Standby while
  waiting to load. Chat and vision show Online when loaded in Ollama, Standby
  when installed but unloaded, or Missing when not installed. Their configured
  model names appear below their labels. Silero
  shows Online when the voice service's health check reports Silero available;
  unreachable services show Offline. ComfyUI reports service availability, not
  whether an image model is loaded. Codex sign-in status remains in its account
  controls; these local checks cannot verify cloud model availability.

- “Stop speaking” stops current and queued speech and cancels an ongoing chat reply.
- “Repeat that” repeats the last answer, skipping wake-up and settings acknowledgments.
- “Speak slower” reduces playback speed; “Speak faster” and “Speak at normal speed”
  increase or reset it. Speed is saved in this browser and applies to Kokoro,
  and previews.
- “Change your voice to George” selects any of the 28 English Kokoro voices by
  name. The choice is saved in the same setting as the gear-button voice chooser.
- “What can you do?” lists the available commands.

Say “Jimmy” before a voice command or use the follow-up window after a reply.
During playback, “Stop speaking” also works without the wake word; other
interrupting controls require “Jimmy”. These commands also work in the chat box.

- Ollama: used for chat through `/api/ollama-chat`.
- Moonshine Streaming Small: live speech-to-text after Silero VAD, with partial
  transcripts while speaking. Run `npm run voice:up`.
- ComfyUI: used for image generation through `/api/comfy-image`.
- YouTube: embedded in the app through the iframe player.

Spoken replies omit Markdown markers and emojis. Markdown links use their visible
title; bare URLs use the site name instead of reading the address. Chat keeps the
original response. This cleanup also applies to plans and repeated replies.

Ollama replies stream into the chat and are spoken sentence by sentence. Jimmy
keeps the model loaded for 30 minutes by default to avoid repeated cold starts;
configure this with `OLLAMA_KEEP_ALIVE`.

### Chat model

Setup installs `qwen3:4b-instruct` by default. Choose another installed model in
**Settings → General → Local brain model · Ollama** and click **Save chat model**;
no restart is needed for this setting. `OLLAMA_MODEL` in `.env.local` supplies
the default when no selection has been saved. The desktop wake-up and shutdown
routines use the same saved model setting.

Use the explicit `4b-instruct` tag for short spoken replies. The `qwen3:4b`
tag currently selects the thinking variant, which can spend substantial time
reasoning before returning an answer. Jimmy streams only `message.content`
to chat and speech, never the separate `message.thinking` field.

Run `node scripts/compare-models.mjs` to compare Llama 3.2 with Qwen on a small
set of local assistant prompts. It reports timing and responses, including a
simulated tool request; it never executes that tool. Review answer quality
manually as well as the simple automated checks. This is a smoke comparison,
not a general intelligence benchmark. The script unloads each tested model
afterward, so run it while Jimmy is idle.

To switch back, set `OLLAMA_MODEL=llama3.2:latest` and restart Jimmy. Changing
models does not add autonomous laptop tools; those need a separate execution loop.

Kokoro-82M runs on CPU and prepares the next sentence while the current one plays.
Only one sentence is buffered ahead, with one synthesis request active at a time.
Stopping speech cancels pending preparation and discards buffered audio. Pauses
can still occur if synthesis takes longer than playback. Choose an English
voice in settings or set `KOKORO_VOICE` in `.env.local`.

The voice path is microphone → Silero VAD → Moonshine Streaming Small → partial
transcripts → final transcript → command handling / Ollama → Kokoro. Only final
transcripts execute commands. Service failures display an error; typed chat and
commands remain available. Reload after services are ready to reconnect.

`npm run dev` and `npm start` launch only Next.js. Start Ollama and run
`npm run voice:up` before using the microphone.

## Reactor UI

The cyan reactor displays local time and date while idle, and JIMMY while
preparing a reply or speaking. Rings rotate slowly while idle or listening, speed up during preparation, and
switch to illuminated moving segments while speaking. Animations respect reduced
motion settings. SVG/CSS replaces the previous WebGL ripple renderer.

## Voice Flow

- Start the loopback real-time service with `npm run voice:up`. Its detailed
  setup and hardware notes are in [`voice-service/README.md`](voice-service/README.md).
- Say `Jimmy` or `Hey Jimmy` to wake the assistant.
- If you only say the wake word, Jimmy asks what you need and listens for a follow-up command.
- After a successful command, Jimmy keeps a short follow-up window open so you can say another command without repeating `Jimmy`.

## Commands

### Data canvas

Jimmy has a separate black workspace for lists, tables, bar/line charts and flow
diagrams. Say **“Jimmy, open canvas”** or use **Open canvas**. Data opens there
automatically, while chat and speech keep the explanation. **Show on canvas**
reopens a visual attached to a chat reply. Say **“hide canvas”** to dismiss it.

- “Check my emails” shows the actual returned page as a table.
- “What's in my to-do list?” shows saved tasks with their times and status.
- “Graph these expenses: January 120, February 90, March 150” creates a chart.
- “Diagram this process: collect → review → approve” creates a flow diagram.
- “Graph that table” supplies the current canvas as context for a follow-up.

The desktop opens a separate resizable window and returns Jimmy to circle mode.
In a browser, blocked popups fall back to an accessible full-screen canvas;
**Open separate window** retries from a direct click. Escape closes the fallback.
Tables scroll horizontally on small screens, and charts include a readable data
table. Diagram relationships are also available as text.

Source tool data bypasses the model on its way to the canvas. Additional visuals
derived from that data are labeled as Jimmy's interpretation. Both chat providers
receive the visual-format instructions; ordinary Markdown lists/tables are also
moved out of chat. Invalid visual output is shown as text on the canvas with a
formatting notice. No generated HTML, scripts or remote diagram renderer runs.

The canvas matches Jimmy’s cyan reactor theme, with a dark grid and framed data
panels. On Windows, right-click Jimmy’s tray icon → **Open canvas** to open or
restore it. **Hide canvas to tray**, the window’s X, and **Close canvas** hide it
without clearing its contents; Jimmy’s shutdown closes it completely.

Canvas data stays in memory for the current Jimmy session, using a private
session channel shared with its canvas window. It is not saved to browser storage
or published. Reloading the canvas reconnects while Jimmy remains open. Canvas
follow-ups use local Qwen in Auto; explicitly choosing Codex can send that context
to your connected account, as with other chat data.

Each visual supports up to 12 sections, 200 rows/items, 16 table columns, 60 chart
points or 30 diagram nodes. Tool data beyond these display limits is explicitly
marked, and long cells are shortened. Gmail pagination remains available through
“next page of emails”; a displayed page is never labeled as the whole mailbox.
Canvas follow-ups send at most 12,000 characters with an incomplete-excerpt notice.
All saved to-do tasks remain available in Settings → To-do list.

Use **Open 3D model** in the canvas to display a local `.3mf`, `.glb`, or `.stl`
file up to 50 MB on the dashboard. The other dashboard controls disappear,
leaving the model centered over the dashboard background and the reactor shrinking
into the bottom-right corner. The reactor keeps its text, clock, status and date;
its corner size and typography keep those readable. The model has no separate
background, frame, labels or visible controls. Drag to rotate,
scroll to zoom, or right-drag to pan. Arrow keys rotate, plus/minus zoom, and Home
resets the view. Press Escape or click the corner reactor to restore the dashboard.
You can also say **“close the model”**, **“hide this 3D model”**, **“go back to the
dashboard”**, or **“return to dashboard”**. These use the same dashboard action and
work in combined window commands too.
Reduced-motion preferences disable the transition. Desktop models use the expanded
dashboard window.
Files stay on your computer and are not sent to the chat model. Close a model to
release its graphics resources, then choose the file again to reopen it.
The viewer loads on demand and renders only when the view changes. Printer settings,
animations, and some slicer-specific 3MF extensions are not previewed. GLB textures
must be embedded. Compressed file size does not bound memory use for complex models.

You can also ask **“Jimmy, find gengar-keycap in my Downloads and show it on the
canvas”**, **“find a file called invoice”**, **“what's making my storage full?”**,
or **“analyze storage in Downloads”**. These are examples, not required wording.
Jimmy uses the selected local Ollama model to interpret file/storage requests:
**“Could you dig up that gengar-keycap model I downloaded?”** and **“My laptop is
nearly out of room—figure out what's eating it”** work too. Short follow-ups such
as **“Maybe Desktop instead”** reuse the previous file request. If a filename is
missing, Jimmy asks for it, and you can answer with just the name. Interpretation
uses only your request and the previous file-request context, never scan results.
Ollama must be available for this interpretation; other commands keep their existing
routing, and **“cancel scan”** remains immediate.
Search ignores filename capitalization,
spaces and punctuation. If the full name has no match, Jimmy shows up to 20 possible
matches sharing a distinctive word, so a misheard name such as “Gengar K-Cups” can
still suggest `gengar-keycap.3mf`. Suggestions require choosing **Show model**;
they never open automatically. Repeated “find…” requests keep the previous search
folder unless you supply a different location. A single matching 3D file opens automatically; multiple
matches appear with **Show model** buttons. Preview access expires after 15 minutes;
search again if a preview expires or Jimmy restarts. Other files are listed with
their paths and sizes; they are not executed or opened as documents.

Laptop commands require authenticated localhost access. They scan local fixed
drives, a named personal folder, or an absolute local folder path. Downloads and
other personal folders follow Windows folder redirection. Scans skip links and
inaccessible entries and stop after 20 seconds or 150,000 entries. Partial results
are labeled; scan a smaller folder to investigate further, or say **“cancel scan”**.
Storage reports show disk capacity, the largest scanned folder groups and largest
files. Logical file totals can differ from allocated disk usage, especially for
cloud placeholders, sparse files and hard links. Nothing is deleted or modified,
and file listings are excluded from AI follow-up context. The text you type and
the brief spoken summary still follow ordinary chat behavior.

Run `node tests/local-files.mjs` for fixture-based search, storage, cancellation,
preview access, mocked natural-language interpretation and endpoint security checks.
Add `--live-intent` to check paraphrases and clarifications against local Ollama
without scanning personal files.
Run `node tests/model-viewer.cjs` for browser-based 3MF/GLB/STL loader, WebGL,
file validation and cleanup checks. Run `node tests/canvas.mjs` for schema/parser/stream checks and
`node tests/compact-layout.cjs --canvas` for isolated Electron rendering,
window synchronization and chat/data separation checks using mocked APIs.

### UI

Rename your assistant in **Settings → General → Assistant name → Save name**.
The desktop starts wake-word listening automatically. Switching **Wake-word mic on**
off saves that choice across restarts; click **Use mic / wake word** to enable it
again. The reactor shows **Wake-word mic off** or **Connecting microphone…** until
listening is available. Browser microphone access still starts from a direct click.
Run `node tests/compact-layout.cjs --wake` to check startup, saved mic preferences,
wake acknowledgement and mute using simulated audio.
Window commands can be combined with **and**, **then**, **and then**, or a semicolon:
**“Close canvas and open dashboard”** closes the canvas and restores the dashboard,
including exiting the focused model view. Up to four canvas/dashboard/circle/tray
actions run in order with one spoken reply. Every step must be recognized before
the sequence runs; task titles and saved notes containing “and” stay intact.
The name updates the reactor, chat, canvas, Windows tray labels, AI identity,
and spoken wake name immediately. For example, say “Nova, open canvas”.
The saved name is the wake word and is also used in voice previews. Long names
automatically scale to fit the reactor. Names are saved in local site storage,
separately for each browser/desktop profile, so your friend can choose their own.
Renaming keeps existing settings and data. Project folders, environment variables,
API names, and Windows startup task names keep their existing identifiers.

- `hide chat`
- `show chat`
- `show messages`
- `hide image`
- `close image viewer`
- `show the player`
- `hide the player`
- `clean UI`
- `clear screen`
- `hide everything`

`clean UI` hides the chat, YouTube player, and image viewer. It does not stop Jimmy or stop YouTube playback.

### YouTube

- `play [song or video] on YouTube`
- `pause it`
- `resume it`
- `next song`
- `skip this`
- `stop the video`
- `lower volume`
- `mute it`
- `replay it`
- `play something similar`
- `show the player`
- `hide the player`

### Images

- `generate an image of [prompt]`
- `create an image of [prompt]`
- `draw [prompt]`
- `make another image`
- `hide image`
- `close image viewer`

### Apps

- `open Brave`
- `close Brave`
- `open Chrome`
- `close Chrome`
- `open Visual Studio Code`
- `close Visual Studio Code`
- `open Steam`
- `close Steam`
- `open Roblox`
- `close Roblox`
- `launch Valorant`
- `open [installed app name]`
- `close all apps`

For other app names, Jimmy searches the user's and shared Start menu and desktop
shortcuts, plus Windows Store app registrations. This includes executable app
shortcuts and Steam/Epic game shortcuts, preserving their launcher arguments.
Existing website shortcuts still open in your browser. If several apps match,
Jimmy asks for the full name; if none match, it says it couldn't find the app.
Successful discoveries are saved locally in gitignored `storage/installed-apps.json`.
Future requests reuse the saved target, checking it still exists and searching
again if it moved or was removed. No app paths need to be entered manually.
Apps without a registered entry or Start menu/desktop shortcut (for example,
some portable apps) aren't discovered; Jimmy does not scan every drive.

`close all apps` only closes the approved apps configured in `/api/local-app`.
Named close commands also support discovered executable shortcuts and Windows
Store apps. “Close row blocks” and “close to Roblox” are understood as “close Roblox”.
Closing matches the shortcut's exact executable or the app executable declared
in the Store package manifest (or `MicrosoftGame.config` for Store games), asks
its processes to close, then stops any that remain and verifies
the result. This can discard unsaved progress. Shared launcher/protocol shortcuts
such as Steam game links cannot yet be closed safely by game name; Jimmy reports
that limitation instead of stopping the shared launcher. Discovered apps aren't
added to `close all apps`. App launches clear
Electron's Node-mode flag. Executable shortcuts are checked for a visible window
for up to 10 seconds. A game launcher window does not prove the game is ready;
Jimmy reports starting the installed launcher. If no window can be confirmed
(including Store and Steam/Epic protocol launches), it reports only that Windows
received the request, rather than claiming the app opened.
Run `node tests/local-apps.mjs` for discovery/cache regression checks; add
`--live-scan` to also read the current device's catalog without launching apps.
The compact desktop uses a 200×312 window with separate toolbar, reactor and
bottom control rows. `node tests/compact-layout.cjs` checks the real renderer
with journal controls and error notices visible, without using the microphone.

### Memory

- `remember that [information]`
- `what do you remember`
- `forget [information]`
- `forget memory`
- `clear memory`

Memory is saved locally. It does not train the Ollama model weights.

**Settings → General → Keep voice and chat models loaded** preloads Qwen and
Kokoro immediately, keeps Qwen resident between replies, and saves the choice for
future desktop starts. Moonshine remains ready with the voice service; Silero is
loaded while the microphone is connected. This uses more RAM/VRAM. Vision and
image generation are not preloaded. Turning the switch off restores Qwen's
30-minute idle timeout; Kokoro can stay loaded until the voice service stops.
Shutting down Jimmy still unloads its model and stops its voice containers.
Before a chat reply, Jimmy searches all saved memories by matching words rather
than only taking the latest entries. It prioritizes the current question, weights
uncommon terms more strongly, and uses the previous user message for clear
follow-ups. Up to 25 matching memories plus five recent entries are supplied to
either chat backend, without duplicates. Matching runs locally with no extra
model or service and works with SQLite and Obsidian storage. It does not yet
recognize synonyms or follow links between Obsidian notes.

To keep Jimmy's memory in an Obsidian vault, configure an absolute vault path
and a Markdown note path in `.env.local`:

```env
OBSIDIAN_VAULT_PATH=C:\Users\YOUR_NAME\Documents\AI Memory
OBSIDIAN_MEMORY_NOTE=Jimmy.md
```

Jimmy preserves content outside its marked section in the note. When Obsidian
storage is enabled for the first time, existing SQLite memories are imported
automatically. Leave `OBSIDIAN_VAULT_PATH` unset to use `storage/jimmy-memory.sqlite`.
The database imports `storage/johnny-memory.json` once, leaving the original intact.
SQLite and Obsidian are alternative backends; switching backends does not sync changes.
Memories persist across restarts; conversation history remains in the current session.
Run one Jimmy server per workspace to avoid simultaneous memory edits.

### Daily to-do lists

Jimmy keeps dated task lists locally in gitignored `storage/todos.json`.
They survive restarts and do not require n8n or a chat model. Voice and typed
commands include:

- “Jimmy, create me a to-do list for tomorrow.”
- “Add finish the presentation to my to-do list for tomorrow.”
- “What’s in my to-do list?”
- “Do I have something to do today?”
- “Mark task 1 done.” / “Mark task 1 not done.”
- “Add finish the presentation to my to-do list for tomorrow at 3 PM.”
- “Set task 1 to 4:30 PM.”

Creating a list preserves any existing tasks. If no task is supplied, Jimmy asks
what to add; your next plain answer becomes the task. Say “Cancel” to stop adding
without changing saved tasks. After viewing/creating a list, additions and numbered
completion commands without a date use that list. A list query without a date
always checks today. Say “Jimmy” before spoken follow-ups after the listening
window expires.

**Settings → To-do list** provides a date picker, Today/Tomorrow shortcuts, task
entry, completion checkboxes and individual removal. Use one task per line or
semicolons to add several tasks; “and” within a task is preserved. Today and
tomorrow use **Asia/Manila**, including at midnight and month/year boundaries.
Explicit `YYYY-MM-DD` dates also work. Task numbers follow the displayed list;
completed tasks are omitted from spoken unfinished-task queries.
Tasks can have an optional Manila time. Use AM/PM (including noon/midnight) or
24-hour `HH:MM`, for example `15:00`. Ambiguous times such as “at 3” are rejected
with a request to repeat using AM/PM. You can set or clear times in settings.
For several tasks, write `Finish slides at 3 PM; Call the team at 4 PM`; a time
chosen above the task-entry box applies to new tasks without their own time.
Existing tasks without times continue to work, and task numbering stays stable
when a time changes. Setting a time confirms it in speech; the complete task list
and schedule appear on the data canvas. Creating, adding, listing or completing
tasks updates that canvas, which stays available until dismissed. Say
**“Jimmy, hide to-do list”** or close the canvas to dismiss it; hiding never changes
saved tasks.

These are saved checklists, with no timed alarms, recurring tasks or automatic
rollover of unfinished items. Tasks are not automatically copied into AI memory.
Chat and speech confirm the result without reciting the task list; tasks remain
visible on the canvas and in settings. The storage writer serializes changes and refuses to overwrite
an unreadable task file.

### Reading Gmail, Google Sheets and other n8n tools

Say **“Jimmy, open my local n8n”** (or **“open n8n”**) to open the editor in
your default browser. This uses `N8N_URL`, defaulting to `http://localhost:5678`,
and switches the desktop dashboard to circle mode. n8n must already be running.

Open **Settings → n8n tools**. A disabled Gmail template is included with path
`gmail/messages`, matching the supplied Gmail workflow. Enter its Header Auth
header name and value, enable it and save. These credentials are separate from
`N8N_API_KEY`: the API key creates workflows; the webhook credential calls one.
For a new credential, **Generate secret** creates a random 32-byte secret locally.
**Copy secret** copies it and masks the input; paste it into n8n's Header Auth
credential and **Save tool** in Jimmy. Generation does not update n8n or save
automatically. Saved secrets cannot be revealed here, and copying leaves the
secret on your clipboard until you replace it.
In n8n, connect Gmail OAuth, set Webhook **Respond → When Last Node Finishes**
and **Response Data → First Entry JSON** for the paginated Gmail workflow, then activate/publish it. The
**Test saved tool (runs workflow)** button calls the actual production webhook;
it reports the item count without displaying private content.
Task failures are spoken even with the chat panel hidden, with a visible error
notice outside the panel. If speech or the selected speaker is unavailable,
the notice remains; speech failures do not repeatedly try to speak themselves.
An n8n timeout does not confirm that its workflow stopped. Check the execution
in n8n before retrying; oversized results are reported separately.

Say **“Jimmy, check my emails”** or **“get my emails”** for unread messages
received since your last completed routine check, up to the current request’s
time. The first check starts on Monday at midnight in **Asia/Manila**.
The saved time survives restarts in ignored `storage/gmail-checks.json`.
For example, after a completed Monday 9 AM check, Tuesday’s check requests only
unread mail received from Monday 9 AM until Tuesday’s request time.

Checkpoints advance after a nonempty reply stream finishes successfully, not
after merely fetching emails. Failed/cancelled requests keep the old time.
If results span several pages, the next routine check resumes the remaining
pages of that fixed time window first; after finishing, check again for newer
arrivals. Successfully delivered pages are not repeated. Empty successful
results also advance the time. Timestamps have second precision; adjacent windows
include the boundary second once, with no gap. This does not track whether you
heard every word of audio or whether the model mentioned every email in its summary.
An unreadable history file produces an error rather than resetting it.

**“Check my emails this week”** explicitly repeats the weekly unread search.
**“Find emails about the presentation”**
or **“find emails from professor@example.com about slides”** searches read and
unread messages. **“Check all my emails”** searches both without a week filter.
**“Next page of emails”** continues the same search in the current dashboard
session. Reloading Jimmy clears search continuation; start a new search afterward.
Routine checks retain any unfinished page on the server across restarts.
Explicit searches, all-mail requests, and the Settings test button do not advance
the routine checkpoint. Check history is scoped to the configured Gmail tool,
endpoint and webhook credential; reconfiguring these starts fresh.

The updated workflow filters in Gmail before retrieving **up to 20 previews per
request**, not a total mailbox limit. It returns sender, subject, date, unread
status, preview and `nextPageToken`, not full bodies or attachments. It does not
mark messages read. Spam/trash are excluded. A page is never described as the
entire mailbox, and large pages can still be excerpted for the model.
Explicit parameters are supported with **Use Gmail with
`{"query":"from:example@example.com is:unread","pageSize":10}`**; this also
supports Gmail's own search syntax for dates and other filters. Other natural
date filters ask for clarification instead of silently searching the wrong scope.

The workflow update is in `scripts/update-gmail-workflow.mjs`; it targets the
existing Gmail workflow, keeps its webhook path/authentication and OAuth
credential references, backs it up to ignored `storage/gmail-workflow-backup-*.json`,
and republishes it if already active. It never changes the Gmail credentials.

For Sheets or another read integration, add a tool with a name, production
webhook path, GET/POST method, activation phrases, header authentication and
optional default parameters. No backend edit or restart is needed after saving.
For example, register **Google Sheets**, set defaults such as `spreadsheetId`
and `range`, then say/type **Use Google Sheets with {"range":"Sheet1!A1:C20"}**.
Your workflow must read those parameters from the webhook's `query` (GET) or
`body` (POST). The complete user request is also passed in `request`.

Only explicit current user requests invoke tools. Message contents, sheet cells
and model-generated instructions cannot initiate another call. Only register
workflows that retrieve data: Jimmy cannot verify their internal side effects.
All calls stay on the server configured by `N8N_URL` under `/webhook/`; redirects
are rejected. Up to 20 tools are supported. The server waits up to two minutes,
accepts at most 8 MiB of JSON, and includes at most 12,000 characters in the model
context with an explicit incomplete-excerpt notice. This is a response/context
bound, not a fixed five-message retrieval limit. Object responses have unknown
item counts and are not treated as a complete mailbox.

Credentials are encrypted in gitignored `storage/n8n-tools.json` with a key
derived from `VOICE_SERVICE_SECRET`; changing that secret requires re-entering
webhook credentials. Saved secrets are never returned by the settings API or
included in model context. Configuring/testing tools requires authenticated
local access. Results are not automatically saved as memory. Auto uses local
Qwen for tool results and subsequent requests in that chat session; explicitly selecting Codex sends results to the selected
ChatGPT account. Gmail/Sheets OAuth remains managed in n8n.

### Learning and reusable knowledge

Jimmy has a separate persistent knowledge library in `storage/jimmy-knowledge.json`
(excluded from Git). **Settings → Knowledge** lets you teach a lesson, learn from
a software name or public documentation URL, review dates/sources and excerpts,
refresh a reference, or forget an entry. For example:

- “Jimmy, learn that Gmail retrieval should use the native Gmail node.”
- “Jimmy, learn from the n8n documentation.”
- “Jimmy, learn from Python documentation.”
- “Jimmy, study the React documentation.”
- “Jimmy, learn from https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.gmail/message-operations”
- “Jimmy, what have you learned?”

Jimmy also looks up documentation for recognized technical tasks in chat and
planning. Searches contain public software names and selected technical terms,
never the raw conversation or code. A maintained publisher directory identifies
common tools; other names use Wikidata's official-website metadata and a
documentation link on that website. Search results are restricted to the
identified documentation site. If the publisher is ambiguous or cannot be
established, provide a URL. Direct URLs without publisher evidence are labeled
unverified. Publisher identification is evidence, not a guarantee of correctness.

Only readable public HTTPS pages are accepted; private network addresses and
redirects to them are blocked. Jimmy saves page excerpts, not search snippets.
Discovery reads selected pages rather than crawling an entire site. The named
n8n command saves its integration overview, fetched from n8n's official Markdown
repository. Specific node references are fetched during workflow creation.
References are cached with their source, identification evidence and date.
At most 100 entries are retained;
long references are excerpted at 12,000 characters. Workflow references refresh
after seven days when consulted; if offline, an existing cache keeps its original
retrieval date. Repeated topic/feature lookups reuse an in-process one-hour cache;
technical tasks can search again after that. Ordinary chat uses saved excerpts.
This is retrieval of saved knowledge, not training model weights or silently
memorizing every conversation. User-taught lessons are marked unverified.
Relevant excerpts are supplied to chat and planning, including Codex if selected,
under the same account privacy rules as saved memories.

Before creating an n8n draft, Jimmy automatically reads/caches webhook references
and, when requested, Gmail or Google Sheets references. Gmail retrieval includes
an explicit native-node parameter example. The generator rejects disconnected
nodes and missing triggers, checks requested webhook/authentication and Gmail
read/all-message scope, and tries one repair using the validator's feedback.
If the repaired result still fails, it is not saved in n8n. These are structural
and selected requirement checks, not complete node-schema or execution validation.
Drafts remain inactive and require review, credentials and testing. Nothing is
learned as a proven successful procedure merely because n8n accepted a draft.
Workflow generation remains on local Qwen; its reference context uses 6,144 tokens.

### Daily activity journal

In Jimmy's settings, open **Activity journal**, enable recording, and save.
Recording is off by default. While Jimmy's Windows desktop app runs, a hidden
lightweight collector samples the foreground app and window title every 10
seconds, logging changes and a five-minute reminder while active. It skips
five-minute idle periods and recognizable private-browser windows. Window titles
can include website/document names; it never reads chat bodies, keystrokes,
screenshots, or document/source contents.

Add absolute project folder paths (one per line) to record file-change paths and
Git status. File events describe observed changes, not the purpose of edits;
rename events cannot reliably distinguish creation, movement, and deletion.
Generated/dependency folders are excluded. File bursts are coalesced and capped
at 100 paths per polling interval. Git is checked once per minute, including the
last commit and ahead/behind status when an upstream is configured. Jimmy never
fetches or pushes: remote comparison can be stale. Projects outside these folders
are not monitored for file changes.

Daily Markdown journals are stored in `storage/activity/YYYY-MM-DD.md`, excluded
from Git. Retention defaults to 30 calendar days and is configurable (1–365).
Old journals are removed when Jimmy next checks settings or records activity.
The journal view shows up to the last 128 KiB; the daily file is capped at 2 MiB.
Use **Journal on · Pause** to stop all new recording; old entries remain until
retention expires. Closing Jimmy stops desktop tracking. This records from
enablement onward, with no reconstruction of earlier activity.

For active browser page titles and URLs, install the optional unpacked Chromium
extension using [browser-extension/README.md](browser-extension/README.md).
Enable browser recording in both Jimmy and the extension. It records focused
active tabs only, excludes private browsing and localhost pages, strips URL
query strings/fragments, and uses locally stored Jimmy credentials. Page titles
and URL paths can still contain sensitive information. No page-content or history
permissions are requested.

Ask **Qwen · local** “What did I work on today?”, “Where did I leave off with
Lupad?”, or “Do I have unpushed commits?”. Relevant journal excerpts are added to
local chat, with today/yesterday filters. These excerpts can omit earlier entries;
the settings view and Markdown files provide the journal itself. Journal context
is not automatically attached to Codex requests. Conversation history, including
activity already discussed in chat, is sent as usual if you later choose Codex.
No extra model or Docker service is required.

### Browser Search and Web Facts

Explicit searches open results in your Windows default browser (localhost only).
Image searches open Google Images.

- `look up any images of Jarvis from Iron Man`
- `find pictures of [subject]`
- `search the web for [query]`
- `look up [query]`
- `google [query]`
- `latest [topic]`
- `current [topic]`
- `today [topic]`
- `news about [topic]`

Basic questions go to local Ollama unless they explicitly ask for web/current/latest information.

### Local Time And Date

- `what time is it`
- `tell me the time`
- `what date is it`
- `what day is it`

Time and date are answered from the local browser clock.

Jimmy sends 16 kHz mono PCM over an authenticated WebSocket. Silero runs on CPU,
retains 300 ms of pre-roll, and ends turns after 2 seconds of silence by default,
allowing pauses between phrases. Set `VOICE_ENDPOINT_SILENCE_MS` in `.env.local`
(500–5000 ms) and recreate the voice container to adjust this waiting time.
Moonshine supplies partial transcripts while speaking and a final at turn end.

## Notes

- Jimmy is local-first, but YouTube and web facts need internet access.
- Ollama, the voice services, and ComfyUI must be running or configured locally for those features to work.

### Browser shortcuts

Say “Jimmy, open ChatGPT in the browser”, “open Google”, or “open YouTube”.
Add your own names and URLs in `.env.local`, then restart Next.js:

```env
JIMMY_BROWSER_LINKS='{"crm":"https://your-crm.example.com","dashboard":"https://your-dashboard.example.com"}'
```

Then say “open CRM” or “open dashboard”. Replace the example URLs with your own.
Shortcuts open in the Windows default browser from localhost. To use a specific
Chrome profile for both “open Chrome” and all website, search and YouTube commands,
set its directory name in `.env.local` and restart Jimmy:

```env
CHROME_PROFILE_DIRECTORY=Default
```

Use the folder shown at the end of **Profile Path** in `chrome://version`, such as
`Default` or `Profile 10`; the displayed account name can differ. Jimmy checks
that this folder exists before launching, so a missing profile produces an error
instead of opening another account or creating an empty profile. Leave the value
blank to retain the system default browser for websites and Chrome's own startup
behavior for “open Chrome”. `CHROME_PATH` can override Chrome's executable location.
Run `node tests/chrome-profile.mjs` to check profile routing without opening browsers.
Unknown shortcut names are searched as installed apps. Existing app commands
retain priority.

## Background server on Windows

Build once after each code update with `npm run build`. Run `npm run background:start`. You can close the
terminal; the production server stays running at `http://localhost:3001`.

- `npm run background:status` checks the managed server process.
- `npm run background:stop` stops only that server.
- Logs are in `.jimmy-runtime/server.log` and `server-error.log`.

Open Jimmy in your browser and enable the mic or hold to talk. Close the page to stop microphone capture.
Start Docker Desktop, `npm run voice:up`, and Ollama when voice/chat are needed;
the background command manages Next.js only. It does not register login startup.
After changing code, stop the background server, rebuild, and start it again.

## Floating Windows assistant

`npm run desktop:start` opens Jimmy as an always-on-top floating reactor with a
tray icon. The desktop app owns a production server on port 3002; it does not
need the old `background:start` server on port 3001 or a browser tab.

You can close the terminal or VS Code after launching. The command registers and
starts an on-demand Windows task named **Jimmy Manual Launch**, so Jimmy runs
independently of the editor. This task has no automatic startup trigger; login
startup remains a separate option below. To exit Jimmy, use the tray's shutdown
action or say **Jimmy, shut down**. If Jimmy was already running from the old
launcher, shut it down and run `npm run desktop:start` again to use this change.

- Drag the dotted handle to move the circle; click its center or **+** for chat
  and settings. **−** returns to the circle without restarting the voice session.
- **Mic on/off** controls microphone input. Right-click the circle or tray icon
  for pinning, hiding, mute, retry startup, and shutdown.
- Hiding to the tray keeps the microphone session alive. The tray remains visible
  so listening can be muted or stopped.
- At login, Docker Desktop and Ollama start as needed. Silero/Moonshine load;
  enable **Use mic / wake word** to let Jimmy hear his name, or hold to talk.
- Say **Jimmy** or **Jimmy, you there?** to load Kokoro and Jimmy's Ollama model
  once. The first wake may take a while. Both remain available for the session;
  Ollama uses `keep_alive=-1` in the desktop-owned server only.
- Say **Jimmy, shut down** (or use the tray menu) to close capture, playback, the
  desktop server, and Jimmy's voice containers, and unload the configured Ollama
  model. This does not shut down Windows, Docker Desktop, or unrelated models.
  An Ollama server started by Jimmy is stopped too; an existing Ollama server is
  left available. A cleanup failure is reported rather than silently ignored.
- After shutdown, voice cannot wake Jimmy again because recognition is stopped.
  Run `npm run desktop:start` to reopen, or wait for the next Windows sign-in.

### Login startup

`npm run desktop:startup:enable` registers **Jimmy Floating Assistant** for your
Windows account, 20 seconds after sign-in. It runs without a terminal and retries
failed process launches. Docker startup/model loading have readiness waits; the
tray's **Retry startup** action handles service failures.

Use `npm run desktop:startup:status` to inspect it, or
`npm run desktop:startup:disable` to remove automatic startup. Intentional shutdown
exits normally and does not immediately restart Jimmy.

Keep this project folder in place: the startup task points to its Electron runtime.
After frontend changes, shut down Jimmy, run `npm run build`, and reopen. After
voice-service changes, also run `docker compose --env-file .env.local -f
voice-service/compose.yaml build voice tts` before reopening. On a fresh checkout,
install dependencies and the Electron runtime (`node node_modules/electron/install.js`
if npm skipped its download), build the app and voice images, then enable startup.

Electron's microphone access uses the Windows desktop-app microphone permission.
Only one Jimmy voice session can run at a time; close other Jimmy tabs before
using the floating assistant. Desktop settings are separate from Chrome settings.
Runtime logs are in `.jimmy-runtime/desktop-server.log` and `desktop-ollama.log`.
The desktop's cold TTS mode is selected via `VOICE_TTS_LAZY_LOAD=1` when it starts
Compose; regular `voice:up` retains eager loading by default.

### Work routine

Say **Jimmy, time for work** (or type **time for work**) to open ChatGPT in your
default browser, launch Brave, and open Visual Studio Code. Existing app paths
and the ChatGPT shortcut are reused. If one launch fails, Jimmy still tries the
others and reports which apps could not open.

### Random music

“Play some music” selects a varied music search and shuffles the returned YouTube
results. “Play some classical music” keeps the classical genre and shuffles its
results. Specific song requests keep normal result ordering. In the floating
desktop app, playback opens in your default browser instead of the embedded
player. Browser autoplay rules may require pressing Play. Playback controls for
external YouTube tabs must be used in that browser; the embedded controls remain
available when using Jimmy as a normal webpage.
