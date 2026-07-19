import type { MediaProviderType } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { buildKey } from '@/lib/media/upload'
import { stripExtension } from '@/lib/media/keys'
import { getProductById } from '@/modules/shop/lib/db/products'

// The object key a model is stored under.
//
// Models used to take core's default key form, "<nanoid>-<filename>.glb", which
// filed a perfectly well-named model as
// "aibCVDH7Ut725_NsRv0rO-120cm-natural-wood-2-person-1.glb". The folder said which
// product it belonged to and the filename said nothing an owner would recognise,
// so the media library was full of files only their folder could identify.
//
// Product images have not had this problem: the shop renames them to
// "<product-slug><n>" once they are filed (see reorganiseProductMedia). Models get
// the same treatment in the one place that can still choose - the key is signed
// before the bytes are sent, so it has to be right first time rather than tidied
// up afterwards.
//
// The parent product's slug is the prefix, not the variation's, for the same
// reason the folder is the parent's: a variation is a hidden child product whose
// name the site owner is never shown, and the filename the owner uploaded already
// says which variation it is.

/** Longest run of `-2`, `-3`… suffixes tried before giving up on an exact name. */
const MAX_DISAMBIGUATION = 50

function sanitiseSlug(slug: string): string {
  return slug.replace(/[^a-z0-9._-]/gi, '-').replace(/-+/g, '-').toLowerCase()
}

/**
 * Name a model file after the product it belongs to: "<product-slug>-<filename>".
 *
 * Exact-name keys overwrite each other in storage, which is what the shop wants
 * for product images (the same image re-filed lands on the same key) and very much
 * not what a model wants: two variations whose owner uploaded "model.glb" for both
 * would share one object, so deleting either model would take the other's file
 * with it. So a name already spoken for by a different library row gets a numeric
 * suffix, and a name that somehow cannot be made unique falls back to core's
 * nanoid form rather than clobbering anything.
 */
export type ModelKeyPlan = {
  /** The object key itself, for the half of the upload that signs one. */
  key: string
  /**
   * The two arguments that make uploadMedia() rebuild exactly this key, for the
   * fallback half that hands core the bytes and lets it do the filing.
   */
  nameForKey: string
  exactName: boolean
}

export async function buildModelKey({
  provider,
  mimeType,
  filename,
  folderPath,
  parentProductId,
}: {
  provider: MediaProviderType
  mimeType: string
  filename: string
  folderPath?: string
  parentProductId: string
}): Promise<ModelKeyPlan> {
  const plan = (nameForKey: string, exactName: boolean): ModelKeyPlan => ({
    key: buildKey(provider, mimeType, nameForKey, folderPath, exactName),
    nameForKey,
    exactName,
  })
  // The nanoid form carries its own uniqueness, so it is always a safe answer.
  const fallback = () => plan(filename, false)

  const product = await getProductById(parentProductId)
  const slug = product?.slug ? sanitiseSlug(product.slug) : ''
  const base = stripExtension(filename).trim()
  if (!slug || !base) return fallback()

  // Don't say the product's name twice when the uploaded file already leads with
  // it - "oslo-desks-oslo-desks-120cm.glb" helps nobody.
  const lower = base.toLowerCase()
  const named = lower === slug || lower.startsWith(`${slug}-`) ? base : `${slug}-${base}`

  for (let attempt = 1; attempt <= MAX_DISAMBIGUATION; attempt++) {
    const candidate = plan(attempt === 1 ? named : `${named}-${attempt}`, true)
    const taken = await prisma.media.findFirst({ where: { key: candidate.key }, select: { id: true } })
    if (!taken) return candidate
  }
  return fallback()
}
