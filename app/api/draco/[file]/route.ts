import { serveDecoderAsset } from '@/modules/product-3d-views-for-shop/lib/decoder-assets'

// The Draco decoder's old url, kept working.
//
// Deprecated: the viewer now asks for both of its decoders under /decoders (see
// ../decoders/[file]/route.ts), which is where the Basis transcoder lives too.
// This is not simply the same file renamed - it is a url that shipped, and the
// decoder path is baked into a shopper's JavaScript bundle rather than resolved
// fresh per request. Someone who loaded a product page moments before a deploy is
// still running the old bundle, and will ask for this path the instant they open
// a Draco-compressed model; dropping it would have that model quietly fail to
// appear for them, with nothing they could do about it but reload a page that
// gave them no reason to.
//
// Safe to delete once no deployment older than the one that introduced /decoders
// can still be serving pages - in practice, one release later.

export async function GET(_request: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params
  return serveDecoderAsset(file)
}
