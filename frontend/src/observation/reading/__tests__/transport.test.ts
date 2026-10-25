import { beforeEach, describe, expect, it, vi } from "vitest"
import { BrowserOperationError } from "../operationError"
import { createBrowserReadingTransport } from "../transport"
import type { BrowserFrame } from "../types"

function token() {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const payload = btoa(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  )
  return `${header}.${payload}.signature`
}

function frame(): BrowserFrame {
  return {
    id: "frame-a",
    sequence: 4,
    captured_at: new Date().toISOString(),
    width: 640,
    height: 480,
    image_data_url: "data:image/jpeg;base64,QUJD",
  }
}

describe("BrowserReadingTransport", () => {
  beforeEach(() => {
    localStorage.setItem("access_token", token())
  })

  it("verifies cancellation by reading status before and after deleting an active operation", async () => {
    const statuses = [
      { operation_id: "operation-a", state: "active", cancelled: false },
      { operation_id: "operation-a", state: "settled", cancelled: true },
    ]
    const fetcher = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          return { ok: true, status: 204, json: async () => ({}) }
        }
        const status = statuses.shift()
        return { ok: true, status: 200, json: async () => status }
      },
    )
    const transport = createBrowserReadingTransport(fetcher)

    await expect(transport.settle?.("operation-a")).resolves.toEqual({
      operation_id: "operation-a",
      state: "settled",
      cancelled: true,
    })

    expect(
      fetcher.mock.calls.map(([url, init]) => [url, init?.method]),
    ).toEqual([
      ["/api/v1/ai/observation/operations/operation-a", "GET"],
      ["/api/v1/ai/observation/operations/operation-a", "DELETE"],
      ["/api/v1/ai/observation/operations/operation-a", "GET"],
    ])
  })

  it("returns unknown instead of claiming settlement when metadata is unavailable", async () => {
    const transport = createBrowserReadingTransport(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }))

    await expect(transport.settle?.("operation-a")).resolves.toEqual({
      operation_id: "operation-a",
      state: "unknown",
      cancelled: false,
    })
  })

  it("marks definite pre-processing HTTP rejections", async () => {
    for (const status of [401, 403, 404, 409, 413, 422]) {
      const transport = createBrowserReadingTransport(async () => ({
        ok: false,
        status,
        json: async () => ({}),
      }))

      const error = await transport
        .read({
          operation_id: `operation-${status}`,
          model: "gpt-5.6-sol",
          frame: frame(),
        })
        .catch((reason: unknown) => reason)

      expect(error).toBeInstanceOf(BrowserOperationError)
      expect(error).toMatchObject({
        status,
        rejectedBeforeProcessing: true,
      })
    }
  })

  it("keeps server failures ambiguous", async () => {
    const transport = createBrowserReadingTransport(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }))

    const error = await transport
      .read({
        operation_id: "operation-5xx",
        model: "gpt-5.6-sol",
        frame: frame(),
      })
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(BrowserOperationError)
  })

  it("rejects a note that does not match the requested frame and model", async () => {
    const transport = createBrowserReadingTransport(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        operation_id: "operation-a",
        note: {
          id: "different-frame",
          sequence: 4,
          text: "A page note",
          model: "gpt-5.6-luna",
          uncertainty: "",
        },
      }),
    }))

    await expect(
      transport.read({
        operation_id: "operation-a",
        model: "gpt-5.6-sol",
        frame: frame(),
      }),
    ).rejects.toThrow("Observation read returned an invalid note.")
  })

  it("does not treat an active but cancelled read as settled after timeout", async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/read")) {
          return new Promise<never>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException()),
            )
          })
        }
        if (init?.method === "DELETE") {
          return { ok: true, status: 204, json: async () => ({}) }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            operation_id: "operation-a",
            state: "active",
            cancelled: true,
          }),
        }
      },
    )
    const transport = createBrowserReadingTransport(fetcher)
    const request = transport.read({
      operation_id: "operation-a",
      model: "gpt-5.6-sol",
      frame: frame(),
    })
    const outcome = request.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(60_000)
    const error = await outcome
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      message: "Observation read outcome is unknown.",
    })
    expect(error).not.toBeInstanceOf(BrowserOperationError)
    vi.useRealTimers()
  })

  it("bounds compaction and confirms the operation settled after timeout", async () => {
    vi.useFakeTimers()
    let statusReads = 0
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/compact")) {
          return new Promise<never>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException()),
            )
          })
        }
        if (init?.method === "DELETE") {
          return { ok: true, status: 204, json: async () => ({}) }
        }
        statusReads += 1
        return {
          ok: true,
          status: 200,
          json: async () => ({
            operation_id: "operation-b",
            state: statusReads === 1 ? "active" : "settled",
            cancelled: statusReads > 1,
          }),
        }
      },
    )
    const transport = createBrowserReadingTransport(fetcher)
    const request = transport.compact({
      operation_id: "operation-b",
      model: "gpt-5.6-sol",
      summary: "",
      notes: [],
    })
    const outcome = expect(request).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(60_000)
    await outcome
    expect(
      fetcher.mock.calls.map(([input, init]) => [String(input), init?.method]),
    ).toEqual([
      ["/api/v1/ai/observation/compact", "POST"],
      ["/api/v1/ai/observation/operations/operation-b", "GET"],
      ["/api/v1/ai/observation/operations/operation-b", "DELETE"],
      ["/api/v1/ai/observation/operations/operation-b", "GET"],
    ])
    vi.useRealTimers()
  })
})
