import { serveDecoderAsset } from '@/modules/product-3d-views-for-shop/lib/decoder-assets'

// Serves this module's vendored Draco and Basis Universal decoders, same-origin,
// at /api/m/product-3d-views-for-shop/decoders/<file> . All of the reasoning
// lives in lib/decoder-assets.ts, which the deprecated /draco route shares.

export async function GET(_request: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params
  return serveDecoderAsset(file)
}
