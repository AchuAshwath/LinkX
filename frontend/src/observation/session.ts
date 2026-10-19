const BROWSER_TAB_REQUIRED = "Choose a browser tab in the share picker."
const AUDIO_NOT_ALLOWED = "Turn off audio sharing and choose a browser tab."
const TRACK_ENDED = "The shared browser tab stopped before it was ready."
const SESSION_STOPPED = "Browser tab setup was cancelled."

function stopTracks(tracks: MediaStreamTrack[]) {
  tracks.forEach((track) => {
    track.stop()
  })
}

function isBrowserVideoTrack(
  track: MediaStreamTrack | undefined,
): track is MediaStreamTrack {
  if (!track) return false
  if (track.kind !== "video") return false
  return track.getSettings().displaySurface === "browser"
}

function rejectCapture(tracks: MediaStreamTrack[], message: string): never {
  stopTracks(tracks)
  throw new Error(message)
}

function verifyCaptureGeneration({
  tracks,
  generation,
  startGeneration,
}: {
  tracks: MediaStreamTrack[]
  generation: number
  startGeneration: number
}) {
  if (generation !== startGeneration) rejectCapture(tracks, SESSION_STOPPED)
}

function verifyCaptureHasNoAudio(tracks: MediaStreamTrack[]) {
  if (tracks.some((track) => track.kind === "audio")) {
    rejectCapture(tracks, AUDIO_NOT_ALLOWED)
  }
}

function validateCapture({
  tracks,
  videoTracks,
  generation,
  startGeneration,
}: {
  tracks: MediaStreamTrack[]
  videoTracks: MediaStreamTrack[]
  generation: number
  startGeneration: number
}) {
  verifyCaptureGeneration({ tracks, generation, startGeneration })
  verifyCaptureHasNoAudio(tracks)
  if (videoTracks.length !== 1) rejectCapture(tracks, BROWSER_TAB_REQUIRED)
  const [videoTrack] = videoTracks
  if (!isBrowserVideoTrack(videoTrack)) {
    rejectCapture(tracks, BROWSER_TAB_REQUIRED)
  }
  if (videoTrack.readyState === "ended") rejectCapture(tracks, TRACK_ENDED)
}

export function createObservationSession() {
  let stream: MediaStream | undefined
  let pendingStart: Promise<MediaStream> | undefined
  let generation = 0

  return {
    start(): Promise<MediaStream> {
      if (stream) return Promise.resolve(stream)
      if (pendingStart) return pendingStart

      const startGeneration = generation
      let operation: Promise<MediaStream>
      operation = (async () => {
        const capture = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: "browser" },
          audio: false,
        })
        const tracks = capture.getTracks()
        const videoTracks = capture.getVideoTracks()
        validateCapture({ tracks, videoTracks, generation, startGeneration })

        stream = capture
        return capture
      })().finally(() => {
        if (pendingStart === operation) pendingStart = undefined
      })
      pendingStart = operation
      return operation
    },
    stop(): void {
      generation += 1
      pendingStart = undefined
      if (stream) stopTracks(stream.getTracks())
      stream = undefined
    },
  }
}
