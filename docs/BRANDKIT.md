# LinkX Brand Kit

**Project**: LinkX
**Type**: Open-source self-hosted SaaS template
**Tagline**: The open-source alternative to Typefully

---

## 1. Color Palette

### Primary Colors

| Name | CSS Variable | OKLCH Value | Hex | Usage |
|------|--------------|-------------|-----|-------|
| Primary (Light) | `--primary` | `oklch(0.6818 0.1584 243.35)` | #3B82F6 | Buttons, links, brand accents |
| Primary (Dark) | `--primary` | `oklch(0.72 0.1584 243.35)` | #60A5FA | Dark mode primary |
| Destructive | `--destructive` | `oklch(0.577 0.245 27.325)` | #EF4444 | Errors, destructive actions |

### Neutral Colors

| Name | Light Mode | Dark Mode | Usage |
|------|------------|-----------|-------|
| Background | `oklch(1 0 0)` #FFFFFF | `oklch(0.145 0 0)` #0A0A0A | Page background |
| Foreground | `oklch(0.145 0 0)` #0A0A0A | `oklch(0.985 0 0)` #FAFAFA | Primary text |
| Muted | `oklch(0.97 0 0)` #F5F5F5 | `oklch(0.269 0 0)` #262626 | Secondary backgrounds |
| Border | `oklch(0.922 0 0)` #E5E5E5 | `oklch(1 0 0 / 10%)` | Borders, dividers |

### Usage Guidelines

- **Primary Blue**: Use for interactive elements, CTAs, links, and brand emphasis
- **Black/White**: Use for text, backgrounds - automatically inverts with theme
- **Destructive Red**: Reserve for errors, delete actions, and warnings only

---

## 2. Typography

### Font Stack

```css
/* Primary Font - System with Geist fallback */
--font-sans: ui-sans-serif, system-ui, sans-serif;

/* Monospace - For code blocks */
--font-mono: ui-monospace, "Cascadia Code", "Source Code Pro", monospace;
```

> **Note**: Using system fonts ensures no external dependencies. Geist can be added later via `@fontsource/geist-sans` npm package if desired.

### Type Scale

| Element | Size | Weight | Line Height |
|---------|------|--------|-------------|
| H1 | 2.25rem (36px) | 600 (Semibold) | 1.2 |
| H2 | 1.875rem (30px) | 600 (Semibold) | 1.25 |
| H3 | 1.5rem (24px) | 500 (Medium) | 1.3 |
| H4 | 1.25rem (20px) | 500 (Medium) | 1.4 |
| Body | 1rem (16px) | 400 (Regular) | 1.5 |
| Small | 0.875rem (14px) | 400 (Regular) | 1.5 |
| Caption | 0.75rem (12px) | 400 (Regular) | 1.4 |

### Text Colors

| Context | Light Mode | Dark Mode |
|---------|------------|-----------|
| Primary text | `--foreground` | `--foreground` |
| Secondary text | `--muted-foreground` | `--muted-foreground` |
| Links | `--primary` | `--primary` |
| Disabled | `--muted-foreground` at 50% | `--muted-foreground` at 50% |

---

## 3. Logo

### Logo Concept

**Style**: Text-based wordmark
**Design**: "Link" in italic primary blue + "X" in black (light mode) or white (dark mode)

### Logo Variants Required

| Variant | Description | Min Height | Formats |
|---------|-------------|------------|---------|
| Full Logo (Light BG) | Blue italic "Link" + Black "X" | 24px | SVG, PNG |
| Full Logo (Dark BG) | Blue italic "Link" + White "X" | 24px | SVG, PNG |
| Icon (Light BG) | Stylized "X" or "LX" in black | 16px | SVG, PNG |
| Icon (Dark BG) | Stylized "X" or "LX" in white | 16px | SVG, PNG |

### Logo Specifications

```
Full Logo:
- Aspect ratio: ~4:1 (horizontal)
- "Link" font: Sans-serif, italic, primary blue (#3B82F6)
- "X" font: Sans-serif, bold, theme-aware (black/white)
- Kerning: Tight between "Link" and "X"

Icon:
- Aspect ratio: 1:1 (square)
- Design: Stylized "X" or combined "LX" lettermark
- Padding: 10% of canvas on all sides
```

### Logo Safe Space

- Minimum clear space around logo: Equal to height of "X" character
- Minimum display size: 24px height (full), 16px (icon)

### Logo Don'ts

- Don't stretch or distort proportions
- Don't change the colors outside of theme variants
- Don't add effects (shadows, gradients, outlines)
- Don't place on busy backgrounds without sufficient contrast

---

## 4. Required Assets

### Favicons & Browser Icons

| Asset | Size | Format | Status |
|-------|------|--------|--------|
| favicon.ico | 16x16, 32x32 multi | ICO | Pending |
| favicon-16x16.png | 16x16 | PNG | Pending |
| favicon-32x32.png | 32x32 | PNG | Pending |
| apple-touch-icon.png | 180x180 | PNG | Pending |
| android-chrome-192x192.png | 192x192 | PNG | Pending |
| android-chrome-512x512.png | 512x512 | PNG | Pending |

**Destination**: `frontend/public/assets/images/`

### Social & Open Graph

| Asset | Size | Format | Usage |
|-------|------|--------|-------|
| og-image.png | 1200x630 | PNG | Link previews (Facebook, LinkedIn, etc.) |
| twitter-card.png | 1200x600 | PNG | Twitter/X card previews |

**Template content**:
- LinkX logo centered
- Tagline below logo
- Background: Gradient or solid using brand colors
- Include URL: `linkx.dev` (or actual domain)

### GitHub & Documentation

| Asset | Size | Format | Usage |
|-------|------|--------|-------|
| github-social-preview.png | 1280x640 | PNG | Repository social card |
| logo-readme.svg | ~400px wide | SVG | README header |

### Docker

| Asset | Size | Format | Usage |
|-------|------|--------|-------|
| docker-icon.png | 256x256 | PNG | Docker Hub profile image |

---

## 5. File Structure

Once assets are created, organize as follows:

```
frontend/public/
├── assets/
│   └── images/
│       ├── linkx-logo.svg           # Full logo (light bg)
│       ├── linkx-logo-light.svg     # Full logo (dark bg)
│       ├── linkx-icon.svg           # Icon (light bg)
│       ├── linkx-icon-light.svg     # Icon (dark bg)
│       ├── favicon.ico
│       ├── favicon-16x16.png
│       ├── favicon-32x32.png
│       ├── apple-touch-icon.png
│       ├── android-chrome-192x192.png
│       ├── android-chrome-512x512.png
│       ├── og-image.png
│       └── twitter-card.png
```

---

## 6. Implementation Checklist

### Completed
- [x] Color palette defined (in `frontend/src/index.css`)
- [x] Dark/light theme support
- [x] Typography using system fonts

### Pending - Code Updates
- [ ] Update `frontend/index.html` title from "Full Stack FastAPI Project" to "LinkX"
- [ ] Update Logo component to use LinkX assets
- [ ] Add Open Graph meta tags to `index.html`
- [ ] Add Twitter Card meta tags
- [ ] Update any "FastAPI" text references to "LinkX"

### Pending - Assets
- [ ] Create LinkX logo (full + icon variants)
- [ ] Generate favicon set from icon
- [ ] Create Open Graph image (1200x630)
- [ ] Create Twitter Card image (1200x600)
- [ ] Create GitHub social preview (1280x640)

---

## 7. Meta Tags Template

Add to `frontend/index.html` once assets are ready:

```html
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  
  <!-- Primary Meta Tags -->
  <title>LinkX</title>
  <meta name="title" content="LinkX - Open Source Typefully Alternative" />
  <meta name="description" content="Self-hosted social media scheduling and publishing platform. The open-source alternative to Typefully." />
  
  <!-- Favicons -->
  <link rel="icon" type="image/x-icon" href="/assets/images/favicon.ico" />
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/images/favicon-32x32.png" />
  <link rel="icon" type="image/png" sizes="16x16" href="/assets/images/favicon-16x16.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="/assets/images/apple-touch-icon.png" />
  
  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://linkx.dev/" />
  <meta property="og:title" content="LinkX - Open Source Typefully Alternative" />
  <meta property="og:description" content="Self-hosted social media scheduling and publishing platform." />
  <meta property="og:image" content="https://linkx.dev/assets/images/og-image.png" />
  
  <!-- Twitter -->
  <meta property="twitter:card" content="summary_large_image" />
  <meta property="twitter:url" content="https://linkx.dev/" />
  <meta property="twitter:title" content="LinkX - Open Source Typefully Alternative" />
  <meta property="twitter:description" content="Self-hosted social media scheduling and publishing platform." />
  <meta property="twitter:image" content="https://linkx.dev/assets/images/twitter-card.png" />
</head>
```

---

## 8. Component Styling Reference

### Buttons
```css
/* Primary button */
background: var(--primary);
color: var(--primary-foreground);
border-radius: var(--radius-md); /* 8px */

/* Secondary button */
background: var(--secondary);
color: var(--secondary-foreground);
```

### Cards
```css
background: var(--card);
color: var(--card-foreground);
border: 1px solid var(--border);
border-radius: var(--radius-xl); /* 14px */
box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
```

### Inputs
```css
background: var(--background);
border: 1px solid var(--input);
border-radius: var(--radius-md); /* 8px */
height: 36px;
```

---

## 9. Design Tokens Summary

| Token | Value |
|-------|-------|
| `--radius` | 0.625rem (10px) |
| `--radius-sm` | 0.375rem (6px) |
| `--radius-md` | 0.5rem (8px) |
| `--radius-lg` | 0.625rem (10px) |
| `--radius-xl` | 0.875rem (14px) |
| `--sidebar-width` | 16rem (256px) |
| `--sidebar-width-icon` | 3rem (48px) |

---

## Notes

- All colors use OKLCH color space for perceptually uniform adjustments
- Theme switching handled via `.dark` class on `<html>` element
- shadcn/ui components follow "new-york" style variant
- Icon library: Lucide React
