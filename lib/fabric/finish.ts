// How shiny a painted part reads, worked out from the words on the swatch the
// shopper picked.
//
// The configurator paints COLOUR: a part's swatch replaces its base colour map and
// nothing else, so the surface keeps whatever finish the model's author gave it (see
// applyFabricPaint). That is right for a range of fabrics, which all catch the light
// the same way - and wrong the moment one of the choices is leather, which does not.
// A leather swatch on a material authored as cloth renders as flat as the cloth
// beside it, and the only way out was a second model file per leather variation:
// the same geometry twice, forever in step with each other, for one number.
//
// So the swatch's own name is read for a word that means "shiny", and the part is
// given a matching sheen. No modelling, no second file, and nothing to configure - a
// shop that calls its leather "leather" gets it, and a range with no such swatch is
// painted exactly as it was before.
//
// Pure and database-free: the resolver composes it into the bundle server-side, and
// the admin panel's preview runs the same function on the same words, so the two can
// never disagree about which parts shine.

/**
 * The words that mean "this is a shiny material", and how glossy each one reads on a
 * 0-1 scale (see `detectGloss`).
 *
 * Substring matches, deliberately: "Leatherette", "Faux leather" and "Bonded leather"
 * are all leather-look surfaces with the same soft specular, and a shop names them
 * however its supplier does. The value is a judgement about a real material rather
 * than a preference - leather is a dielectric with a broad, soft highlight, nothing
 * like a lacquer or a chrome - so it is a constant here rather than a setting nobody
 * would know how to answer.
 */
const GLOSS_BY_KEYWORD: { pattern: RegExp; gloss: number }[] = [{ pattern: /leather/i, gloss: 0.55 }]

/**
 * The last segment of a url path, without its query - the swatch picture's own
 * filename ("black-leather.webp").
 *
 * Only the filename is read, never the whole url. A shop's media keys carry folders
 * for the category and the product (media/shop/leather-chairs/orion/navy.webp), and
 * matching against those would give every fabric on a product filed under "leather"
 * a sheen it was never asked for. The filename is the one part of the path that
 * describes THIS swatch.
 *
 * The query goes because a url arrives here signed (`?t=…`), and a token is not a
 * description of anything.
 */
function fileNameOf(url: string): string {
  const path = url.split(/[?#]/)[0] ?? ''
  const name = path.split('/').pop() ?? ''
  // Decoded so a key stored with escapes ("black%20leather.webp") reads as the words
  // it stands for. A malformed escape is not worth failing over - the raw name still
  // matches everything that is not escaped.
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

/**
 * How glossy the swatch behind a part reads: 0 to leave the model's own finish
 * exactly as its author left it (the overwhelming majority, and what every part did
 * before this existed), up to 1 for a mirror.
 *
 * Read from the swatch's LABEL first - the words the shop chose, which is where a
 * material is actually named ("Soft Leather - Black") - and from the picture's
 * filename as well, since plenty of ranges label a value by its colour alone and
 * carry the material only in the file it points at. Either saying "leather" is
 * enough; a part whose swatch says so in neither is left alone.
 *
 * The highest match wins, so a swatch answering to two words is as shiny as the
 * shiniest of them rather than as whichever happened to be listed first.
 */
export function detectGloss(input: { label?: string | null; textureUrl?: string | null }): number {
  const words = [input.label ?? '', input.textureUrl ? fileNameOf(input.textureUrl) : ''].join(' ')
  if (!words.trim()) return 0
  let gloss = 0
  for (const { pattern, gloss: value } of GLOSS_BY_KEYWORD) {
    if (pattern.test(words) && value > gloss) gloss = value
  }
  return gloss
}
