import { BrowserOperationError } from "./operationError"
import type {
  BrowserContext,
  BrowserFrame,
  BrowserNote,
  BrowserReceipt,
  OperationStatus,
  PreparedBrowserQuestion,
} from "./types"

export interface BrowserReadingSnapshot {
  readonly state: "stopped" | "starting" | "ready" | "reading" | "question"
  readonly ownerChatId: string | null
  readonly threadId: string | null
  readonly draftNonce: string | null
  readonly model: string | null
  readonly pendingCount: number
  readonly noteCount: number
  readonly gapCount: number
  readonly capacityReached: boolean
  readonly currentView: BrowserFrame | null
}

export interface BrowserCaptureSource {
  start(
    onCandidate: (frame: BrowserFrame) => boolean,
    identity?: {
      generation: number
      ownerChat: string
      onGap?: () => void
      onEnded?: () => void
    },
  ): void
  stop(): void
  checkpoint?(): { sequence: number; settled: Promise<void> }
  attachPreview?(element: HTMLVideoElement | null): void
}

export interface BrowserReadingTransport {
  read(input: {
    operation_id: string
    model: string
    frame: BrowserFrame
  }): Promise<{ note: BrowserNote; operation_id: string }>
  compact(input: {
    operation_id: string
    model: string
    summary: string
    notes: readonly BrowserNote[]
  }): Promise<{ operation_id: string; summary: string }>
  settle?(operationId: string): Promise<OperationStatus>
}

export interface BrowserReadingMemory {
  append(note: BrowserNote): { status: "accepted" | "duplicate" | "capacity" }
  snapshot(cutoff?: number): {
    summary: string
    notes: readonly BrowserNote[]
  }
  needsCompaction(): boolean
  beginCompaction(): {
    version: number
    prefixIds: readonly string[]
    summary: string
    notes: readonly BrowserNote[]
  } | null
  commitCompaction(
    ticket: { version: number; prefixIds: readonly string[] },
    summary: string,
  ): boolean
  clear(): void
}

export interface BrowserReadingClock {
  now(): number
}

export interface CreateBrowserReadingSessionOptions {
  capture: BrowserCaptureSource
  transport: BrowserReadingTransport
  memory: BrowserReadingMemory
  clock?: BrowserReadingClock
  onNote?: (note: BrowserNote) => void
}

const MAX_CAPTURE_SETTLE_MS = 5_000
const MAX_PENDING = 2
// Let the 45s server call and 60s transport timeout settle before intervening.
const MAX_ACTIVE_AGE_MS = 80_000
const MAX_SESSION_AGE_MS = 30 * 60 * 1000
const MAX_FRAME_AGE_MS = 5 * 60 * 1000
const MAX_ADMITTED_JOBS = 200
const MAX_IMAGE_CHARS = 2_000_000
const MAX_EDGE = 2048
const JPEG_DATA_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/

interface Generation {
  readonly value: number
  readonly controller: AbortController
}

interface QuestionPreparation {
  ownerId: string
  model: string
  cutoff: number
  frames: BrowserFrame[]
}

interface ActiveRead {
  operationId: string
  generation: Generation
  promise: Promise<void>
}

interface ActiveCompaction {
  operationId: string
  generation: Generation
  promise: Promise<void>
}

interface ActiveQuestion {
  capturePending: boolean
  cutoff: number
  operationId: string
  ownerId: string
  model: string
  frames: BrowserFrame[]
  noteIds: Set<string>
  settled: boolean
  dispatched: boolean
}

function makeId(): string {
  return crypto.randomUUID()
}

function isOperationSettled(status: OperationStatus | null): boolean {
  return status?.state === "settled"
}

function hasValidFrameIdentity(frame: BrowserFrame): boolean {
  return Boolean(frame.id) && frame.sequence >= 1
}

function hasValidFrameDimensions(frame: BrowserFrame): boolean {
  const withinMinimum = frame.width >= 1 && frame.height >= 1
  const withinMaximum = frame.width <= MAX_EDGE && frame.height <= MAX_EDGE
  return withinMinimum && withinMaximum
}

function hasValidImage(frame: BrowserFrame): boolean {
  const withinSizeLimit = frame.image_data_url.length <= MAX_IMAGE_CHARS
  return withinSizeLimit && JPEG_DATA_URL.test(frame.image_data_url)
}

function isRecentlyCaptured(frame: BrowserFrame, now: number): boolean {
  const age = now - Date.parse(frame.captured_at)
  return Number.isFinite(age) && age >= -5_000 && age <= MAX_FRAME_AGE_MS
}

function validFrame(frame: BrowserFrame, now: number): boolean {
  return (
    hasValidFrameIdentity(frame) &&
    hasValidFrameDimensions(frame) &&
    hasValidImage(frame) &&
    isRecentlyCaptured(frame, now)
  )
}

function initialSnapshot(): BrowserReadingSnapshot {
  return {
    state: "stopped",
    ownerChatId: null,
    threadId: null,
    draftNonce: null,
    model: null,
    pendingCount: 0,
    noteCount: 0,
    gapCount: 0,
    capacityReached: false,
    currentView: null,
  }
}

function waitForAbortable<T>(
  ready: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(new DOMException("Question cancelled", "AbortError"))
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener("abort", abort, { once: true })
    void ready.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort)
    })
  })
}

async function settleCaptureCheckpoint(
  settled: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await waitForAbortable(
      Promise.race([
        settled,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("Browser capture did not settle")),
            MAX_CAPTURE_SETTLE_MS,
          )
        }),
      ]),
      signal,
    )
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function createBrowserReadingSession(
  options: CreateBrowserReadingSessionOptions,
) {
  const clock = options.clock ?? { now: () => Date.now() }
  const listeners = new Set<() => void>()
  const sourceEndedListeners = new Set<() => void>()
  const seenIds = new Set<string>()
  const knownFrameIds = new Set<string>()
  const ignoredOperations = new Set<string>()
  let snapshot = initialSnapshot()
  let generation: Generation = { value: 0, controller: new AbortController() }
  let startedAt = 0
  let sequence = 0
  let admittedJobs = 0
  let queue: BrowserFrame[] = []
  let activeRead: ActiveRead | null = null
  let activeCompaction: ActiveCompaction | null = null
  let question: ActiveQuestion | null = null
  let preparing = false
  const blockedOperations = new Set<string>()
  let sessionId = makeId()

  function releaseOperation(operationId: string): void {
    blockedOperations.delete(operationId)
  }

  function hasOrphanedOperation(): boolean {
    return [...blockedOperations].some(
      (id) =>
        id !== activeRead?.operationId && id !== activeCompaction?.operationId,
    )
  }

  async function waitForActiveOperation(
    active: ActiveRead | ActiveCompaction,
    expectedGeneration: Generation,
  ): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = await waitForAbortable(
      Promise.race([
        active.promise.then(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(true), MAX_ACTIVE_AGE_MS)
        }),
      ]),
      expectedGeneration.controller.signal,
    ).catch(() => false)
    if (timer) clearTimeout(timer)
    if (generation !== expectedGeneration) return false
    if (!timedOut) return true
    const settled = await settleOperation(
      active.operationId,
      expectedGeneration,
    )
    addGap()
    return settled
  }

  function publish(): void {
    snapshot = {
      ...snapshot,
      pendingCount: queue.length + (question?.frames.length ?? 0),
      state: getState(),
    }
    listeners.forEach((listener) => {
      listener()
    })
  }

  function getState(): BrowserReadingSnapshot["state"] {
    if (!snapshot.ownerChatId && !snapshot.draftNonce && !snapshot.threadId) {
      return "stopped"
    }
    if (question) return "question"
    if (activeRead) return "reading"
    return "ready"
  }

  function addGap(): void {
    snapshot = { ...snapshot, gapCount: Math.min(200, snapshot.gapCount + 1) }
  }

  function remember(
    note: BrowserNote,
    expectedGeneration: Generation,
  ): boolean {
    if (generation !== expectedGeneration) return false
    if (seenIds.has(note.id)) {
      addGap()
      return false
    }
    const appendResult = options.memory.append(note)
    if (appendResult.status !== "accepted") {
      addGap()
      if (appendResult.status === "capacity") {
        snapshot = { ...snapshot, capacityReached: true }
      }
      return false
    }
    seenIds.add(note.id)
    const memorySnapshot = options.memory.snapshot()
    snapshot = { ...snapshot, noteCount: memorySnapshot.notes.length }
    options.onNote?.(note)
    void compactIfNeeded(snapshot.model ?? "", expectedGeneration)
    return true
  }

  function shouldCompact(expectedGeneration: Generation): boolean {
    if (generation !== expectedGeneration) return false
    if (question || preparing) return false
    if (activeCompaction) return false
    return options.memory.needsCompaction()
  }

  function handleCompactionResult(
    result: { operation_id: string; summary: string },
    ticket: NonNullable<ReturnType<BrowserReadingMemory["beginCompaction"]>>,
    operationId: string,
    expectedGeneration: Generation,
  ): void {
    if (
      generation !== expectedGeneration ||
      ignoredOperations.has(operationId)
    ) {
      return
    }
    if (result.operation_id !== operationId) {
      addGap()
      void settleOperation(operationId, expectedGeneration)
      return
    }
    if (!ticket) return
    const committed = options.memory.commitCompaction(ticket, result.summary)
    releaseOperation(operationId)
    if (committed && admittedJobs < MAX_ADMITTED_JOBS) {
      snapshot = { ...snapshot, capacityReached: false }
    }
    snapshot = {
      ...snapshot,
      noteCount: options.memory.snapshot().notes.length,
    }
    publish()
  }

  function handleCompactionFailure(
    operationId: string,
    expectedGeneration: Generation,
    error: unknown,
  ): void {
    if (
      generation !== expectedGeneration ||
      ignoredOperations.has(operationId)
    ) {
      return
    }
    addGap()
    recoverOperationFailure(operationId, expectedGeneration, error)
  }

  async function compactIfNeeded(
    model: string,
    expectedGeneration: Generation,
  ): Promise<void> {
    if (!shouldCompact(expectedGeneration)) return
    const ticket = options.memory.beginCompaction()
    if (!ticket) return
    const operationId = makeId()
    blockedOperations.add(operationId)
    const promise = options.transport
      .compact({
        operation_id: operationId,
        model,
        summary: ticket.summary,
        notes: ticket.notes,
      })
      .then((result) =>
        handleCompactionResult(result, ticket, operationId, expectedGeneration),
      )
      .catch((error) =>
        handleCompactionFailure(operationId, expectedGeneration, error),
      )
      .finally(() => {
        if (activeCompaction?.operationId !== operationId) return
        activeCompaction = null
        if (generation === expectedGeneration) {
          publish()
          drain(expectedGeneration)
        }
      })
    activeCompaction = { operationId, generation: expectedGeneration, promise }
    await promise
  }

  function discardExpired(): void {
    const now = clock.now()
    const valid = queue.filter((frame) => validFrame(frame, now))
    if (valid.length !== queue.length) addGap()
    queue = valid
  }

  function discardExpiredFrames(frames: BrowserFrame[]): BrowserFrame[] {
    const valid = frames.filter((frame) => validFrame(frame, clock.now()))
    if (valid.length !== frames.length) addGap()
    return valid
  }

  function isActiveGenerationOwner(expectedGeneration: Generation): boolean {
    const ownsSession = Boolean(snapshot.ownerChatId || snapshot.draftNonce)
    return generation === expectedGeneration && ownsSession
  }

  function isPastAdmissionDeadline(): boolean {
    return clock.now() - startedAt > MAX_SESSION_AGE_MS
  }

  function isNewFrame(frame: BrowserFrame): boolean {
    if (!validFrame(frame, clock.now())) return false
    if (frame.sequence <= sequence) return false
    return !knownFrameIds.has(frame.id)
  }

  function hasQueueCapacity(frame: BrowserFrame): boolean {
    if (question?.capturePending && frame.sequence > question.cutoff)
      return false
    const reservedCount = question?.frames.length ?? 0
    return queue.length + reservedCount < MAX_PENDING
  }

  function markAdmissionCapacity(): void {
    snapshot = { ...snapshot, capacityReached: true }
    addGap()
    publish()
  }

  function admitFrame(
    frame: BrowserFrame,
    expectedGeneration: Generation,
  ): void {
    sequence = Math.max(sequence, frame.sequence)
    const belongsToQuestion =
      preparing && question && frame.sequence <= question.cutoff
    if (belongsToQuestion) question?.frames.push(frame)
    else queue.push(frame)
    knownFrameIds.add(frame.id)
    admittedJobs += 1
    publish()
    drain(expectedGeneration)
  }

  function offer(frame: BrowserFrame, expectedGeneration: Generation): boolean {
    if (!isActiveGenerationOwner(expectedGeneration)) return true
    if (isPastAdmissionDeadline()) {
      markAdmissionCapacity()
      return true
    }
    if (!isNewFrame(frame)) {
      addGap()
      publish()
      return true
    }
    if (!hasQueueCapacity(frame)) return false
    if (admittedJobs >= MAX_ADMITTED_JOBS) {
      markAdmissionCapacity()
      return true
    }
    admitFrame(frame, expectedGeneration)
    return true
  }

  function canDrain(): boolean {
    return Boolean(
      !activeRead &&
        !activeCompaction &&
        !hasOrphanedOperation() &&
        !preparing &&
        !question &&
        queue.length,
    )
  }

  function handleReadResult(
    result: { note: BrowserNote; operation_id: string },
    operationId: string,
    expectedGeneration: Generation,
  ): void {
    if (
      generation !== expectedGeneration ||
      ignoredOperations.has(operationId)
    ) {
      return
    }
    if (result.operation_id !== operationId) {
      addGap()
      void settleOperation(operationId, expectedGeneration)
      return
    }
    releaseOperation(operationId)
    remember(result.note, expectedGeneration)
  }

  function handleReadFailure(
    operationId: string,
    expectedGeneration: Generation,
    error: unknown,
  ): void {
    if (
      generation !== expectedGeneration ||
      ignoredOperations.has(operationId)
    ) {
      return
    }
    addGap()
    recoverOperationFailure(operationId, expectedGeneration, error)
  }

  function recoverOperationFailure(
    operationId: string,
    expectedGeneration: Generation,
    error: unknown,
  ): void {
    if (error instanceof BrowserOperationError) {
      releaseOperation(operationId)
      return
    }
    void settleOperation(operationId, expectedGeneration)
  }

  function finishRead({
    operationId,
    generation: expectedGeneration,
  }: Pick<ActiveRead, "operationId" | "generation">): void {
    if (generation !== expectedGeneration) return
    if (activeRead?.operationId !== operationId) return
    activeRead = null
    publish()
    drain(expectedGeneration)
  }

  function startRead(
    frame: BrowserFrame,
    model: string,
    expectedGeneration: Generation,
  ): void {
    const operationId = makeId()
    const readPromise = options.transport
      .read({ operation_id: operationId, model, frame })
      .then((result) =>
        handleReadResult(result, operationId, expectedGeneration),
      )
      .catch((error) =>
        handleReadFailure(operationId, expectedGeneration, error),
      )
      .finally(() =>
        finishRead({ operationId, generation: expectedGeneration }),
      )
    activeRead = {
      operationId,
      generation: expectedGeneration,
      promise: readPromise,
    }
    blockedOperations.add(operationId)
    publish()
  }

  function drain(expectedGeneration: Generation): void {
    if (!canDrain()) return
    discardExpired()
    const frame = queue.shift()
    if (!frame) return
    const model = snapshot.model
    if (!model) {
      queue.unshift(frame)
      return
    }
    startRead(frame, model, expectedGeneration)
  }

  async function settleOperation(
    operationId: string,
    expectedGeneration: Generation,
  ): Promise<boolean> {
    let status: OperationStatus | null = null
    try {
      status = (await options.transport.settle?.(operationId)) ?? null
    } catch {
      status = null
    }
    if (!isOperationSettled(status)) return false
    ignoredOperations.add(operationId)
    releaseOperation(operationId)
    if (generation === expectedGeneration) {
      if (activeRead?.operationId === operationId) activeRead = null
      if (activeCompaction?.operationId === operationId) {
        activeCompaction = null
      }
      publish()
      drain(expectedGeneration)
    }
    return true
  }

  function currentOwnerMatches(ownerId: string): boolean {
    if (snapshot.threadId) return ownerId === snapshot.threadId
    return ownerId === snapshot.ownerChatId || ownerId === snapshot.draftNonce
  }

  function createContext({
    frames,
    cutoff,
  }: Pick<QuestionPreparation, "frames" | "cutoff">): BrowserContext {
    const memory = options.memory.snapshot(cutoff)
    return {
      session_id: sessionId,
      generation: generation.value,
      cutoff,
      summary: memory.summary,
      notes: memory.notes,
      pending_frames: frames,
      current_view: null,
      gap_count: snapshot.gapCount,
    }
  }

  function isValidReceipt(
    receipt: BrowserReceipt,
    activeQuestion: ActiveQuestion,
  ): boolean {
    const expectedIds = new Set(activeQuestion.frames.map((frame) => frame.id))
    const receivedIds = [
      ...receipt.completed_ids,
      ...receipt.failed_ids,
      ...receipt.unused_ids,
    ]
    const uniqueIds = new Set(receivedIds)
    const hasExactPartition =
      uniqueIds.size === receivedIds.length &&
      uniqueIds.size === expectedIds.size &&
      [...expectedIds].every((id) => uniqueIds.has(id))
    return (
      receipt.operation_id === activeQuestion.operationId && hasExactPartition
    )
  }

  function recordReceiptGaps(
    receipt: BrowserReceipt,
    activeQuestion: ActiveQuestion,
  ): void {
    const completed = new Set(receipt.completed_ids)
    const missingNotes = [...completed].some(
      (id) => !activeQuestion.noteIds.has(id),
    )
    const unexpectedNotes = [...activeQuestion.noteIds].some(
      (id) => !completed.has(id),
    )
    if (missingNotes || unexpectedNotes || receipt.failed_ids.length) addGap()
    receipt.failed_ids.forEach((id) => {
      seenIds.add(id)
    })
  }

  function returnUnusedFrames(
    receipt: BrowserReceipt,
    activeQuestion: ActiveQuestion,
  ): void {
    for (const id of receipt.unused_ids) {
      const frame = activeQuestion.frames.find((item) => item.id === id)
      if (!frame) continue
      if (queue.length >= MAX_PENDING) {
        addGap()
        continue
      }
      queue.push(frame)
      queue.sort((left, right) => left.sequence - right.sequence)
    }
  }

  function consumeReceipt(
    receipt: BrowserReceipt,
    activeQuestion: ActiveQuestion,
  ): boolean {
    const valid = isValidReceipt(receipt, activeQuestion)
    if (!valid) {
      addGap()
      return false
    }
    recordReceiptGaps(receipt, activeQuestion)
    returnUnusedFrames(receipt, activeQuestion)
    return true
  }

  function canPrepareQuestion(ownerId: string): boolean {
    if (!currentOwnerMatches(ownerId)) return false
    return !question && !preparing
  }

  function matchesQuestionFrame(note: BrowserNote): boolean {
    if (!question) return false
    const frame = question.frames.find((item) => item.id === note.id)
    return frame?.sequence === note.sequence
  }

  function finishPreparation({
    ownerId,
    model,
    cutoff,
    frames,
  }: QuestionPreparation): PreparedBrowserQuestion {
    const eligibleFrames = discardExpiredFrames(frames)
    const operationId = makeId()
    question = {
      capturePending: false,
      cutoff,
      operationId,
      ownerId,
      model,
      frames: eligibleFrames,
      noteIds: new Set(),
      settled: false,
      dispatched: false,
    }
    preparing = false
    const context = createContext({ frames: eligibleFrames, cutoff })
    snapshot = { ...snapshot, currentView: null }
    publish()
    return { context, operation_id: operationId, model }
  }

  interface PreparationBarrier {
    expectedGeneration: Generation
    operationId: string
    cutoff: number
    active: ActiveRead | null
    compaction: ActiveCompaction | null
    capture: Promise<void>
  }

  function isCurrentQuestion(barrier: PreparationBarrier): boolean {
    if (generation !== barrier.expectedGeneration) return false
    return question?.operationId === barrier.operationId
  }

  async function waitForPreparationWork(
    barrier: PreparationBarrier,
  ): Promise<boolean> {
    for (const operation of [barrier.active, barrier.compaction]) {
      if (!operation) continue
      const settled = await waitForActiveOperation(
        operation,
        barrier.expectedGeneration,
      )
      if (!settled) return false
    }
    return settleOrphanedOperations(barrier.expectedGeneration)
  }

  async function completeQuestionPreparation(
    barrier: PreparationBarrier,
  ): Promise<BrowserContext | null> {
    await settleCaptureCheckpoint(
      barrier.capture,
      barrier.expectedGeneration.controller.signal,
    )
    if (isCurrentQuestion(barrier) && question) question.capturePending = false
    const safeToDispatch = await waitForPreparationWork(barrier)
    if (!isCurrentQuestion(barrier)) return null
    preparing = false
    if (!safeToDispatch || !question) return null
    question.frames = discardExpiredFrames(question.frames)
    publish()
    return createContext({ frames: question.frames, cutoff: barrier.cutoff })
  }

  async function settleOrphanedOperations(
    expectedGeneration: Generation,
  ): Promise<boolean> {
    if (blockedOperations.size === 0) return generation === expectedGeneration
    const statuses = await Promise.all(
      [...blockedOperations].map((id) =>
        settleOperation(id, expectedGeneration),
      ),
    )
    return statuses.every(Boolean) && generation === expectedGeneration
  }

  function queueQuestion(ownerId: string): PreparedBrowserQuestion | null {
    if (!canPrepareQuestion(ownerId)) return null
    if (isPastAdmissionDeadline()) {
      snapshot = { ...snapshot, capacityReached: true }
    }
    const expectedGeneration = generation
    // Include pre-Send encoder work without admitting later browsing into this turn.
    const checkpoint = options.capture.checkpoint?.()
    const cutoff = Math.max(sequence, checkpoint?.sequence ?? sequence)
    discardExpired()
    const frames = queue.splice(0, MAX_PENDING)
    const prepared = finishPreparation({
      ownerId,
      model: snapshot.model ?? "",
      cutoff,
      frames,
    })
    preparing = true
    if (question) question.capturePending = Boolean(checkpoint)
    const ready = completeQuestionPreparation({
      expectedGeneration,
      cutoff,
      operationId: prepared.operation_id,
      active: activeRead,
      compaction: activeCompaction,
      capture: checkpoint?.settled ?? Promise.resolve(),
    }).catch(() => null)
    return {
      ...prepared,
      ready: questionReadiness(ready, prepared.operation_id),
    }
  }

  function questionReadiness(
    ready: Promise<BrowserContext | null>,
    operationId: string,
  ): NonNullable<PreparedBrowserQuestion["ready"]> {
    return async (signal) => {
      const context = await waitForAbortable(ready, signal)
      if (!context)
        throw new Error(
          "Browser processing could not settle. Your question was not sent to the model.",
        )
      if (question?.operationId !== operationId)
        throw new Error(
          "Browser sharing stopped before this question was sent.",
        )
      return context
    }
  }

  function activeOperationIds(): string[] {
    const ids = [
      ...blockedOperations,
      activeRead?.operationId,
      activeCompaction?.operationId,
      question?.dispatched ? question.operationId : undefined,
    ].filter((operationId): operationId is string => Boolean(operationId))
    return [...new Set(ids)]
  }

  async function settleStoppedOperations(
    operationIds: string[],
    stopGeneration: Generation,
  ): Promise<void> {
    const statuses = await Promise.all(
      operationIds.map(
        (operationId) =>
          options.transport.settle?.(operationId).catch(() => null) ?? null,
      ),
    )
    if (generation !== stopGeneration) return
    statuses.forEach((status, index) => {
      if (isOperationSettled(status)) releaseOperation(operationIds[index])
    })
    publish()
    drain(stopGeneration)
  }

  function stopSession(): void {
    generation.controller.abort()
    generation = {
      value: generation.value + 1,
      controller: new AbortController(),
    }
    const stopGeneration = generation
    const activeOperations = activeOperationIds()
    activeOperations.forEach((operationId) => {
      blockedOperations.add(operationId)
    })
    options.capture.stop()
    queue = []
    activeRead = null
    activeCompaction = null
    question = null
    preparing = false
    admittedJobs = 0
    seenIds.clear()
    knownFrameIds.clear()
    ignoredOperations.clear()
    options.memory.clear()
    snapshot = initialSnapshot()
    publish()
    if (activeOperations.length > 0)
      void settleStoppedOperations(activeOperations, stopGeneration)
  }

  return {
    start(
      ownerChatId: string | null,
      draftNonce: string,
      model: string,
    ): boolean {
      if (snapshot.state !== "stopped" || blockedOperations.size > 0)
        return false
      generation.controller.abort()
      generation = {
        value: generation.value + 1,
        controller: new AbortController(),
      }
      const startGeneration = generation
      sessionId = makeId()
      startedAt = clock.now()
      sequence = 0
      admittedJobs = 0
      snapshot = {
        ...initialSnapshot(),
        state: "starting",
        ownerChatId,
        draftNonce,
        model,
      }
      publish()
      options.capture.start((frame) => offer(frame, startGeneration), {
        generation: startGeneration.value,
        ownerChat: ownerChatId ?? draftNonce,
        onGap: () => {
          if (generation !== startGeneration) return
          addGap()
          publish()
        },
        onEnded: () => {
          if (generation !== startGeneration) return
          sourceEndedListeners.forEach((listener) => {
            listener()
          })
          stopSession()
        },
      })
      snapshot = { ...snapshot, state: "ready" }
      publish()
      return true
    },

    stop(): void {
      stopSession()
    },

    attachPreview(element: HTMLVideoElement | null): void {
      options.capture.attachPreview?.(element)
    },

    bindToThread(input: { draftNonce: string; threadId: string }): boolean {
      if (snapshot.draftNonce !== input.draftNonce || !input.threadId) {
        return false
      }
      if (snapshot.threadId && snapshot.threadId !== input.threadId)
        return false
      snapshot = { ...snapshot, threadId: input.threadId }
      publish()
      return true
    },

    setOwnerModel(model: string): void {
      if (snapshot.state === "stopped" || !model) return
      snapshot = { ...snapshot, model }
      publish()
    },

    queueQuestion,

    async prepareQuestion(
      ownerId: string,
    ): Promise<PreparedBrowserQuestion | null> {
      const prepared = queueQuestion(ownerId)
      if (!prepared) return null
      try {
        const context = await prepared.ready?.(new AbortController().signal)
        return { ...prepared, context: context ?? prepared.context }
      } catch {
        this.cancelPreparedQuestion(prepared.operation_id)
        return null
      }
    },

    receiveNote(note: BrowserNote): void {
      if (!question) {
        addGap()
        publish()
        return
      }
      if (!matchesQuestionFrame(note)) {
        addGap()
        publish()
        return
      }
      if (note.text.length > 8000) {
        addGap()
        publish()
        return
      }
      if (seenIds.has(note.id)) {
        addGap()
        publish()
        return
      }
      if (remember(note, generation)) question.noteIds.add(note.id)
      publish()
    },

    finishQuestion(receipt: BrowserReceipt): boolean {
      if (!question || question.settled) return false
      const activeQuestion = question
      const valid = consumeReceipt(receipt, activeQuestion)
      question.settled = true
      question = null
      publish()
      void compactIfNeeded(snapshot.model ?? "", generation)
      drain(generation)
      return valid
    },

    async interruptQuestion(): Promise<void> {
      if (!question) return
      const operationId = question.operationId
      if (!question.dispatched) {
        this.cancelPreparedQuestion(operationId)
        return
      }
      blockedOperations.add(operationId)
      const expectedGeneration = generation
      addGap()
      question = null
      publish()
      const safeToResume = await settleOperation(
        operationId,
        expectedGeneration,
      )
      if (generation !== expectedGeneration) return
      publish()
      if (!safeToResume) return
      drain(generation)
    },

    cancelPreparedQuestion(operationId: string): boolean {
      if (!question || question.operationId !== operationId) return false
      const frames = question.frames
      question = null
      preparing = false
      const nowValid = discardExpiredFrames(frames)
      queue = [...nowValid, ...queue]
        .sort((left, right) => left.sequence - right.sequence)
        .slice(0, MAX_PENDING)
      publish()
      drain(generation)
      return true
    },

    markQuestionDispatched(operationId: string): boolean {
      if (!question || question.operationId !== operationId) return false
      question.dispatched = true
      return true
    },

    isPreparedQuestionActive(operationId: string): boolean {
      return question?.operationId === operationId && !question.settled
    },

    getSnapshot(): BrowserReadingSnapshot {
      return snapshot
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    subscribeSourceEnded(listener: () => void): () => void {
      sourceEndedListeners.add(listener)
      return () => sourceEndedListeners.delete(listener)
    },
  }
}

export type BrowserReadingSession = ReturnType<
  typeof createBrowserReadingSession
>
