import { z } from 'zod'

// Client-safe half of this module's viewer settings.
//
// The settings tab is a client component and needs the schema, the type and the
// defaults. Those cannot live beside the prisma-backed readers below them: a
// value import from a client component drags `lib/db/prisma` into the browser
// bundle, and since core started attaching a client extension at module scope
// (Prisma.defineExtension) that throws on load and takes the whole admin
// Settings page down with it. Type-only imports are erased and would have been
// fine; a value import like P3D_CONFIG_DEFAULTS is not.
//
// So: everything here is pure zod, no database. `lib/config.ts` re-exports all
// of it, so every existing server-side import keeps working unchanged.

// Viewer settings, stored as one JSON blob on the p3d_settings singleton row.
// Same approach as shop's ShpConfig: a corrupt or partial column falls back to
// defaults rather than taking the product page down with it.
//
// EVERY default here is the value this module hardcoded before there were any
// settings at all. That is not a coincidence, it is the requirement: an install
// that upgrades into this version has no saved row, reads defaults, and its
// products look exactly as they did the day before. A site owner who never opens
// the tab should never be able to tell it exists.
//
// Ranges are clamps against a number that would break the viewer rather than
// merely make it ugly - a fieldOfView of 300 or a maxDistance below minDistance
// leaves the shopper with nothing on screen and no way back. Ugly-but-recoverable
// is the site owner's call, not ours.

export const P3dConfigSchema = z
  .object({
    // --- Lighting ---------------------------------------------------------

    // Shadows are off by default, and not just for the usual "don't change how an
    // existing site looks" reason: a model with no ground contact floats, and a
    // shadow under a model whose own file already has one baked into its texture
    // gives it two. Which of those a given catalogue suffers from is something
    // only the person looking at it can say.
    shadowsEnabled: z.boolean().default(false),
    // Maps to shadow map size + PCF radius (see resolveShadowQuality). Softer
    // costs more to render, and on a big model reads as a smudge; sharper reads
    // as a cutout on a fabric product. No right answer per catalogue.
    shadowSoftness: z.enum(['sharp', 'soft', 'softest']).default('soft'),
    shadowOpacity: z.number().min(0).max(1).default(0.3),

    // 'none' matches the renderer's own default, which is what this module has
    // always used. 'aces' is the filmic curve most 3D tools preview through, so a
    // model that looked right in Blender and blown out here is usually asking for
    // this. 'neutral' is three's own, gentler on saturated product colours.
    toneMapping: z.enum(['none', 'aces', 'neutral']).default('none'),
    // Ignored when toneMapping is 'none' - the renderer applies exposure as part
    // of the tone curve, so there is nothing for it to scale without one. The
    // admin tab greys the field out rather than letting it look live.
    exposure: z.number().min(0.1).max(3).default(1),

    // The procedural studio environment's contribution. This is the setting that
    // decides whether chrome and steel read as metal or as black holes (see
    // addLights), so 0 is allowed but is very much a "you asked for it" value.
    environmentIntensity: z.number().min(0).max(3).default(1),
    ambientIntensity: z.number().min(0).max(5).default(0.6),
    keyLightIntensity: z.number().min(0).max(5).default(1.2),
    fillLightIntensity: z.number().min(0).max(5).default(0.4),

    // --- Stage ------------------------------------------------------------

    // 'transparent' lets the page's own background through, which is why the
    // viewer has always suited every theme without being told about any of them.
    // 'colour' paints backgroundColour behind the model; 'environment' shows the
    // studio the model is already being lit by, which is the only option that
    // makes a reflective product's reflections make sense.
    background: z.enum(['transparent', 'colour', 'environment']).default('transparent'),
    // A raw hex value rather than a theme token on purpose: this is the site
    // owner's content decision about one product surface, picked from a colour
    // input, not admin chrome. Validated so a typo can't reach three.js as NaN
    // and paint the stage black.
    backgroundColour: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Background colour must be a hex value like #f5f5f5')
      .default('#f5f5f5'),

    // --- Controls ---------------------------------------------------------

    // A shopper's own "reduce motion" setting still wins over this at render
    // time - this is the site owner saying what happens for everyone who has not
    // asked for less movement, not an override of the ones who have.
    autoRotate: z.boolean().default(true),
    // What the idle motion actually is. 'continuous' (the default, and what this
    // module has always done) turns the model for as long as the shopper is
    // looking at it, or until they take hold of it. It is only ever drawn while
    // the viewer is genuinely on screen and the tab is in front - a backgrounded
    // tab gets no animation frames from the browser at all, and a viewer scrolled
    // out of view parks its own loop - so the cost is paid while somebody is
    // watching and not otherwise.
    //
    // 'nudge' makes the same point once and then stops: the model turns through
    // autoRotateSweep the first time it comes into view and then holds still, at
    // which point the renderer has nothing to draw for the rest of the visit. The
    // one to reach for if shoppers on older phones report the page getting warm.
    autoRotateStyle: z.enum(['nudge', 'continuous']).default('continuous'),
    // How far the nudge turns, in degrees. Enough to read as depth - a face
    // rotating away, a side coming into view - and not so far that the model ends
    // up showing a shopper its back before they have touched anything. Ignored
    // entirely when the style is 'continuous'.
    autoRotateSweep: z.number().min(5).max(180).default(40),
    autoRotateSpeed: z.number().min(0.1).max(10).default(1.2),
    // Off keeps the historic behaviour: the camera does everything - auto-rotate
    // orbits it, and a drag swings it round a still model, shadow and all. On, the
    // MODEL is the thing that turns, idle spin and horizontal drag alike, while
    // the camera, the light and the floor hold still: the shadow stays anchored
    // to the floor beneath and its silhouette follows the turning model (the
    // shadow map stays live; the light never moves, so the shadow cannot travel).
    // Vertical drag still tilts the view, zoom and pan are unchanged, and the
    // idle spin stops for good on first touch either way. Governs the drag even
    // when autoRotate is off - it picks WHAT a drag turns, not just what idles.
    spinModel: z.boolean().default(false),
    enablePan: z.boolean().default(true),
    // The bounds that stop a shopper zooming through the model or pushing it away
    // to a dot they then have to hunt for. Both are easy to do by accident on a
    // trackpad and neither has an obvious way back, so the range is clamped and
    // the ordering is enforced below.
    minDistance: z.number().min(0.1).max(50).default(1.5),
    maxDistance: z.number().min(0.1).max(50).default(12),
    // What makes a drag feel like turning an object rather than scrubbing a
    // slider. Lower is heavier.
    dampingFactor: z.number().min(0.01).max(1).default(0.08),
    fieldOfView: z.number().min(10).max(120).default(40),

    // --- Performance ------------------------------------------------------

    antialias: z.boolean().default(true),
    // Cap, not a fixed ratio: the renderer still uses the device's own value when
    // it is lower. Above 2 a retina screen renders four times the pixels for a
    // difference nobody has ever picked out in a blind test.
    pixelRatioCap: z.number().min(1).max(3).default(2),
    // Supersampling: a multiplier ON TOP of the device ratio, so the viewer can
    // draw ABOVE the screen's own resolution and downsample. pixelRatioCap only
    // caps downward (min against devicePixelRatio), so on a plain 1x monitor it
    // can never add detail - the render is stuck at 1x and a fine fabric weave
    // aliases to a choppy shimmer whenever the model is small on screen (zoomed
    // out). MSAA (antialias) smooths the silhouette, not the shaded surface where
    // the weave lives, so it does nothing for this; anisotropy fixes grazing-angle
    // wash, a different failure. Rendering more samples per pixel and averaging
    // them down is the actual cure. 1 is exactly today's behaviour - the model
    // hardcoded no supersampling - so an install that upgrades looks unchanged
    // until the owner reaches for it. The cost is quadratic (2x = 4x the pixels),
    // which is why it is a dial and not just always on; capped at 2 so nobody can
    // ask a phone GPU for 9x the fill and wonder why the viewer crawls.
    superSampling: z.number().min(1).max(2).default(1),
    // The thumbnail strip's slow spin, which is what says "this one moves" before
    // anybody clicks it. Separate from autoRotate because the two answer different
    // questions: a site owner may well want the viewer still and the thumbnails
    // turning, and the thumbnails are the cheaper of the two to leave running.
    thumbnailAutoRotate: z.boolean().default(true),
  })
  // A maxDistance at or below minDistance leaves OrbitControls with an empty
  // range: the model locks at one distance and the scroll wheel does nothing,
  // which reads as a broken viewer rather than as a bad setting. Refused at the
  // schema so it can't be saved, not clamped at render time where the site owner
  // would never learn their number was ignored.
  .refine((c) => c.maxDistance > c.minDistance, {
    message: 'Furthest zoom must be greater than closest zoom',
    path: ['maxDistance'],
  })

export type P3dConfig = z.infer<typeof P3dConfigSchema>

export const P3D_CONFIG_DEFAULTS: P3dConfig = P3dConfigSchema.parse({})

export function parseP3dConfig(raw: unknown): P3dConfig {
  const result = P3dConfigSchema.safeParse(raw ?? {})
  return result.success ? result.data : P3D_CONFIG_DEFAULTS
}
