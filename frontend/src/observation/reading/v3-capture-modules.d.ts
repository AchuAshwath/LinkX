declare module "*.mjs" {
  export function createCapturePipeline(options?: {
    onGap?: (gap: unknown) => void
  }): {
    offer(frame: unknown): unknown
    takePending(): unknown
    clear(options?: { nextGeneration?: number }): unknown
  }
  export function createStreamSampler(options: {
    video: HTMLVideoElement
    onFrame: (frame: unknown) => void
    onGap?: (gap: unknown) => void
  }): {
    start(identity: { generation: number; ownerChat: string }): void
    stop(): void
  }
}
