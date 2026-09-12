'use client'

// The gallery's 3D pieces, behind a lazy edge.
//
// WHAT THIS IS FOR, and it is worth the file. `lib/gallery-provider.ts` is
// registered at shop's `shop.gallery-media` extension point, and that registry -
// lib/modules/extension-points.public.ts - is reached from the PUBLIC LAYOUT:
//
//   app/(public)/layout.tsx
//     -> lib/puck/config.rsc.tsx
//     -> lib/puck/mobile-bar-items.ts
//     -> lib/modules/extension-points.public.ts
//     -> lib/gallery-provider.ts
//     -> components/public/Gallery3d.tsx
//     -> lib/three/load-model.ts
//
// So Gallery3d sat in the client graph of EVERY page on the site - the contact
// page, the login page, a members list - and Turbopack, quite reasonably, merged
// the three.js it pulls in with chunks that every page genuinely needs. Measured
// on the live site: three chunks carrying three.js, 224 KB brotli, downloaded and
// executed as `<script async>` on every single page. Lighthouse reported them as
// ~100% unused. The 3D module was already doing everything right - three itself
// is only ever `await import('three')` - but a dynamic import inside a module
// that is statically in the graph still gives the bundler something to merge.
//
// A `dynamic()` cannot be created in the provider itself: that file is server-only
// (it reaches prisma), and shop passes Thumbs and Stage across the RSC boundary as
// PROPS, which only a client reference can survive. So the wrapper lives here, in
// a client module of its own - a few lines that are cheap to carry everywhere, and
// the 500 KB behind them loads on the product pages that actually have a model.
//
// Deliberately no `ssr: false`: the strip and the stage should still render their
// markup on the server, exactly as before. What changes is when the JavaScript
// arrives, not whether the HTML does.

import dynamic from 'next/dynamic'
import type { ShopGalleryExtraStageProps, ShopGalleryExtraThumbsProps } from '@/modules/shop/lib/gallery-media'

export const Gallery3dThumbsLazy = dynamic<ShopGalleryExtraThumbsProps>(
  () => import('@/modules/product-3d-views-for-shop/components/public/Gallery3d').then((m) => m.Gallery3dThumbs),
)

export const Gallery3dStageLazy = dynamic<ShopGalleryExtraStageProps>(
  () => import('@/modules/product-3d-views-for-shop/components/public/Gallery3d').then((m) => m.Gallery3dStage),
)
