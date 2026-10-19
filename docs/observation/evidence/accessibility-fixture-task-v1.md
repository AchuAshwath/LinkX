# Accessibility fixture v1: task script and fixture-only ground truth

## Scope

This fictional synthetic exercise checks whether a raster image contains short instructions that a reader can inspect visually and then explain after using a local image-reading method. It is a developer task artifact, not a participant study and not evidence about a disability group or any platform's accessibility.

The source page is `frontend/accessibility-v1-demo.html`; the bitmap is `frontend/accessibility-v1-fixture.png`. The HTML's `img` alt text describes the image type and layout, not its printed words. The literal text below is intentionally kept outside the page and the observer-facing fixture. It is the answer key for the task facilitator only.

## Ground truth (fixture-only; do not serve to the demo page)

Printed text, including capitalization and punctuation:

> FIELD NOTE • NIGHT GARDEN
>
> KEEP THE GLASSHOUSES COOL
>
> At noon, close the east shade.
>
> Water the moon basil after sunset.
>
> Leave one lantern on for the night gardeners.
>
> GARDEN SHIFT • 04

Expected content answer: close the east shade at noon; water the moon basil after sunset; leave one lantern on for the night gardeners.

## Task script

1. Open `http://localhost:5173/accessibility-v1-demo.html` in the supported local Chrome demo. Do not inspect this ground-truth file during the task.
2. At 100% browser zoom, use only the keyboard to reach the notice and first answer field. Read the notice and enter a concise answer to all three questions.
3. Repeat visual inspection at 200% and 400% browser zoom. Record whether the image can be enlarged, whether horizontal/vertical panning is needed, and whether the task controls remain reachable by keyboard.
4. In the second-pass section, use a local image reading method (for example, macOS VoiceOver image description or on-device OCR). Do not use a hosted model or network service. Record its name/version and answer the same questions; note any correction or clarification.
5. Compare answers with the fixture-only ground truth after the task. Do not infer general performance from this one synthetic image.

## Developer checks

- Verify the notice is an actual PNG bitmap; its literal passage does not occur in the demo HTML source or accessible name.
- Verify keyboard order reaches the first answer field, local-method field, and assisted answer field, and that each has a visible focus indicator.
- At actual browser zoom settings 100%, 200%, and 400%, verify the image can be enlarged/panned and the form remains keyboard reachable. This is a manual browser UI check; changing CSS zoom is not an equivalent check.
- Inspect Chrome's accessibility tree: image role/name should expose only the concise image description, and form fields should expose their labels.
- If VoiceOver is available, inspect rotor/headings and navigate to the image and form fields. Record actual results separately from tree inspection. A browser accessibility tree is not a screen-reader test.

## Limitations

Only one fictional static image and one developer-run task are included. The image's clarity is not calibrated across displays or visual conditions; no participant testing, disability validation, comparative OCR benchmark, or claim about inaccessible platforms is made. The bitmap is generated from local system font rendering, so pixels can vary if regenerated on another OS/font stack.

## Developer run and observed check record

Run `cd frontend && bun run dev`, then open the local URL printed by Vite with `/accessibility-v1-demo.html` appended. In this worktree Vite reported `http://127.0.0.1:4001/` because port 4000 was already occupied. The fixture is served as `/accessibility-v1-fixture.png`.

On 2026-10-18, the local Chrome build was manually checked through the browser accessibility tree and browser UI:

- The PNG loaded at 1600 × 1100. A source/DOM scan found no match for `close the east shade`, `moon basil`, or `night gardeners`; the accessibility tree exposes one image named “A printed garden notice on cream paper, with a large heading and three instruction lines.”
- The first Tab from the document reached “Your first-pass answer”; subsequent Tabs reached “Local method and version” and “Your assisted-reading answer.” At 400% the focus ring remained visible and Tab still reached these fields.
- Chrome's own zoom indicator was observed at 100%, 200%, and 400%. At 200% the image enlarged and required scrolling to inspect lower lines. At 400% the surrounding page text and image enlarged substantially; keyboard focus and page scrolling remained available. This is one desktop Chrome run and does not establish cross-browser or small-screen reflow behavior.
- The browser accessibility tree reported a named image and text-entry controls with their visible labels. VoiceOver speech/rotor was not run; the tree inspection is not a screen-reader test.
- The assisted-reading task is procedural only. No OCR, transcription, model, or network service is included in this page.

The tested checkout used macOS and Chrome. The PNG was rendered with the macOS system font stack; regeneration on another OS can change font rasterization. No participant was involved.
