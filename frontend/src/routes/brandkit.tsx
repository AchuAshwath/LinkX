import { createFileRoute } from "@tanstack/react-router"

import { Logo } from "@/components/Common/Logo"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"

export const Route = createFileRoute("/brandkit")({
  component: BrandKitPage,
  head: () => ({
    meta: [
      { title: "Brand Kit - LinkX" },
      {
        name: "description",
        content: "LinkX brand guidelines and specifications",
      },
    ],
  }),
})

function BrandKitPage() {
  const { setTheme, resolvedTheme } = useTheme()

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-5xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo variant="full" className="h-8" />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setTheme(resolvedTheme === "dark" ? "light" : "dark")
            }
          >
            {resolvedTheme === "dark" ? "☀ Light" : "☾ Dark"}
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-16 bg-white dark:bg-neutral-900 shadow-2xl my-8 mx-auto max-w-[210mm]">
        <section className="mb-24 pb-16 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex flex-col items-center justify-center py-24">
            <Logo variant="full" className="h-20 mb-8" />
            <h1 className="text-5xl font-bold tracking-tight mb-4 text-neutral-900 dark:text-white">
              Brand Guidelines
            </h1>
            <p className="text-xl text-neutral-500 dark:text-neutral-400 mb-2">
              Version v1.0
            </p>
            <p className="text-sm text-neutral-400">
              © {new Date().getFullYear()} LinkX — The open-source alternative
              to Typefully
            </p>
          </div>
        </section>

        <section className="mb-24">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-8">
            Contents
          </h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-4">
              <span className="text-neutral-400">01</span>
              <span>Brand Overview</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-neutral-400">04</span>
              <span>Typography</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-neutral-400">02</span>
              <span>Logo Usage</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-neutral-400">05</span>
              <span>Design Tokens</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-neutral-400">03</span>
              <span>Colour Palette</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-neutral-400">06</span>
              <span>Usage Guidelines</span>
            </div>
          </div>
        </section>

        <section className="mb-24">
          <div className="flex items-baseline gap-4 mb-12">
            <span className="text-4xl font-bold text-neutral-200 dark:text-neutral-700">
              01
            </span>
            <h2 className="text-3xl font-bold">Brand Overview</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-16">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-6">
                Identity
              </h3>
              <dl className="space-y-6">
                <div>
                  <dt className="text-xs text-neutral-500 mb-1">
                    Project Name
                  </dt>
                  <dd className="text-2xl font-bold">LinkX</dd>
                </div>
                <div>
                  <dt className="text-xs text-neutral-500 mb-1">Tagline</dt>
                  <dd className="text-lg">
                    The open-source alternative to Typefully
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-neutral-500 mb-1">Type</dt>
                  <dd className="text-lg">Self-hosted SaaS template</dd>
                </div>
              </dl>
            </div>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-6">
                Description
              </h3>
              <p className="text-lg leading-relaxed text-neutral-600 dark:text-neutral-300">
                LinkX is an open-source social media scheduling platform
                designed for self-hosting. It provides a modern, minimal
                interface for managing social media content with privacy and
                control at its core.
              </p>
            </div>
          </div>
        </section>

        <section className="mb-24">
          <div className="flex items-baseline gap-4 mb-12">
            <span className="text-4xl font-bold text-neutral-200 dark:text-neutral-700">
              02
            </span>
            <h2 className="text-3xl font-bold">Logo Usage</h2>
          </div>

          <div className="space-y-12">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-8">
                Primary Logo
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-white border border-neutral-200 rounded-lg p-12 flex flex-col items-center">
                  <p className="text-xs text-neutral-400 mb-6">
                    Light Background
                  </p>
                  <Logo
                    variant="full"
                    className="h-12 mb-6"
                    forceTheme="light"
                  />
                  <p className="text-xs text-neutral-500">
                    Primary: #3B82F6
                    <br /> Secondary: #000000
                  </p>
                </div>
                <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-12 flex flex-col items-center">
                  <p className="text-xs text-neutral-400 mb-6">
                    Dark Background
                  </p>
                  <Logo
                    variant="full"
                    className="h-12 mb-6"
                    forceTheme="dark"
                  />
                  <p className="text-xs text-neutral-500">
                    Primary: #3B82F6
                    <br /> Secondary: #FFFFFF
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-8">
                Icon Mark
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-white border border-neutral-200 rounded-lg p-12 flex flex-col items-center">
                  <p className="text-xs text-neutral-400 mb-6">
                    Light Background
                  </p>
                  <Logo
                    variant="icon"
                    className="h-16 mb-6"
                    forceTheme="light"
                  />
                </div>
                <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-12 flex flex-col items-center">
                  <p className="text-xs text-neutral-400 mb-6">
                    Dark Background
                  </p>
                  <Logo
                    variant="icon"
                    className="h-16 mb-6"
                    forceTheme="dark"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-4">
                  Clear Space
                </h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-300 mb-4">
                  Maintain a minimum clear space equal to the height of the "X"
                  on all sides.
                </p>
                <div className="bg-white border border-neutral-200 rounded p-8 flex items-center justify-center">
                  <div className="border border-dashed border-neutral-300 p-4">
                    <Logo variant="full" className="h-8" forceTheme="light" />
                  </div>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-4">
                  Minimum Size
                </h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-300 mb-4">
                  Full Logo: 24px height
                  <br />
                  Icon: 16px height
                </p>
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded bg-neutral-100 border flex items-center justify-center">
                      <Logo variant="icon" className="h-4" forceTheme="light" />
                    </div>
                    <span className="text-xs text-neutral-500">16px</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-neutral-100 border flex items-center justify-center">
                      <Logo variant="icon" className="h-5" forceTheme="light" />
                    </div>
                    <span className="text-xs text-neutral-500">20px</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded bg-neutral-100 border flex items-center justify-center">
                      <Logo variant="icon" className="h-6" forceTheme="light" />
                    </div>
                    <span className="text-xs text-neutral-500">24px</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="border-t-4 border-green-500 pt-6">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-green-600 mb-4">
                  ✓ Do
                </h3>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="text-green-500">•</span>
                    <span>Use as provided, without modification</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-500">•</span>
                    <span>Maintain clear space around the logo</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-500">•</span>
                    <span>Use correct variant for background</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-500">•</span>
                    <span>Scale proportionally</span>
                  </li>
                </ul>
              </div>
              <div className="border-t-4 border-red-500 pt-6">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-red-600 mb-4">
                  ✗ Don't
                </h3>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="text-red-500">•</span>
                    <span>Stretch, distort, or rotate the logo</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-500">•</span>
                    <span>Add shadows, gradients, or effects</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-500">•</span>
                    <span>Change or recolour individual elements</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-500">•</span>
                    <span>Place on busy or low-contrast backgrounds</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="mb-24">
          <div className="flex items-baseline gap-4 mb-12">
            <span className="text-4xl font-bold text-neutral-200 dark:text-neutral-700">
              03
            </span>
            <h2 className="text-3xl font-bold">Colour Palette</h2>
          </div>

          <div className="mb-16">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-8">
              Primary Colours
            </h3>
            <div className="space-y-8">
              <div className="flex items-center gap-8">
                <div className="w-24 h-24 rounded-full bg-[#3B82F6]" />
                <div className="flex-1">
                  <h4 className="font-semibold mb-2">Primary (Light Mode)</h4>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-neutral-500">HEX</p>
                      <p className="font-mono">#3B82F6</p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-500">RGB</p>
                      <p className="font-mono">59, 130, 246</p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-500">CMYK</p>
                      <p className="font-mono">75, 34, 0, 0</p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-500">Usage</p>
                      <p>CTAs, links, brand</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-8">
                <div className="w-24 h-24 rounded-full bg-[#60A5FA]" />
                <div className="flex-1">
                  <h4 className="font-semibold mb-2">Primary (Dark Mode)</h4>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-neutral-500">HEX</p>
                      <p className="font-mono">#60A5FA</p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-500">RGB</p>
                      <p className="font-mono">96, 165, 250</p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-500">CMYK</p>
                      <p className="font-mono">62, 27, 0, 0</p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-500">Usage</p>
                      <p>Dark mode CTAs, links</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-8">
                <div className="w-24 h-24 rounded-full bg-[#EF4444]" />
                <div className="flex-1">
                  <h4 className="font-semibold mb-2">Destructive</h4>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-neutral-500">HEX</p>
                      <p className="font-mono">#EF4444</p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-500">RGB</p>
                      <p className="font-mono">239, 68, 68</p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-500">CMYK</p>
                      <p className="font-mono">0, 75, 73, 0</p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-500">Usage</p>
                      <p>Errors, destructive</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mb-8">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-8">
              Neutral Colours
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <div className="h-20 bg-white border border-neutral-200 rounded-lg mb-3" />
                <p className="font-medium">Background</p>
                <p className="text-sm text-neutral-500">
                  #FFFFFF / CMYK 0,0,0,0
                </p>
              </div>
              <div>
                <div className="h-20 bg-[#0A0A0A] rounded-lg mb-3" />
                <p className="font-medium">Foreground</p>
                <p className="text-sm text-neutral-500">
                  #0A0A0A / CMYK 0,0,0,100
                </p>
              </div>
              <div>
                <div className="h-20 bg-[#F5F5F5] border border-neutral-200 rounded-lg mb-3" />
                <p className="font-medium">Muted</p>
                <p className="text-sm text-neutral-500">
                  #F5F5F5 / CMYK 0,0,0,4
                </p>
              </div>
              <div>
                <div className="h-20 bg-[#E5E5E5] border border-neutral-200 rounded-lg mb-3" />
                <p className="font-medium">Border</p>
                <p className="text-sm text-neutral-500">
                  #E5E5E5 / CMYK 0,0,0,10
                </p>
              </div>
            </div>
          </div>

          <p className="text-xs text-neutral-400 italic mt-8 border-t border-neutral-200 pt-8">
            Note: CMYK values are calculated approximations. For exact colour
            matching in print, obtain Pantone(R) colour books and match to the
            nearest equivalent.
          </p>
        </section>

        <section className="mb-24">
          <div className="flex items-baseline gap-4 mb-12">
            <span className="text-4xl font-bold text-neutral-200 dark:text-neutral-700">
              04
            </span>
            <h2 className="text-3xl font-bold">Typography</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-12">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-4">
                Primary Typeface
              </h3>
              <p className="font-bold text-lg mb-2">Geist Sans</p>
              <p className="text-sm text-neutral-500 mb-4">
                Web / System Sans fallback
              </p>
              <p className="text-sm">Headings, body copy, UI elements</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-4">
                Code Typeface
              </h3>
              <p className="font-bold text-lg mb-2">Geist Mono</p>
              <p className="text-sm text-neutral-500 mb-4">
                Web / System Mono fallback
              </p>
              <p className="text-sm">Code blocks, technical content</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-4">
                Web Safe
              </h3>
              <p className="text-sm text-neutral-500 mb-2">
                ui-sans-serif, system-ui
              </p>
              <p className="text-sm text-neutral-500">
                ui-monospace, monospace
              </p>
            </div>
          </div>

          <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-8">
            Type Scale
          </h3>
          <div className="space-y-4">
            <div className="flex items-baseline gap-4 border-b border-neutral-100 pb-3">
              <span className="w-12 text-xs text-neutral-400">H1</span>
              <span className="text-3xl font-bold">The quick brown fox</span>
              <span className="text-xs text-neutral-400 ml-auto">
                36px / 700
              </span>
            </div>
            <div className="flex items-baseline gap-4 border-b border-neutral-100 pb-3">
              <span className="w-12 text-xs text-neutral-400">H2</span>
              <span className="text-2xl font-bold">The quick brown fox</span>
              <span className="text-xs text-neutral-400 ml-auto">
                30px / 700
              </span>
            </div>
            <div className="flex items-baseline gap-4 border-b border-neutral-100 pb-3">
              <span className="w-12 text-xs text-neutral-400">H3</span>
              <span className="text-xl font-medium">The quick brown fox</span>
              <span className="text-xs text-neutral-400 ml-auto">
                24px / 500
              </span>
            </div>
            <div className="flex items-baseline gap-4 border-b border-neutral-100 pb-3">
              <span className="w-12 text-xs text-neutral-400">Body</span>
              <span className="text-base">
                The quick brown fox jumps over the lazy dog.
              </span>
              <span className="text-xs text-neutral-400 ml-auto">
                16px / 400
              </span>
            </div>
            <div className="flex items-baseline gap-4 border-b border-neutral-100 pb-3">
              <span className="w-12 text-xs text-neutral-400">Small</span>
              <span className="text-sm">
                The quick brown fox jumps over the lazy dog.
              </span>
              <span className="text-xs text-neutral-400 ml-auto">
                14px / 400
              </span>
            </div>
            <div className="flex items-baseline gap-4">
              <span className="w-12 text-xs text-neutral-400">Caption</span>
              <span className="text-xs">
                The quick brown fox jumps over the lazy dog.
              </span>
              <span className="text-xs text-neutral-400 ml-auto">
                12px / 400
              </span>
            </div>
          </div>
        </section>

        <section className="mb-24">
          <div className="flex items-baseline gap-4 mb-12">
            <span className="text-4xl font-bold text-neutral-200 dark:text-neutral-700">
              05
            </span>
            <h2 className="text-3xl font-bold">Design Tokens</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-6">
                Border Radius
              </h3>
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-[#3B82F6] rounded-sm" />
                  <div>
                    <p className="font-mono text-sm">--radius-sm</p>
                    <p className="text-xs text-neutral-500">6px / 0.375rem</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-[#3B82F6] rounded-md" />
                  <div>
                    <p className="font-mono text-sm">--radius-md</p>
                    <p className="text-xs text-neutral-500">8px / 0.5rem</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-[#3B82F6] rounded-lg" />
                  <div>
                    <p className="font-mono text-sm">--radius-lg</p>
                    <p className="text-xs text-neutral-500">10px / 0.625rem</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-[#3B82F6] rounded-xl" />
                  <div>
                    <p className="font-mono text-sm">--radius-xl</p>
                    <p className="text-xs text-neutral-500">14px / 0.875rem</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-8">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-4">
                  Spacing
                </h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-300">
                  Tailwind CSS spacing scale (0.25rem = 4px increments)
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-4">
                  Shadows
                </h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-300">
                  Minimal: shadow-sm, shadow-xs
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-4">
                  Layout
                </h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-300">
                  Sidebar: 256px (16rem) width
                  <br />
                  Max content width: 80rem (1280px)
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mb-24">
          <div className="flex items-baseline gap-4 mb-12">
            <span className="text-4xl font-bold text-neutral-200 dark:text-neutral-700">
              06
            </span>
            <h2 className="text-3xl font-bold">Usage Guidelines</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#3B82F6] text-white text-xs flex items-center justify-center">
                  1
                </span>
                <p className="text-sm">
                  Use primary blue (#3B82F6) for CTAs, links, and brand emphasis
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#3B82F6] text-white text-xs flex items-center justify-center">
                  2
                </span>
                <p className="text-sm">
                  Black/white colours automatically invert with dark/light theme
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#3B82F6] text-white text-xs flex items-center justify-center">
                  3
                </span>
                <p className="text-sm">
                  Reserve destructive red (#EF4444) for errors only
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#3B82F6] text-white text-xs flex items-center justify-center">
                  4
                </span>
                <p className="text-sm">
                  Use system fonts to avoid external dependencies
                </p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#3B82F6] text-white text-xs flex items-center justify-center">
                  5
                </span>
                <p className="text-sm">
                  Maintain consistent border-radius throughout (10px base)
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#3B82F6] text-white text-xs flex items-center justify-center">
                  6
                </span>
                <p className="text-sm">Keep UI minimal - let content shine</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#3B82F6] text-white text-xs flex items-center justify-center">
                  7
                </span>
                <p className="text-sm">
                  Use shadcn/ui "new-york" component style
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#3B82F6] text-white text-xs flex items-center justify-center">
                  8
                </span>
                <p className="text-sm">Icons: Lucide React library</p>
              </div>
            </div>
          </div>
        </section>

        <footer className="pt-12 border-t border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Logo variant="icon" className="h-6" />
              <div>
                <p className="font-medium text-sm">LinkX Brand Guidelines</p>
                <p className="text-xs text-neutral-500">Version v1.0</p>
              </div>
            </div>
            <p className="text-xs text-neutral-400">
              © {new Date().getFullYear()} LinkX
            </p>
          </div>
        </footer>
      </main>
    </div>
  )
}
