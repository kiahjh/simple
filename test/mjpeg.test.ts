import { describe, expect, test } from "bun:test";
import { mjpegPart, readMjpegFrames, throttledMjpeg } from "../src/mjpeg.ts";

/** A fake frame whose bytes include things a naive parser might mistake for boundaries. */
function frame(n: number): Uint8Array {
  const text = `frame ${n}\r\n\r\n--frame\r\nContent-Length: 1\r\n`;
  const bytes = new TextEncoder().encode(text);
  return new Uint8Array([0xff, 0xd8, ...bytes, 0xff, 0xd9, n]);
}

/** Splits bytes into small chunks, so frames straddle chunk boundaries. */
function chunked(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
      controller.close();
    },
  });
}

async function collect(frames: AsyncGenerator<Uint8Array>): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for await (const f of frames) out.push(f);
  return out;
}

describe("readMjpegFrames", () => {
  test("splits frames by Content-Length, across any chunk boundaries", async () => {
    const sent = [frame(1), frame(2), frame(3)];
    const stream = sent.flatMap((f) => [...mjpegPart(f)]);
    for (const size of [1, 7, 64, 100_000]) {
      const received = await collect(readMjpegFrames(chunked(new Uint8Array(stream), size)));
      expect(received).toEqual(sent);
    }
  });
});

describe("throttledMjpeg", () => {
  test("sends the first frame right away, then at most `fps`, always the newest", async () => {
    async function* fast() {
      for (let n = 0; n < 50; n++) {
        yield frame(n);
        await Bun.sleep(20);
      }
    }
    let closes = 0;
    const out = throttledMjpeg(fast(), 5, () => closes++);
    const received = await collect(readMjpegFrames(out));

    expect(received[0]).toEqual(frame(0));
    // ~1 s of input at 50 fps, throttled to 5 fps: the first frame plus about 5 more.
    expect(received.length).toBeGreaterThanOrEqual(3);
    expect(received.length).toBeLessThanOrEqual(8);
    const numbers = received.map((f) => f.at(-1));
    expect(numbers).toEqual([...numbers].sort((a, b) => (a ?? 0) - (b ?? 0)));
    expect(closes).toBe(1);
  });

  test("runs onClose once when the viewer goes away", async () => {
    async function* forever() {
      for (let n = 0; ; n++) {
        yield frame(n % 256);
        await Bun.sleep(10);
      }
    }
    let closes = 0;
    const out = throttledMjpeg(forever(), 5, () => closes++);
    const reader = out.getReader();
    await reader.read();
    await reader.cancel();
    await Bun.sleep(50);
    expect(closes).toBe(1);
  });
});
