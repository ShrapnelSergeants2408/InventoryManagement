# Mockup source files (reference only)

These are the Stage 3 design-canvas artboards (`.dc.html`). They need the design canvas's runtime to render, so they **won't open directly in a browser**. Use the PNGs in `../screenshots/` to see each screen.

They're included because the markup and `<style>` blocks are the exact reference for:
- colors, font sizes, spacing and touch-target sizes (see the CSS at the top of any screen file, e.g. `Main.dc.html`);
- how each screen's states behave (the `renderVals()` logic shows the order math, status rules, PIN flow, count-in flow, etc.).

Treat the logic as a sketch, not production code. The real app follows SPEC.md (v0.5) and is built in TypeScript with the stack in SPEC §2.

Files ending in `-P.dc.html` or a variant name (e.g. `Order-Stale.dc.html`) are thin wrappers that show the main screen file in portrait or in a particular state.
