# Reusable PRO-style lighting, rendered in code

This is an independent reconstruction calibrated against Apple's original hero still. The earlier AI PNG is not used. Text can be changed to any word supported by the font; the text mask and its lighting are recomputed.

## Use

Keep `pro-glow.js` and `sf-pro-display_medium.ttf` beside each other. Serve them over HTTP(S). No npm package or build step is required.

```html
<script type="module" src="./pro-glow.js"></script>
<pro-glow text="PRO" intensity="1" style="width:min(100%,1100px)"></pro-glow>
```

```js
document.querySelector('pro-glow').text = 'STUDIO';
```

The canvas has a transparent background. Its light was calibrated on black and is most faithful there. `intensity="1"` is the calibrated value; this attribute changes the halo brightness without changing the white letter face. The component includes padding to preserve the diffuse halo. Its `canvas` part can be styled with `pro-glow::part(canvas)`.

The preview's **Sharper text** toggle reduces the letter-face blur from 0.7px to 0.25px, preserving the fitted glow layers. Enable it in an embedding with `<pro-glow text="PRO" sharp></pro-glow>`. Remove the `sharp` attribute to restore the default softness.

The preview overlays the recovered **Ask ChatGPT** composer across the middle of the letters, replacing the reference phone. `chatgpt-pill.js` scales the captured 768 × 52px surface proportionally. Its markup, SVG icons, labels, system font stack, and resolved style values come from the user's Brave tab at https://chatgpt.com/.

The original rendered HTML, per-node style snapshot, and CSSOM stylesheet snapshots are preserved under `recovered-chatgpt/` with SHA-256 provenance. `build-pill.py` mechanically adds scoped node selectors and packages the resolved styles; it does not redraw the pill. The adapter adds positioning, proportional scaling, and native placeholder handling for local editing. This is the captured visual component, without the original React event handlers or connections to model selection, attachment, dictation, and voice services.

```html
<script type="module" src="./chatgpt-pill.js"></script>
<chatgpt-pill style="width:768px"></chatgpt-pill>
```

Keep the `recovered-chatgpt` folder beside the adapter. The component isolates its captured styles in a shadow root.

The current preview enlarges the glowing background text by 25% with a centred scale. The stage clips overflow, while the glow canvas renders at the enlarged display resolution. The pill stays at 80% of the composition width, uses a dark translucent frosted surface with a 14px backdrop blur, and uses `thin` to reduce its native height from 52px to 46px while retaining the icon and text proportions.

The pill is centred on the visible letters as the word changes. `pro-glow.getTextBounds()` returns the measured glyph bounds in viewport CSS pixels, including the display scale and excluding empty spacing. The preview updates the pill position after `glow-render` and stage resizing. Alignment was checked with TRACE and lowercase gyp; centre offsets were below 0.004 CSS pixels with no GL or console errors. `text-centered-pill.png` shows the current browser result.

```html
<chatgpt-pill thin style="width:80%"></chatgpt-pill>
```

`glass-pill-preview.png` captures an earlier frosted appearance. It is not used by the current page.

The separate full-page 3D glass overlay is retired; the frosted treatment is applied only to the pill.

## Rendering

- SF Pro Display Medium (500), measured at a 276px cap height. Tracking is -6px at a 391px font size; the observed RO pair is tightened a further 4px.
- A 0.7px Gaussian-softened, almost-white face with a subtle warm-to-cool vertical shift.
- Seven independently coloured diffusion scales: sigma 1.6, 4, 9, 18, 36, 108, and 160 reference pixels. Positive weights were fitted to visible original pixels. The 64px candidate had zero fitted weight and was omitted.
- WebGL 2 separable Gaussian blur in half-float targets. Large-radius layers are downsampled; compositing preserves low-intensity halos and emits premultiplied transparent output. Shader math uses the fitted sRGB values, not a claim of physical studio-light simulation.
- Backing resolution follows display density up to 2.5×, with a 3200 × 2200 allocation ceiling. Rendering is on demand. There is no continuous animation loop.

## Evidence and limits

Reference: [archived Apple page](https://web.archive.org/web/20241223055153/https://www.apple.com/in/iphone-16-pro/), original `../apple-pro-original/hero_endframe__b3cjfkquc2s2_xlarge.jpg` at 1588 × 1362. Original downloaded files and hashes are preserved in the adjacent extraction directory.

`fit-glow.py` records the calibration method; `calibration.json` records coefficients, geometry, pixel selection, and same-frame fitting error. The phone band is excluded. `calibration-render.png` is a numerical model output used for alignment, not a texture used by the component. Browser rendering uses antialiased Canvas glyphs and GPU diffusion and may differ slightly from the NumPy calibration.

The hidden letter portions, original lighting scene, and video motion are not recoverable from this still. This is not Apple's original lighting code and is not claimed to be pixel-identical. The component reproduces the visible still's lettering and diffusion as a reusable model.

Font source is recorded in `source-fonts.css`: Apple SF Pro Display v3, retrieved from the archived page's stylesheet. Font copyright (C) 2019 Apple Inc. All rights reserved; the font retains its original rights.

## Run the preview

From the `artifacts` directory, run the bundled Python's `-m http.server 8768 --bind 127.0.0.1` and open `/pro-glow-code/`. The preview offers a text field, halo intensity control, and reference comparison.
