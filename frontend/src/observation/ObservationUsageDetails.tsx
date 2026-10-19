import type { ObservationUsagePayload } from "@/hooks/useAIChatStream"

interface ObservationUsageDetailsProps {
  usage: ObservationUsagePayload
  onReset: () => void
}

function UsageValue({
  label,
  value,
  title,
}: {
  label: string
  value: string | number
  title?: string
}) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd title={title} className="truncate font-medium text-foreground">
        {value}
      </dd>
    </div>
  )
}

function readableTimestamp(value: string) {
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) return value
  return timestamp.toLocaleString()
}

export function ObservationUsageDetails({
  usage,
  onReset,
}: ObservationUsageDetailsProps) {
  return (
    <details className="rounded-lg border border-border bg-background/80 px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Browser context details
      </summary>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <UsageValue
          label="Estimated input tokens"
          value={usage.estimated_input_tokens}
        />
        <UsageValue label="Input limit" value={usage.input_limit} />
        <UsageValue label="Output reserve" value={usage.output_reserve} />
        <UsageValue label="Model" value={usage.model_id} />
        <UsageValue label="Frames sent" value={usage.frame_count} />
        <UsageValue label="Prior frames" value={usage.history_frames} />
        <UsageValue label="Snapshot revision" value={usage.revision} />
        <UsageValue label="Source epoch" value={usage.source_epoch} />
        <UsageValue
          label="Snapshot dimensions"
          value={`${usage.width} × ${usage.height}`}
        />
        <UsageValue
          label="Captured at"
          value={readableTimestamp(usage.captured_at)}
          title={usage.captured_at}
        />
        <UsageValue
          label="Delivered at"
          value={readableTimestamp(usage.delivered_at)}
          title={usage.delivered_at}
        />
        <UsageValue
          label="Frame presented at (ms)"
          value={usage.frame_presented_at_ms ?? "Unavailable"}
        />
      </dl>
      <p className="mt-3 text-muted-foreground">
        One current snapshot was submitted for this reply. LinkX does not store
        screenshot history; your configured model provider may retain submitted
        images. Reset, reload, or changing chats clears these local details.
        Earlier answers remain text only.
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-2 rounded-md px-2 py-1 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Reset browser context
      </button>
    </details>
  )
}
