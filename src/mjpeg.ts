/**
 * Reading and writing MJPEG streams (multipart/x-mixed-replace), the format serve-sim streams simulator screens in.
 * Each part has a Content-Length header, so frames are split by length rather than by scanning for JPEG markers
 * (serve-sim's frames carry EXIF data, which can contain those markers).
 */

export const MJPEG_CONTENT_TYPE = "multipart/x-mixed-replace; boundary=frame";

const HEADER_END = new Uint8Array([13, 10, 13, 10]); // \r\n\r\n
const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Yields each JPEG frame from an MJPEG byte stream. */
export async function* readMjpegFrames(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  let buffer: Uint8Array = new Uint8Array(0);
  // A reader loop rather than `for await`, so this also runs in browsers without stream async iteration.
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) return;
      buffer = concat(buffer, chunk);
      while (true) {
        const headerEnd = indexOf(buffer, HEADER_END);
        if (headerEnd === -1) break;
        const headers = decoder.decode(buffer.subarray(0, headerEnd));
        const length = Number(/content-length:\s*(\d+)/i.exec(headers)?.[1]);
        if (!Number.isFinite(length)) throw new Error("MJPEG part without a Content-Length header");
        const start = headerEnd + HEADER_END.length;
        if (buffer.length < start + length) break;
        yield buffer.slice(start, start + length);
        buffer = buffer.subarray(start + length);
      }
    }
  } finally {
    // Cancelling (rather than only releasing) tells the source we're done, e.g. aborting a fetch.
    await reader.cancel().catch(() => {});
  }
}

/** One part of an MJPEG stream. */
export function mjpegPart(jpeg: Uint8Array): Uint8Array {
  const header = encoder.encode(
    `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`,
  );
  return concat(concat(header, jpeg), encoder.encode("\r\n"));
}

/**
 * Re-streams frames at no more than `fps`, always sending the newest one and dropping the rest.
 * `onClose` runs once, when either side ends.
 */
export function throttledMjpeg(
  frames: AsyncGenerator<Uint8Array>,
  fps: number,
  onClose: () => void,
): ReadableStream<Uint8Array> {
  let latest: Uint8Array | null = null;
  let sentAny = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    frames.return(undefined).catch(() => {});
    onClose();
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(() => {
        if (!latest || closed) return;
        controller.enqueue(mjpegPart(latest));
        latest = null;
      }, 1000 / fps);

      (async () => {
        try {
          for await (const frame of frames) {
            if (closed) return;
            // Send the very first frame right away, so the thumbnail isn't blank for a tick.
            if (!sentAny) {
              controller.enqueue(mjpegPart(frame));
              sentAny = true;
              continue;
            }
            latest = frame;
          }
          if (!closed) {
            if (latest) controller.enqueue(mjpegPart(latest));
            controller.close();
          }
        } catch (error) {
          if (!closed) controller.error(error);
        } finally {
          close();
        }
      })();
    },
    cancel() {
      close();
    },
  });
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
