import { type CanvasContent } from "../../lib/canvas";

// Opt-in framing keeps plain-text clients working and carries source data outside model text.
export function canvasResponse(response: Response, canvas: CanvasContent | null) {
  if (!response.body || !canvas) return response;
  const reader = response.body.getReader(), decoder = new TextDecoder(), encoder = new TextEncoder();
  const event = (value: unknown) => encoder.encode(JSON.stringify(value) + "\n");
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          const tail = decoder.decode();
          if (tail) controller.enqueue(event({ type: "text", text: tail }));
          controller.enqueue(event({ type: "canvas", canvas }));
          controller.close();
        } else {
          const text = decoder.decode(value, { stream: true });
          if (text) controller.enqueue(event({ type: "text", text }));
        }
      } catch (error) { controller.error(error); void reader.cancel().catch(() => {}); }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/x-ndjson; charset=utf-8");
  headers.delete("Content-Length");
  return new Response(body, { status: response.status, headers });
}
