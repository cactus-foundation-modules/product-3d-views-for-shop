import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'

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
    autoRotateSpeed: z.number().min(0.1).max(10).default(1.2),
    // Off keeps the historic behaviour: auto-rotate orbits the camera around a
    // still model - a person walking round a fixed object. On turns the model
    // itself instead, the way the thumbnails already spin (see thumb-stage), and
    // freezes the shadow map so the shadow stays anchored to the floor while the
    // model rotates above it. The freeze is the point: with a live shadow map the
    // shadow re-projects the turning silhouette every frame and travels round with
    // the model, which looks identical to the camera orbiting - so without it the
    // setting appears to do nothing. Only affects the idle spin; a shopper's drag
    // still orbits the camera either way, and auto-rotate stops for good on first
    // touch regardless.
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

export async function getP3dConfig(): Promise<P3dConfig> {
  // Probed with to_regclass first, the same way this module reaches the svr_
  // tables (see lib/db/models.ts). p3d_settings arrives in migration 002, so an
  // install running this code against a database that has not had 002 applied yet
  // has no such table - and "no table" means "nothing saved", which is the
  // defaults, not a 500 on the shopper's product page. The window is small (the
  // deploy that ships this code applies the migration) but 001-in-place is
  // exactly how a module update took a live site's pages down once already.
  const [probe] = await prisma.$queryRaw<{ exists: string | null }[]>`
    SELECT to_regclass('public.p3d_settings')::text AS "exists"
  `
  if (!probe?.exists) return P3D_CONFIG_DEFAULTS

  const rows = await prisma.$queryRaw<{ config: unknown }[]>`
    SELECT "config" FROM "p3d_settings" WHERE "id" = 'singleton' LIMIT 1
  `
  return parseP3dConfig(rows[0]?.config)
}

let cachedConfig: P3dConfig | null = null
let cachedConfigAt = 0
const CACHE_TTL_MS = 5_000

/**
 * The read every product page with a model does. Cached for a few seconds because
 * the alternative is a database round-trip per product page for a row that changes
 * about twice a year, and uncached it would sit on the critical path of the page
 * the shopper is waiting for.
 */
export async function getP3dConfigCached(): Promise<P3dConfig> {
  const now = Date.now()
  if (cachedConfig && now - cachedConfigAt < CACHE_TTL_MS) return cachedConfig
  const config = await getP3dConfig()
  cachedConfig = config
  cachedConfigAt = now
  return config
}

export function invalidateP3dConfigCache(): void {
  cachedConfig = null
  cachedConfigAt = 0
}

/** Merge-then-validate partial update, mirroring updateShopConfig. */
export async function updateP3dConfig(patch: Partial<P3dConfig>): Promise<P3dConfig> {
  const current = await getP3dConfig()
  const next = P3dConfigSchema.parse({ ...current, ...patch })
  // Upsert rather than a bare UPDATE: nothing seeds this row, so the first save
  // on every install is an INSERT, and an UPDATE would affect zero rows, return
  // 200, and persist nothing.
  const serialised = JSON.stringify(next)
  await prisma.$executeRaw`
    INSERT INTO "p3d_settings" ("id", "config", "updated_at")
    VALUES ('singleton', ${serialised}::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO UPDATE
      SET "config" = ${serialised}::jsonb, "updated_at" = CURRENT_TIMESTAMP
  `
  invalidateP3dConfigCache()
  return next
}
