import {
  compareTile,
  framesEqual,
  tileHasContrast,
} from "./admission-pixels.mjs"

const tileKey = (x, y) => `${x}:${y}`

export class ViewportStability {
  constructor(settings) {
    this.settings = settings
    this.reset()
  }

  reset() {
    this.initialSamples = 0
    this.initialStableFrames = 0
    this.initialTileStability = new Map()
    this.tileStability = new Map()
    this.wholeStableSince = undefined
  }

  resetChanges() {
    this.tileStability = new Map()
  }

  startInitial() {
    this.initialStableFrames = 1
  }

  updateInitial({ shape, timestamp, initialStartedAt, previousPixels }) {
    if (
      this.wholeViewSettled({
        shape,
        timestamp,
        initialStartedAt,
        previousPixels,
      })
    )
      return true
    const nextStability = new Map()
    const stableByBand = [[], [], []]
    let informativeTiles = 0
    let stableTiles = 0
    this.visitTiles(shape, (x, y) => {
      const tile = this.measureInitialTile({
        shape,
        x,
        y,
        timestamp,
        initialStartedAt,
        previousPixels,
        nextStability,
      })
      informativeTiles += tile.informative ? 1 : 0
      stableTiles += tile.stable ? 1 : 0
      if (tile.band !== null) stableByBand[tile.band].push(x)
    })
    this.initialTileStability = nextStability
    this.initialSamples += 1
    this.initialStableFrames = Math.min(this.initialStableFrames + 1, 2)
    return this.initialEvidenceReady({
      informativeTiles,
      stableTiles,
      stableByBand,
      shape,
      timestamp,
      initialStartedAt,
    })
  }

  initialEvidenceReady({
    informativeTiles,
    stableTiles,
    stableByBand,
    shape,
    timestamp,
    initialStartedAt,
  }) {
    const stableCoverage =
      informativeTiles === 0 ? 0 : stableTiles / informativeTiles
    const distributedBands = stableByBand.filter((columns) =>
      this.spansViewport(columns, shape),
    ).length
    const enoughEvidence =
      informativeTiles >= this.settings.initialMinInformativeTiles
    return (
      enoughEvidence &&
      distributedBands >= 2 &&
      stableCoverage >= this.settings.initialStableCoverage &&
      timestamp - initialStartedAt >= this.settings.initialSettleMs &&
      this.initialStableFrames >= 2
    )
  }

  wholeViewSettled({ shape, timestamp, initialStartedAt, previousPixels }) {
    if (!framesEqual(previousPixels, shape.pixels)) {
      this.wholeStableSince = undefined
      return false
    }
    this.wholeStableSince ??=
      this.initialSamples === 0 ? initialStartedAt : timestamp
    const quiet = timestamp - this.wholeStableSince >= this.settings.settleMs
    return (
      quiet && timestamp - initialStartedAt >= this.settings.initialSettleMs
    )
  }

  scanChanged({ shape, timestamp, acceptedPixels, previousPixels }) {
    const nextStability = new Map()
    const counts = {
      persistentChange: false,
      movingTiles: 0,
      movingInformativeTiles: 0,
      informativeTiles: 0,
    }
    this.visitTiles(shape, (x, y) => {
      this.measureChangedTile({
        shape,
        x,
        y,
        timestamp,
        acceptedPixels,
        previousPixels,
        nextStability,
        counts,
      })
    })
    this.tileStability = nextStability
    const movingInformativeRatio =
      counts.informativeTiles === 0
        ? 0
        : counts.movingInformativeTiles / counts.informativeTiles
    return {
      persistentChange:
        counts.persistentChange &&
        movingInformativeRatio <= this.settings.maxMovingInformativeRatio,
      movingTiles: counts.movingTiles,
      movingInformativeRatio,
    }
  }

  visitTiles(shape, visit) {
    const tileSize = this.settings.tileSize
    for (let y = 0; y < shape.height; y += tileSize) {
      for (let x = 0; x < shape.width; x += tileSize) visit(x, y)
    }
  }

  measureInitialTile({
    shape,
    x,
    y,
    timestamp,
    initialStartedAt,
    previousPixels,
    nextStability,
  }) {
    if (!this.isInformative(shape, x, y))
      return { informative: false, stable: false, band: null }
    if (this.tileMoved(previousPixels, shape, x, y))
      return { informative: true, stable: false, band: null }
    const key = tileKey(x, y)
    const prior = this.initialTileStability.get(key)
    const since =
      prior ?? (this.initialSamples === 0 ? initialStartedAt : timestamp)
    nextStability.set(key, since)
    const stable = timestamp - since >= this.settings.settleMs
    const band = stable
      ? Math.min(
          2,
          Math.floor(((y + this.settings.tileSize / 2) * 3) / shape.height),
        )
      : null
    return { informative: true, stable, band }
  }

  measureChangedTile({
    shape,
    x,
    y,
    timestamp,
    acceptedPixels,
    previousPixels,
    nextStability,
    counts,
  }) {
    const informative = this.isInformative(shape, x, y)
    counts.informativeTiles += informative ? 1 : 0
    const diff = this.compare({ acceptedPixels, previousPixels, shape, x, y })
    if (!diff.differsFromAccepted) return
    if (diff.differsFromPrevious) {
      counts.movingTiles += 1
      counts.movingInformativeTiles += informative ? 1 : 0
      nextStability.set(tileKey(x, y), { since: timestamp, frames: 1 })
      return
    }
    const prior = this.tileStability.get(tileKey(x, y))
    const stable = prior ?? { since: timestamp, frames: 1 }
    const next = { since: stable.since, frames: stable.frames + 1 }
    nextStability.set(tileKey(x, y), next)
    const settled = timestamp - next.since >= this.settings.settleMs
    if (settled && next.frames >= 2) counts.persistentChange = true
  }

  isInformative(shape, x, y) {
    return tileHasContrast({
      pixels: shape.pixels,
      width: shape.width,
      height: shape.height,
      tileX: x,
      tileY: y,
      tileSize: this.settings.tileSize,
      channelDelta: this.settings.channelDelta,
    })
  }

  tileMoved(previousPixels, shape, x, y) {
    return this.compare({
      acceptedPixels: previousPixels,
      previousPixels,
      shape,
      x,
      y,
    }).differsFromPrevious
  }

  compare({ acceptedPixels, previousPixels, shape, x, y }) {
    return compareTile({
      accepted: acceptedPixels,
      previous: previousPixels,
      current: shape.pixels,
      width: shape.width,
      height: shape.height,
      tileX: x,
      tileY: y,
      tileSize: this.settings.tileSize,
      channelDelta: this.settings.channelDelta,
    })
  }

  spansViewport(columns, shape) {
    if (columns.length < 2) return false
    return (
      Math.max(...columns) - Math.min(...columns) + this.settings.tileSize >=
      Math.max(this.settings.tileSize, shape.width * 0.4)
    )
  }
}
