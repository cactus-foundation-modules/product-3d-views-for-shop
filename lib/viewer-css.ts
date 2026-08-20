// The 3D viewer + thumbnail chrome, as one token-only stylesheet shared by every
// surface that mounts a viewer: the product-detail gallery (Gallery3d) and the
// product-card 3D overlay (CardModel3dOverlay). Kept in one place so a stage that
// takes over a card looks exactly like the one on the detail page, and a token
// tweak lands everywhere at once. Colours are tokens throughout - the pill and the
// controls have to stay legible against whatever a site's theme puts behind them,
// in both light and dark.
export const viewerChromeCss = `
.p3d-thumb{position:relative}
.p3d-thumb-canvas{width:100%;height:100%;display:block;background:var(--color-bg-subtle)}
.p3d-pill{position:absolute;right:3px;bottom:3px;z-index:1;pointer-events:none;
  font-size:9px;font-weight:700;letter-spacing:.03em;line-height:1;padding:2px 4px;border-radius:4px;
  background:var(--color-fg);color:var(--color-bg);opacity:.9}
.p3d-stage{width:100%;height:100%;position:relative;background:var(--color-bg-subtle)}
.p3d-stage-canvas{width:100%;height:100%;display:block;touch-action:none;cursor:grab}
.p3d-stage-canvas:active{cursor:grabbing}
/* The canvas takes keyboard focus (arrow keys turn the model), so it has to show it.
   Inset, because the canvas fills the stage exactly and an outward ring would be
   clipped by whatever the theme wraps the gallery in. */
.p3d-stage-canvas:focus-visible{outline:2px solid var(--color-border-focus);outline-offset:-2px}
/* Which hint shows is :focus-visible's to decide, not JavaScript's: it is the only
   thing that knows whether the focus arrived by keyboard or by a mouse click, and
   telling someone mid-drag to try the arrow keys would be worse than saying nothing.
   Sibling selectors, so the hints have to stay after the canvas in the markup. */
.p3d-hint-keys{display:none}
.p3d-stage-canvas:focus-visible ~ .p3d-hint-keys{display:block}
.p3d-stage-canvas:focus-visible ~ .p3d-hint-drag{display:none}
.p3d-note{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  text-align:center;padding:1rem;font-size:.8125rem;color:var(--color-text-muted)}
.p3d-hint{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);z-index:1;pointer-events:none;
  font-size:11px;line-height:1;padding:5px 9px;border-radius:999px;
  background:var(--color-fg);color:var(--color-bg);opacity:.75;white-space:nowrap}
.p3d-reset{position:absolute;right:8px;bottom:8px;z-index:2;cursor:pointer;border:none;
  font-family:inherit;font-size:11px;line-height:1;padding:5px 9px;border-radius:999px;
  background:var(--color-fg);color:var(--color-bg);opacity:.6;white-space:nowrap;
  transition:opacity .15s ease}
.p3d-reset:hover,.p3d-reset:focus-visible{opacity:.9}
/* "Click to interact": the stage saying it has not taken the mouse wheel, and how
   to give it. Bottom-left, and only ever on screen before the first press, so it
   never shares the stage with the Reset view button. pointer-events none - the
   press it is asking for must land on the stage underneath, not on the label. */
.p3d-interact{position:absolute;left:8px;bottom:8px;z-index:2;pointer-events:none;
  font-size:11px;font-weight:600;line-height:1;padding:5px 9px;border-radius:999px;
  background:var(--color-fg);color:var(--color-bg);opacity:.8;white-space:nowrap}
/* While that pill holds the bottom-left corner, "View in your room" steps up out of
   its way rather than the two stacking on top of each other. */
.p3d-stage.gated .p3d-ar{bottom:38px}
/* "View in your room". Bottom-left, opposite the Reset button, above the centred
   hint. One rule covers both shapes it takes (a <button> for WebXR, an <a rel="ar">
   for Quick Look) - both carry the p3d-ar class. Solid fill on the theme's own
   tokens so it reads on any stage background, and it is a real target, so unlike
   the hint it takes pointer and keyboard events. */
.p3d-ar{position:absolute;left:8px;bottom:8px;z-index:2;cursor:pointer;border:none;
  display:inline-flex;align-items:center;gap:6px;font-family:inherit;font-size:11px;
  font-weight:600;line-height:1;padding:6px 10px;border-radius:999px;text-decoration:none;
  background:var(--color-fg);color:var(--color-bg);opacity:.85;white-space:nowrap;
  transition:opacity .15s ease}
.p3d-ar:hover,.p3d-ar:focus-visible{opacity:1}
.p3d-ar:disabled{opacity:.5;cursor:default}
.p3d-ar-icon{flex:none}
/* Apple requires an <img> child inside the rel="ar" anchor, but ours is only there
   to satisfy that - the visible glyph is the SVG. Kept in the layout at zero size
   rather than display:none, which some WebKit builds have treated as "no img". */
.p3d-ar-img{width:0;height:0}
/* The WebXR dom-overlay: our close button and hint drawn over the live camera feed
   while an immersive session runs. Appended to <body>, so it is fixed to the
   viewport rather than the stage, and it inherits the theme tokens from :root like
   any other element. pointer-events none on the root lets taps through to the AR
   scene (placing the model); the close button turns them back on for itself. */
.p3d-ar-overlay{position:fixed;inset:0;z-index:9999;pointer-events:none}
.p3d-ar-close{position:absolute;top:16px;right:16px;pointer-events:auto;cursor:pointer;
  width:40px;height:40px;border:none;border-radius:50%;font-size:18px;line-height:1;
  background:var(--color-fg);color:var(--color-bg);opacity:.9}
.p3d-ar-hint{position:absolute;left:50%;bottom:32px;transform:translateX(-50%);margin:0;
  pointer-events:none;font-size:13px;line-height:1;padding:8px 14px;border-radius:999px;
  background:var(--color-fg);color:var(--color-bg);opacity:.85;white-space:nowrap}
/* The material-loading skeleton (see Viewer3d): a slow sheen across the stage plus a
   spinner pill, layered over the still-visible model. Held invisible for the first
   .15s so a colour that lands from cache never flashes it - the animation IS the
   delay, so no JavaScript timer to clean up. pointer-events none throughout: a
   shopper can keep turning the model while its fabric catches up. */
.p3d-material-wait{position:absolute;inset:0;z-index:1;pointer-events:none;overflow:hidden;
  opacity:0;animation:p3d-wait-in .2s ease .15s forwards}
.p3d-material-wait::before{content:'';position:absolute;inset:0;
  background:linear-gradient(105deg,transparent 35%,var(--color-bg) 50%,transparent 65%);
  background-size:250% 100%;opacity:.35;animation:p3d-shimmer 1.4s linear infinite}
.p3d-material-pill{position:absolute;left:50%;top:12px;transform:translateX(-50%);
  display:inline-flex;align-items:center;gap:6px;font-size:11px;line-height:1;
  padding:5px 9px;border-radius:999px;background:var(--color-fg);color:var(--color-bg);
  opacity:.85;white-space:nowrap}
.p3d-material-spinner{width:10px;height:10px;flex:none;border-radius:50%;
  border:2px solid var(--color-bg);border-top-color:transparent;
  animation:p3d-spin .7s linear infinite}
@keyframes p3d-wait-in{to{opacity:1}}
@keyframes p3d-shimmer{from{background-position:200% 0}to{background-position:-50% 0}}
@keyframes p3d-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){
  /* No sheen and no spin. The fade-in stays: an opacity change is not the kind of
     motion the preference asks off, and its .15s delay is what stops a cached
     colour flashing the overlay. */
  .p3d-material-wait::before{animation:none}
  .p3d-material-spinner{animation:none;border-top-color:var(--color-bg);opacity:.5}
}
@media (prefers-reduced-motion:reduce){.p3d-reset,.p3d-ar{transition:none}}
@media (prefers-reduced-motion:reduce){.p3d-stage-canvas{cursor:default}}
`

// The product-card overlay's own chrome: the closed "3D" badge, the stage that
// replaces the picture when it is tapped, and that stage's close/step controls.
// Separate from viewerChromeCss because a product-detail gallery mounts a viewer
// without ever mounting a card, so the two are hoisted as two stylesheets and a
// page only carries the ones it uses. No selector is shared between them.
export const cardChromeCss = `
.p3d-card-btn{position:absolute;right:8px;bottom:8px;z-index:2;display:inline-flex;align-items:center;gap:5px;
  padding:5px 9px;border-radius:999px;border:1px solid var(--color-border);background:var(--color-surface);
  color:var(--color-fg);font-family:inherit;font-size:11px;font-weight:700;line-height:1;letter-spacing:.02em;
  cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.18);transition:background .15s ease}
.p3d-card-btn:hover,.p3d-card-btn:focus-visible{background:var(--color-bg-subtle)}
.p3d-card-btn:focus-visible{outline:2px solid var(--color-primary);outline-offset:2px}
.p3d-card-btn svg{flex:none}
.p3d-card-stage{position:absolute;inset:0;z-index:3;background:var(--color-surface)}
.p3d-card-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.p3d-card-close{position:absolute;top:8px;right:8px;z-index:4;display:flex;align-items:center;justify-content:center;
  width:30px;height:30px;padding:0;border-radius:50%;border:1px solid var(--color-border);background:var(--color-surface);
  color:var(--color-fg);cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.18);transition:background .15s ease}
.p3d-card-close:hover,.p3d-card-close:focus-visible{background:var(--color-bg-subtle)}
.p3d-card-close:focus-visible{outline:2px solid var(--color-primary);outline-offset:2px}
/* The stage's own carousel arrows: same shape and placement as shop's card arrows, so
   stepping the model reads as the same control the shopper flicked pictures with. Above
   the canvas, clear of the close button (top-right) and the AR/reset chrome (bottom). */
.p3d-card-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:4;display:flex;align-items:center;
  justify-content:center;width:34px;height:34px;padding:0;border-radius:50%;border:1px solid var(--color-border);
  background:var(--color-surface);color:var(--color-fg);cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.18);
  transition:background .15s ease}
.p3d-card-nav:hover,.p3d-card-nav:focus-visible{background:var(--color-bg-subtle)}
.p3d-card-nav:focus-visible{outline:2px solid var(--color-primary);outline-offset:2px}
.p3d-card-nav svg{flex:none}
.p3d-card-nav-prev{left:8px}
.p3d-card-nav-next{right:8px}
`

