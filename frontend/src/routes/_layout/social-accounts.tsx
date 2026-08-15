import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  AlertTriangle,
  Check,
  Copy,
  Folder,
  Loader2,
  RefreshCw,
} from "lucide-react"
import * as React from "react"
import { FaLinkedinIn, FaXTwitter } from "react-icons/fa6"
import { z } from "zod"

import { AuthService, LinkedinService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import useCustomToast from "@/hooks/useCustomToast"

const searchSchema = z.object({
  linkedin: z.string().optional(),
})

export const Route = createFileRoute("/_layout/social-accounts")({
  component: ConnectedAccountsPage,
  validateSearch: (search) => searchSchema.parse(search),
})

interface HeaderProps {
  onRefresh: () => void
  isRefetching: boolean
}

function SocialAccountsHeader({ onRefresh, isRefetching }: HeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4 border-b pb-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Connected Accounts
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Connect API keys and browser sessions for publishing automation.
        </p>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-full cursor-pointer"
            onClick={onRefresh}
            disabled={isRefetching}
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Refresh connection states</TooltipContent>
      </Tooltip>
    </div>
  )
}

interface LinkedInRowProps {
  isConnected: boolean
  needsReconnect: boolean
  profile?: {
    display_name?: string
    email?: string
    profile_picture_url?: string
  }
  isConnecting: boolean
  isDisconnecting: boolean
  onConnect: () => void
  onDisconnect: () => void
}

function LinkedInStatusBadge({
  isConnected,
  needsReconnect,
}: {
  isConnected: boolean
  needsReconnect: boolean
}) {
  if (isConnected) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium bg-emerald-500/10 px-2.5 py-0.5 rounded-full">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Connected
      </span>
    )
  }

  if (needsReconnect) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 font-medium bg-amber-500/10 px-2.5 py-0.5 rounded-full">
        <AlertTriangle className="h-3 w-3" /> Token Expired
      </span>
    )
  }

  return (
    <span className="text-[11px] text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full font-medium">
      Disconnected
    </span>
  )
}

function LinkedInActions({
  isConnected,
  needsReconnect,
  isConnecting,
  isDisconnecting,
  onConnect,
  onDisconnect,
}: {
  isConnected: boolean
  needsReconnect: boolean
  isConnecting: boolean
  isDisconnecting: boolean
  onConnect: () => void
  onDisconnect: () => void
}) {
  if (isConnected) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={onDisconnect}
        disabled={isDisconnecting}
        className="h-8 px-4 text-xs font-semibold border-destructive/30 text-destructive bg-destructive/5 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-all shadow-none rounded-full cursor-pointer"
      >
        {isDisconnecting ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Disconnecting…
          </span>
        ) : (
          "Disconnect"
        )}
      </Button>
    )
  }

  if (needsReconnect) {
    return (
      <Button
        onClick={onConnect}
        disabled={isConnecting}
        size="sm"
        className="h-8 px-4 text-xs font-semibold bg-[#0077b5] hover:bg-[#0077b5]/90 text-white shadow-none rounded-full cursor-pointer"
      >
        {isConnecting ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Connecting…
          </span>
        ) : (
          "Reconnect"
        )}
      </Button>
    )
  }

  return (
    <Button
      onClick={onConnect}
      disabled={isConnecting}
      size="sm"
      className="h-8 px-4 text-xs font-semibold bg-[#0077b5] hover:bg-[#0077b5]/90 text-white shadow-none rounded-full cursor-pointer"
    >
      {isConnecting ? (
        <span className="flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Connecting…
        </span>
      ) : (
        "Connect"
      )}
    </Button>
  )
}

function LinkedInRow({
  isConnected,
  needsReconnect,
  profile,
  isConnecting,
  isDisconnecting,
  onConnect,
  onDisconnect,
}: LinkedInRowProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:px-6 hover:bg-muted/10 transition-colors">
      <div className="flex items-center gap-3.5 min-w-0">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0077b5]/10 text-[#0077b5]">
          <FaLinkedinIn className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">LinkedIn</span>
            <Badge
              variant="outline"
              className="text-[11px] py-0 px-2 font-normal text-muted-foreground rounded-full"
            >
              OAuth 2.0 API
            </Badge>
            <LinkedInStatusBadge
              isConnected={isConnected}
              needsReconnect={needsReconnect}
            />
          </div>
          <div className="text-xs text-muted-foreground truncate mt-0.5">
            {isConnected && profile ? (
              <span className="text-foreground/80">
                {profile.display_name} {profile.email && `(${profile.email})`}
              </span>
            ) : (
              <span>
                Official REST API connection for posting and scheduling.
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 sm:self-center">
        <LinkedInActions
          isConnected={isConnected}
          needsReconnect={needsReconnect}
          isConnecting={isConnecting}
          isDisconnecting={isDisconnecting}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
        />
      </div>
    </div>
  )
}

interface CliSnippetProps {
  label: string
  command: string
  copiedKey: string | null
  onCopy: (text: string, key: string, label: string) => void
  copyKey: string
}

function CliCommandSnippet({
  label,
  command,
  copiedKey,
  onCopy,
  copyKey,
}: CliSnippetProps) {
  return (
    <div className="space-y-1">
      <span className="text-[11px] text-muted-foreground font-medium pl-0.5">
        {label}
      </span>
      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-muted/30 border border-border/60 text-xs text-foreground/90 shadow-none group">
        <span className="truncate select-all flex items-center gap-2 text-xs font-mono">
          <span className="text-muted-foreground/60 select-none">$</span>
          <span className="text-primary font-medium">{command}</span>
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0 rounded-full cursor-pointer"
              onClick={() => onCopy(command, copyKey, label)}
            >
              {copiedKey === copyKey ? (
                <Check className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Copy command</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

interface XRowProps {
  isCookiePresent: boolean
  sessionPath: string
  isCliExpanded: boolean
  onToggleCli: () => void
  isConnecting: boolean
  isVerifying: boolean
  onConnect: () => void
  onVerify: () => void
  copiedKey: string | null
  onCopy: (text: string, key: string, label: string) => void
}

function XRow({
  isCookiePresent,
  sessionPath,
  isCliExpanded,
  onToggleCli,
  isConnecting,
  isVerifying,
  onConnect,
  onVerify,
  copiedKey,
  onCopy,
}: XRowProps) {
  const headedLoginCmd = "uv run python scripts/headed_login.py --platform x"
  const testSessionCmd = "uv run python scripts/test_session.py --platform x"

  return (
    <div className="flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:px-6 hover:bg-muted/10 transition-colors">
        <button
          type="button"
          onClick={onToggleCli}
          className="flex items-center gap-3.5 min-w-0 text-left cursor-pointer flex-1 group focus:outline-none"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-foreground/10 text-foreground group-hover:bg-foreground/15 transition-colors">
            <FaXTwitter className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">X (Twitter)</span>
              <Badge
                variant="outline"
                className="text-[11px] py-0 px-2 font-normal text-muted-foreground rounded-full"
              >
                Browser Profile
              </Badge>
              {isCookiePresent ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium bg-emerald-500/10 px-2.5 py-0.5 rounded-full">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{" "}
                  Session Active
                </span>
              ) : (
                <span className="text-[11px] text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full font-medium">
                  No Session
                </span>
              )}
            </div>

            {/* Session Path with embedded copy button */}
            <div className="flex items-center gap-1.5 mt-1">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/60 border border-border/50 text-xs text-foreground/80 group/path">
                <Folder className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                <code className="text-[11px] font-mono truncate max-w-[180px] sm:max-w-[260px] select-all">
                  {sessionPath}
                </code>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground p-0.5 rounded-full transition-colors ml-0.5 focus:outline-none cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation()
                        onCopy(sessionPath, "path", "Session path")
                      }}
                    >
                      {copiedKey === "path" ? (
                        <Check className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Copy session path</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        </button>

        {/* Right Action Hub without decorative button icons */}
        <div className="flex items-center gap-2 shrink-0 sm:self-center">
          <Button
            onClick={onConnect}
            disabled={isConnecting}
            size="sm"
            variant="outline"
            className={`h-8 px-4 text-xs font-semibold rounded-full cursor-pointer shadow-none border-border/80 hover:bg-muted/40 ${
              isCookiePresent ? "min-w-[5.5rem] justify-center" : ""
            }`}
          >
            {isConnecting ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Launching…
              </span>
            ) : isCookiePresent ? (
              "Re-login"
            ) : (
              "Launch Login"
            )}
          </Button>

          {isCookiePresent && (
            <Button
              size="sm"
              onClick={onVerify}
              disabled={isVerifying}
              className="h-8 px-4 min-w-[5.5rem] justify-center text-xs font-semibold shadow-none rounded-full cursor-pointer"
            >
              {isVerifying ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Verifying…
                </span>
              ) : (
                "Verify"
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Expandable CLI command snippets */}
      {isCliExpanded && (
        <div className="p-4 sm:px-6 sm:pb-5 pt-2 bg-muted/10 border-t border-border/40 space-y-3 animate-in slide-in-from-top-1 duration-150">
          <CliCommandSnippet
            label="1. Headed Login"
            command={headedLoginCmd}
            copiedKey={copiedKey}
            onCopy={onCopy}
            copyKey="cli-login"
          />
          <CliCommandSnippet
            label="2. Verify Session"
            command={testSessionCmd}
            copiedKey={copiedKey}
            onCopy={onCopy}
            copyKey="cli-verify"
          />
        </div>
      )}
    </div>
  )
}

function ConnectedAccountsPage() {
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const queryClient = useQueryClient()
  const search = Route.useSearch()
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null)
  const [isCliExpanded, setIsCliExpanded] = React.useState<boolean>(false)

  React.useEffect(() => {
    if (search.linkedin === "connected") {
      showSuccessToast("LinkedIn OAuth connected successfully!")
      queryClient.invalidateQueries({ queryKey: ["linkedin", "status"] })
    } else if (search.linkedin === "error") {
      showErrorToast(
        "Failed to connect LinkedIn. Please check your credentials.",
      )
    }
  }, [search.linkedin, showSuccessToast, showErrorToast, queryClient])

  const {
    data: linkedinStatus,
    refetch: refetchLinkedin,
    isRefetching: isRefetchingLinkedin,
  } = useQuery({
    queryKey: ["linkedin", "status"],
    queryFn: () => LinkedinService.linkedinStatus(),
    staleTime: 10000,
  })

  const {
    data: xStatus,
    refetch: refetchX,
    isRefetching: isRefetchingX,
  } = useQuery({
    queryKey: ["x", "status"],
    queryFn: () => AuthService.xStatus(),
    staleTime: 10000,
  })

  const connectLinkedInMutation = useMutation({
    mutationFn: () => AuthService.linkedinAuthorize(),
    onSuccess: (data) => {
      if (data?.authorize_url) {
        window.location.href = data.authorize_url
      }
    },
    onError: () => {
      showErrorToast("Could not start LinkedIn connection flow.")
    },
  })

  const disconnectLinkedInMutation = useMutation({
    mutationFn: () => LinkedinService.linkedinDisconnect(),
    onSuccess: () => {
      showSuccessToast("LinkedIn disconnected.")
      queryClient.invalidateQueries({ queryKey: ["linkedin", "status"] })
    },
    onError: () => {
      showErrorToast("Failed to disconnect LinkedIn.")
    },
  })

  const connectXMutation = useMutation({
    mutationFn: (force?: boolean) =>
      AuthService.xConnect({ force: force ?? true }),
    onSuccess: () => {
      showSuccessToast(
        "Chrome window launched! Complete login on X.com to save session.",
      )
      setTimeout(() => {
        refetchX()
      }, 5000)
    },
    onError: (err: any) => {
      showErrorToast(
        err?.body?.detail || "Failed to launch headed Chrome window.",
      )
    },
  })

  const verifyXMutation = useMutation({
    mutationFn: () => AuthService.xVerify(),
    onSuccess: (res) => {
      if (res.authenticated) {
        showSuccessToast("X session verified! Home feed successfully detected.")
      } else {
        showErrorToast(res.message || "X session cookies expired or invalid.")
      }
      refetchX()
    },
    onError: (err: any) => {
      showErrorToast(err?.body?.detail || "Error verifying browser session.")
    },
  })

  const isLinkedInConnected = Boolean(linkedinStatus?.connected)
  const needsLinkedInReconnect = Boolean(linkedinStatus?.needs_reconnect)
  const isXCookiePresent = xStatus?.status === "connected"
  const sessionPath = xStatus?.session_dir || "sessions/x"
  const linkedinProfile = linkedinStatus?.profile as
    | {
        display_name?: string
        email?: string
        profile_picture_url?: string
      }
    | undefined

  const copyText = (text: string, key: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
    showSuccessToast(`${label} copied to clipboard!`)
  }

  const handleRefresh = () => {
    refetchLinkedin()
    refetchX()
  }

  return (
    <TooltipProvider>
      <div className="container max-w-3xl mx-auto px-4 py-8 space-y-6">
        <SocialAccountsHeader
          onRefresh={handleRefresh}
          isRefetching={isRefetchingLinkedin || isRefetchingX}
        />

        <div className="w-full rounded-2xl border border-border/80 bg-background overflow-hidden shadow-none divide-y divide-border/40">
          <LinkedInRow
            isConnected={isLinkedInConnected}
            needsReconnect={needsLinkedInReconnect}
            profile={linkedinProfile}
            isConnecting={connectLinkedInMutation.isPending}
            isDisconnecting={disconnectLinkedInMutation.isPending}
            onConnect={() => connectLinkedInMutation.mutate()}
            onDisconnect={() => disconnectLinkedInMutation.mutate()}
          />

          <XRow
            isCookiePresent={isXCookiePresent}
            sessionPath={sessionPath}
            isCliExpanded={isCliExpanded}
            onToggleCli={() => setIsCliExpanded((prev) => !prev)}
            isConnecting={connectXMutation.isPending}
            isVerifying={verifyXMutation.isPending}
            onConnect={() => connectXMutation.mutate(true)}
            onVerify={() => verifyXMutation.mutate()}
            copiedKey={copiedKey}
            onCopy={copyText}
          />
        </div>
      </div>
    </TooltipProvider>
  )
}

export default ConnectedAccountsPage
