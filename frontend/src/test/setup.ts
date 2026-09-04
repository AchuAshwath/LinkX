import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

const storage: Record<string, string> = {}
if (
  typeof globalThis.localStorage === "undefined" ||
  !globalThis.localStorage.getItem
) {
  globalThis.localStorage = {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => {
      storage[key] = value
    },
    removeItem: (key: string) => {
      delete storage[key]
    },
    clear: () => {
      for (const k of Object.keys(storage)) {
        delete storage[k]
      }
    },
    key: (index: number) => Object.keys(storage)[index] ?? null,
    length: 0,
  }
}

afterEach(() => {
  cleanup()
})
