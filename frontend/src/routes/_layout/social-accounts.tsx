import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FolderOpen,
  Key,
  Laptop,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Unlink,
} from "lucide-react"
import * as React from "react"
import { FaLinkedinIn, FaXTwitter } from "react-icons/fa6"
import { z } from "zod"

import { AuthService, LinkedinService } from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import useCustomToast from "@/hooks/useCustomToast"

const searchSchema = z.object({
  linkedin: z.string().optional(),
})

export const Route = createFileRoute("/_layout/social-accounts")({
  component: ConnectedAccountsPage,
  validateSearch: (search) => searchSchema.parse(search),
})

function ConnectedAccountsPage() {
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const queryClient = useQueryClient()
  const search = Route.useSearch()
  const [copiedPath, setCopiedPath] = React.useState(false)
  const [verificationResult, setVerificationResult] = React.useState<{
    checked: boolean
    authenticated: boolean
    message: string
  } | null>(null)

  // Handle OAuth redirect notifications
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

  // LinkedIn Status Query
  const {
    data: linkedinStatus,
    isLoading: isLoadingLinkedin,
    refetch: refetchLinkedin,
    isRefetching: isRefetchingLinkedin,
  } = useQuery({
    queryKey: ["linkedin", "status"],
    queryFn: () => LinkedinService.linkedinStatus(),
    staleTime: 10000,
  })

  // X (Twitter) Status Query
  const {
    data: xStatus,
    isLoading: isLoadingX,
    refetch: refetchX,
    isRefetching: isRefetchingX,
  } = useQuery({
    queryKey: ["x", "status"],
    queryFn: () => AuthService.xStatus(),
    staleTime: 10000,
  })

  // LinkedIn Connect (Authorize)
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

  // LinkedIn Disconnect
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

  // X Connect (Launch Headed Browser)
  const connectXMutation = useMutation({
    mutationFn: (force?: boolean) =>
      AuthService.xConnect({ force: force ?? false }),
    onSuccess: () => {
      showSuccessToast(
        "Chrome window launched! Please complete login on X.com.",
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

  // X Live Verification Mutation
  const verifyXMutation = useMutation({
    mutationFn: () => AuthService.xVerify(),
    onSuccess: (res) => {
      setVerificationResult({
        checked: true,
        authenticated: res.authenticated,
        message: res.message,
      })
      if (res.authenticated) {
        showSuccessToast("X session verified! Home feed successfully detected.")
      } else {
        showErrorToast(res.message || "X session could not be authenticated.")
      }
      refetchX()
    },
    onError: (err: any) => {
      showErrorToast(err?.body?.detail || "Error running browser verification.")
    },
  })

  const isLinkedInConnected = Boolean(linkedinStatus?.connected)
  const isXCookiePresent = xStatus?.status === "connected"
  const linkedinProfile = linkedinStatus?.profile as
    | {
        display_name?: string
        email?: string
        profile_picture_url?: string
      }
    | undefined

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedPath(true)
    setTimeout(() => setCopiedPath(false), 2000)
    showSuccessToast("Path copied to clipboard!")
  }

  return (
    <div className="flex flex-col gap-8 p-6 md:p-10 max-w-6xl mx-auto">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary uppercase tracking-wider">
              Integration Matrix
            </span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Social Accounts & Automation
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-relaxed">
            LinkX demonstrates multiple social automation paradigms. Connect via
            standard OAuth 2.0 API or stealth anti-detection browser session
            automation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchLinkedin()
              refetchX()
            }}
            disabled={isRefetchingLinkedin || isRefetchingX}
            className="gap-2"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefetchingLinkedin || isRefetchingX ? "animate-spin" : ""}`}
            />
            Refresh All
          </Button>
        </div>
      </div>

      {/* Main 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* ======================= 1. LINKEDIN: OFFICIAL API APPROACH ======================= */}
        <Card className="flex flex-col border-border/70 shadow-sm relative overflow-hidden bg-card hover:border-border transition-colors">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#0077b5]" />
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#0077b5]/10 text-[#0077b5] ring-1 ring-[#0077b5]/20">
                  <FaLinkedinIn className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-xl font-bold">
                      LinkedIn
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className="text-[10px] uppercase font-mono px-2 py-0"
                    >
                      REST API
                    </Badge>
                  </div>
                  <CardDescription className="text-xs mt-0.5">
                    Official OAuth 2.0 & REST API Protocol
                  </CardDescription>
                </div>
              </div>

              {isLoadingLinkedin ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : isLinkedInConnected ? (
                <Badge
                  variant="outline"
                  className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 gap-1.5 py-1 px-3"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />{" "}
                  Connected
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-muted-foreground">
                  Not Connected
                </Badge>
              )}
            </div>
          </CardHeader>

          <CardContent className="flex-1 space-y-5">
            {/* Info / Explanation Callout */}
            <div className="p-3.5 rounded-lg bg-muted/30 border border-border/40 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-foreground/90">
                <Key className="h-3.5 w-3.5 text-primary" />
                <span>How this works:</span>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Connects through the official LinkedIn Developer OAuth 2.0
                authorization code flow. Tokens and permissions (
                <code className="font-mono text-primary/90">
                  openid, profile, w_member_social
                </code>
                ) are securely stored in Redis and used to publish text and
                image posts via standard REST endpoints.
              </p>
            </div>

            {/* Connection State Details */}
            {isLinkedInConnected && linkedinProfile ? (
              <div className="p-4 rounded-xl bg-muted/40 border border-border/60 flex items-center gap-4">
                {linkedinProfile.profile_picture_url ? (
                  <img
                    src={linkedinProfile.profile_picture_url}
                    alt="LinkedIn Profile"
                    className="h-12 w-12 rounded-full object-cover ring-2 ring-[#0077b5]/30"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-full bg-[#0077b5]/15 text-[#0077b5] flex items-center justify-center font-bold text-lg ring-2 ring-[#0077b5]/30">
                    {linkedinProfile.display_name?.[0] || "L"}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate text-foreground">
                    {linkedinProfile.display_name || "LinkedIn Member"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {linkedinProfile.email || "OAuth Token Active"}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                      <ShieldCheck className="h-3 w-3" /> Token Valid
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                <p>
                  Connect your LinkedIn account to enable publishing and state
                  management through LinkedIn's official platform API.
                </p>
              </div>
            )}
          </CardContent>

          <CardFooter className="pt-3 border-t bg-muted/10 flex items-center justify-between">
            {isLinkedInConnected ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchLinkedin()}
                  disabled={isLoadingLinkedin || isRefetchingLinkedin}
                  className="gap-1.5"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${isRefetchingLinkedin ? "animate-spin" : ""}`}
                  />
                  Check Status
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => disconnectLinkedInMutation.mutate()}
                  disabled={disconnectLinkedInMutation.isPending}
                  className="gap-1.5"
                >
                  {disconnectLinkedInMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Unlink className="h-3.5 w-3.5" />
                  )}
                  Disconnect
                </Button>
              </>
            ) : (
              <Button
                onClick={() => connectLinkedInMutation.mutate()}
                disabled={connectLinkedInMutation.isPending}
                size="sm"
                className="w-full bg-[#0077b5] hover:bg-[#0077b5]/90 text-white gap-2 font-medium"
              >
                {connectLinkedInMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
                Connect LinkedIn with OAuth
              </Button>
            )}
          </CardFooter>
        </Card>

        {/* ======================= 2. X (TWITTER): STEALTH BROWSER AUTOMATION ======================= */}
        <Card className="flex flex-col border-border/70 shadow-sm relative overflow-hidden bg-card hover:border-border transition-colors">
          <div className="absolute top-0 left-0 right-0 h-1 bg-foreground" />
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-foreground/10 text-foreground ring-1 ring-foreground/20">
                  <FaXTwitter className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-xl font-bold">
                      X (Twitter)
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className="text-[10px] uppercase font-mono px-2 py-0 bg-primary/5 text-primary border-primary/20"
                    >
                      Stealth Browser
                    </Badge>
                  </div>
                  <CardDescription className="text-xs mt-0.5">
                    No Enterprise API Key • Local Headed Session Evasion
                  </CardDescription>
                </div>
              </div>

              {isLoadingX ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : isXCookiePresent ? (
                <Badge
                  variant="outline"
                  className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 gap-1.5 py-1 px-3"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{" "}
                  Session Saved
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-muted-foreground">
                  No Session
                </Badge>
              )}
            </div>
          </CardHeader>

          <CardContent className="flex-1 space-y-5">
            {/* Honest Technical Explanation */}
            <div className="p-3.5 rounded-lg bg-muted/30 border border-border/40 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-foreground/90">
                <Bot className="h-3.5 w-3.5 text-primary" />
                <span>How this works (Honest Architecture):</span>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Because X.com charges $100+/month for basic write APIs, LinkX
                connects via <strong>Headed Chrome Automation</strong>. Clicking
                connect launches a real Google Chrome instance on your computer
                with a dedicated profile. Log in once, solve any CAPTCHA/2FA,
                and your session cookies are persisted locally to automate posts
                and scraping with <strong>rebrowser-playwright</strong>.
              </p>
            </div>

            {/* Session Path Display */}
            {xStatus?.session_dir && (
              <div className="p-3 rounded-lg bg-muted/40 border border-border/50 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                    <FolderOpen className="h-3 w-3" /> Persistent Session Path:
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-muted-foreground hover:text-foreground"
                    onClick={() => copyToClipboard(xStatus.session_dir)}
                    title="Copy Path"
                  >
                    {copiedPath ? (
                      <Check className="h-3 w-3 text-emerald-500" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                </div>
                <code className="text-[11px] block font-mono bg-background/80 p-2 rounded border border-border/40 text-muted-foreground truncate select-all">
                  {xStatus.session_dir}
                </code>
              </div>
            )}

            {/* Live Verification Feedback */}
            {verificationResult && (
              <Alert
                variant={
                  verificationResult.authenticated ? "default" : "destructive"
                }
                className="py-2.5"
              >
                {verificationResult.authenticated ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <AlertCircle className="h-4 w-4" />
                )}
                <AlertTitle className="text-xs font-semibold">
                  {verificationResult.authenticated
                    ? "Session Authenticated"
                    : "Verification Failed"}
                </AlertTitle>
                <AlertDescription className="text-xs mt-0.5">
                  {verificationResult.message}
                </AlertDescription>
              </Alert>
            )}

            {/* Instructions list */}
            <div className="text-xs space-y-2 text-muted-foreground">
              <p className="font-semibold text-foreground/80">
                Connecting Workflow:
              </p>
              <ol className="list-decimal list-inside space-y-1 pl-1">
                <li>
                  Click <strong>Launch Chrome Login</strong> below.
                </li>
                <li>
                  Log in to your X.com account and complete 2FA in the opened
                  Chrome window.
                </li>
                <li>
                  Wait 5-10s until your home feed is visible, then close Chrome
                  (Cmd+Q / Alt+F4).
                </li>
                <li>
                  Click <strong>Run Live Verification</strong> to test the
                  connection.
                </li>
              </ol>
            </div>
          </CardContent>

          <CardFooter className="pt-3 border-t bg-muted/10 flex flex-wrap gap-2 items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                onClick={() => connectXMutation.mutate(false)}
                disabled={connectXMutation.isPending}
                size="sm"
                className="gap-2 font-medium"
              >
                {connectXMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Laptop className="h-4 w-4" />
                )}
                Launch Chrome Login
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => verifyXMutation.mutate()}
                disabled={verifyXMutation.isPending || !isXCookiePresent}
                className="gap-1.5"
                title="Runs live headless verification check against x.com"
              >
                {verifyXMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                )}
                Run Live Verification
              </Button>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetchX()}
              disabled={isLoadingX || isRefetchingX}
              className="gap-1.5 text-xs text-muted-foreground"
            >
              <RefreshCw
                className={`h-3 w-3 ${isRefetchingX ? "animate-spin" : ""}`}
              />
              Quick Check
            </Button>
          </CardFooter>
        </Card>
      </div>

      {/* CLI Power-User Card */}
      <Card className="border-border/50 bg-muted/20">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2.5">
            <Terminal className="h-4 w-4 text-primary" />
            <CardTitle className="text-base font-semibold">
              CLI Alternative Commands
            </CardTitle>
          </div>
          <CardDescription className="text-xs">
            Prefer running scripts directly from your terminal? Use these
            commands:
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
            <div className="p-2.5 rounded bg-background border space-y-1">
              <span className="text-[11px] text-muted-foreground block font-sans font-semibold">
                1. Headed Login via CLI:
              </span>
              <code className="text-primary block truncate">
                uv run python scripts/headed_login.py --platform x
              </code>
            </div>
            <div className="p-2.5 rounded bg-background border space-y-1">
              <span className="text-[11px] text-muted-foreground block font-sans font-semibold">
                2. Test Session via CLI:
              </span>
              <code className="text-primary block truncate">
                uv run python scripts/test_session.py --platform x
              </code>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
