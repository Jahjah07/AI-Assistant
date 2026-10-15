import { readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";

import {
  acquireConcurrency,
  concurrencyLimitResponse,
  fetchWithTimeout,
  getBoundedInteger,
  readJsonObject,
  readResponseBytes,
  readResponseText,
  ResponseSizeError,
  UpstreamTimeoutError,
} from "../_limits";
import { protectApiRequest } from "../_security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ComfyWorkflow = Record<string, { inputs?: Record<string, unknown> }>;
type ComfyPromptResponse = {
  prompt_id?: string;
};
type ComfyHistoryResponse = Record<
  string,
  {
    outputs?: Record<
      string,
      {
        images?: Array<{
          filename: string;
          subfolder?: string;
          type?: string;
        }>;
      }
    >;
  }
>;

const COMFYUI_URL = process.env.COMFYUI_URL || "http://127.0.0.1:8188";
const COMFYUI_WORKFLOW_PATH = process.env.COMFYUI_WORKFLOW_PATH || "";
const COMFYUI_PROMPT_NODE_ID =
  process.env.COMFYUI_PROMPT_NODE_ID ||
  process.env.COMFYUI_POSITIVE_NODE_ID ||
  "";
const COMFYUI_PROMPT_INPUT =
  process.env.COMFYUI_PROMPT_INPUT ||
  process.env.COMFYUI_POSITIVE_INPUT ||
  "text";
const COMFYUI_SEED_NODE_ID =
  process.env.COMFYUI_SEED_NODE_ID ||
  process.env.COMFYUI_KSAMPLER_NODE_ID ||
  "";
const COMFYUI_SEED_INPUT = process.env.COMFYUI_SEED_INPUT || "seed";
const COMFYUI_WIDTH_NODE_ID =
  process.env.COMFYUI_WIDTH_NODE_ID ||
  process.env.COMFYUI_LATENT_NODE_ID ||
  "";
const COMFYUI_WIDTH_INPUT = process.env.COMFYUI_WIDTH_INPUT || "width";
const COMFYUI_HEIGHT_NODE_ID =
  process.env.COMFYUI_HEIGHT_NODE_ID ||
  process.env.COMFYUI_LATENT_NODE_ID ||
  "";
const COMFYUI_HEIGHT_INPUT = process.env.COMFYUI_HEIGHT_INPUT || "height";
const COMFYUI_SAVE_IMAGE_NODE_ID = process.env.COMFYUI_SAVE_IMAGE_NODE_ID || "";
const COMFYUI_FILENAME_PREFIX_INPUT =
  process.env.COMFYUI_FILENAME_PREFIX_INPUT || "filename_prefix";
const COMFYUI_TIMEOUT_MS = getBoundedInteger(
  process.env.COMFYUI_TIMEOUT_MS,
  180_000,
  15_000,
  10 * 60_000,
);
const COMFYUI_CONCURRENCY = getBoundedInteger(
  process.env.COMFYUI_CONCURRENCY,
  1,
  1,
  3,
);
const MAX_WORKFLOW_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function setPromptInWorkflow(workflow: ComfyWorkflow, prompt: string) {
  if (COMFYUI_PROMPT_NODE_ID && workflow[COMFYUI_PROMPT_NODE_ID]?.inputs) {
    workflow[COMFYUI_PROMPT_NODE_ID].inputs[COMFYUI_PROMPT_INPUT] = prompt;
    return true;
  }

  for (const node of Object.values(workflow)) {
    if (!node.inputs) {
      continue;
    }

    if (typeof node.inputs.text === "string") {
      node.inputs.text = prompt;
      return true;
    }

    if (typeof node.inputs.prompt === "string") {
      node.inputs.prompt = prompt;
      return true;
    }
  }

  return false;
}

function setWorkflowInput(
  workflow: ComfyWorkflow,
  nodeId: string,
  inputName: string,
  value: unknown,
) {
  if (!nodeId || value === undefined) {
    return;
  }

  const node = workflow[nodeId];

  if (!node?.inputs) {
    return;
  }

  node.inputs[inputName] = value;
}

function getWorkflowPath() {
  if (!COMFYUI_WORKFLOW_PATH) {
    return "";
  }

  if (!isAbsolute(COMFYUI_WORKFLOW_PATH)) {
    throw new Error("COMFYUI_WORKFLOW_PATH must be an absolute path.");
  }

  return COMFYUI_WORKFLOW_PATH;
}

async function loadWorkflow(prompt: string) {
  const workflowPath = getWorkflowPath();

  if (!workflowPath) {
    throw new Error("Set COMFYUI_WORKFLOW_PATH in .env.local.");
  }

  const workflowStats = await stat(/* turbopackIgnore: true */ workflowPath);

  if (workflowStats.size > MAX_WORKFLOW_BYTES) {
    throw new Error("ComfyUI workflow must not exceed 5 MiB.");
  }

  const parsedWorkflow = JSON.parse(
    await readFile(/* turbopackIgnore: true */ workflowPath, "utf8"),
  ) as unknown;

  if (!parsedWorkflow || typeof parsedWorkflow !== "object" || Array.isArray(parsedWorkflow)) {
    throw new Error("ComfyUI workflow must be a JSON object.");
  }

  const workflow = parsedWorkflow as ComfyWorkflow;

  if (!setPromptInWorkflow(workflow, prompt)) {
    throw new Error(
      "Could not find a prompt input in the workflow. Set COMFYUI_PROMPT_NODE_ID and COMFYUI_PROMPT_INPUT in .env.local.",
    );
  }

  const seed = Math.floor(Math.random() * 1_000_000_000_000);
  setWorkflowInput(workflow, COMFYUI_SEED_NODE_ID, COMFYUI_SEED_INPUT, seed);
  setWorkflowInput(workflow, COMFYUI_WIDTH_NODE_ID, COMFYUI_WIDTH_INPUT, 1024);
  setWorkflowInput(workflow, COMFYUI_HEIGHT_NODE_ID, COMFYUI_HEIGHT_INPUT, 1024);
  setWorkflowInput(
    workflow,
    COMFYUI_SAVE_IMAGE_NODE_ID,
    COMFYUI_FILENAME_PREFIX_INPUT,
    `jimmy-${Date.now()}`,
  );

  return workflow;
}

async function getPromptImage(
  promptId: string,
  startedAt: number,
  signal: AbortSignal,
) {
  while (Date.now() - startedAt < COMFYUI_TIMEOUT_MS) {
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timeout);
        reject(signal.reason || new DOMException("Request aborted.", "AbortError"));
      };
      const timeout = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, 1500);

      if (signal.aborted) {
        abort();
      } else {
        signal.addEventListener("abort", abort, { once: true });
      }
    });

    const remainingMs = COMFYUI_TIMEOUT_MS - (Date.now() - startedAt);
    const historyResponse = await fetchWithTimeout(
      `${COMFYUI_URL}/history/${promptId}`,
      {},
      Math.max(1, Math.min(10_000, remainingMs)),
      signal,
    );

    if (!historyResponse.ok) {
      continue;
    }

    const history = JSON.parse(
      await readResponseText(
        historyResponse,
        2 * 1024 * 1024,
        Math.max(1, Math.min(10_000, remainingMs)),
        signal,
      ),
    ) as ComfyHistoryResponse;
    const outputs = history[promptId]?.outputs;

    if (!outputs) {
      continue;
    }

    for (const output of Object.values(outputs)) {
      const image = output.images?.[0];

      if (!image) {
        continue;
      }

      const params = new URLSearchParams({
        filename: image.filename,
        subfolder: image.subfolder || "",
        type: image.type || "output",
      });
      const imageResponse = await fetchWithTimeout(
        `${COMFYUI_URL}/view?${params}`,
        {},
        Math.max(1, Math.min(30_000, remainingMs)),
        signal,
      );

      if (!imageResponse.ok) {
        continue;
      }

      const contentType = imageResponse.headers.get("content-type") || "image/png";

      if (!contentType.toLowerCase().startsWith("image/")) {
        throw new Error("ComfyUI returned a non-image response.");
      }

      const bytes = Buffer.from(
        await readResponseBytes(
          imageResponse,
          MAX_IMAGE_BYTES,
          Math.max(1, Math.min(30_000, remainingMs)),
          signal,
        ),
      );

      return {
        filename: image.filename,
        imageUrl: `data:${contentType};base64,${bytes.toString("base64")}`,
      };
    }
  }

  throw new UpstreamTimeoutError("ComfyUI did not finish before the timeout.");
}

export async function POST(request: Request) {
  const securityError = protectApiRequest(request, {
    scope: "comfy-image",
    limit: 5,
    windowMs: 10 * 60_000,
  });

  if (securityError) {
    return securityError;
  }

  const bodyResult = await readJsonObject(request, 16_384);

  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const rawPrompt = bodyResult.value.prompt;
  const prompt = typeof rawPrompt === "string" ? rawPrompt.trim() : "";

  if (!prompt) {
    return Response.json({ error: "No image prompt was provided." }, { status: 400 });
  }

  if (prompt.length > 2_000) {
    return Response.json(
      { error: "Image prompt must not exceed 2,000 characters." },
      { status: 400 },
    );
  }

  const release = acquireConcurrency("comfy-image", COMFYUI_CONCURRENCY);

  if (!release) {
    return concurrencyLimitResponse();
  }

  try {
    const workflow = await loadWorkflow(prompt);
    const clientId = randomUUID();
    const promptResponse = await fetchWithTimeout(`${COMFYUI_URL}/prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        prompt: workflow,
      }),
    }, Math.min(15_000, COMFYUI_TIMEOUT_MS), request.signal);

    if (!promptResponse.ok) {
      return Response.json(
        {
          error: await readResponseText(
            promptResponse,
            64 * 1024,
            15_000,
            request.signal,
          ),
        },
        { status: 502 },
      );
    }

    const promptData = JSON.parse(
      await readResponseText(
        promptResponse,
        256 * 1024,
        15_000,
        request.signal,
      ),
    ) as ComfyPromptResponse;

    if (!promptData.prompt_id) {
      return Response.json(
        { error: "ComfyUI did not return a prompt id." },
        { status: 502 },
      );
    }

    const result = await getPromptImage(promptData.prompt_id, Date.now(), request.signal);

    return Response.json({
      prompt,
      promptId: promptData.prompt_id,
      ...result,
    });
  } catch (error) {
    if (error instanceof UpstreamTimeoutError) {
      return Response.json({ error: error.message }, { status: 504 });
    }

    if (error instanceof ResponseSizeError) {
      return Response.json(
        { error: "ComfyUI returned an image larger than 20 MiB." },
        { status: 502 },
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";

    return Response.json(
      { error: `Could not generate image with ComfyUI. ${message}` },
      { status: 500 },
    );
  } finally {
    release();
  }
}
