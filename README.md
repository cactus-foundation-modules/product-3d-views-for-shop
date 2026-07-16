# Product 3D Views for Shop

3D models for the [Cactus](https://github.com/usersaynoso/cactus-foundation) shop. Upload a model against a product or one of its variations, and it appears in the product gallery as an extra thumbnail with a **3D** badge, turning gently on its own. Click it and the model replaces the main photograph, where the shopper can turn, pan and zoom it.

Requires the [shop](https://github.com/cactus-foundation-modules/shop) module (v0.1.43 or newer). Works happily alongside [shop-variations](https://github.com/cactus-foundation-modules/shop-variations), but does not need it.

## What it does

- **Models on products and on variations.** A "3D views" tab appears in the product editor. Where a product has variations, each one can carry its own model - an oak version and a walnut version of the same chair.
- **A thumbnail in the strip, not a widget bolted alongside.** The 3D thumbnail sits in the gallery's own strip, styled by whatever layout the page uses, so shoppers meet it exactly where they already look for more pictures.
- **Turn, pan and zoom.** Picking the thumbnail hands the gallery's main image over to a viewer. It rotates on its own until the shopper takes hold of it, and then stops getting in their way.
- **Follows the shopper's choice.** With models on the variations and none on the product itself, all of them show until a variation is picked - after which only that variation's does.
- **No duplicates.** Where several variations share one model file (a size run of the same shape, typically), the gallery shows it once rather than once per variation.
- **Filed with the pictures.** Uploads land in the media library under `Shop / <category> / <product> / 3d`, beside the product's own images rather than in a parallel tree.

## Supported formats

| Format | Support |
| --- | --- |
| **GLB** | Recommended. Shape, colours and textures in one file. |
| glTF | Works. A `.gltf` that points at separate `.bin` or texture files will load its shape only, since those siblings were never uploaded - use GLB instead. |
| OBJ | Works, but carries no colours of its own (materials live in a separate `.mtl`), so it renders plain. |
| FBX | Works. Files tend to be large. |
| 3DS | Works. An old format; expect basic results. |

Up to 50 MB per model.

**DWG and USDZ are not accepted**, and the upload will say so rather than taking the file and quietly doing nothing with it:

- **DWG** is AutoCAD's proprietary format. Nothing in a browser can read one; it needs a paid server-side conversion service (Autodesk's or ODA's) to become anything renderable.
- **USDZ** only opens through Apple's AR Quick Look. It takes over the whole screen on an iPhone and does nothing at all on desktop or Android, so it cannot drive the inline viewer this module is built around.

## How it hangs together

The gallery is not owned by one module. On a plain product it is shop's own; on a product with options it is shop-variations', which takes over shop's Gallery slot. So this module contributes to **whichever gallery is rendering** through shop's `shop.gallery-media` extension point, rather than trying to be a third gallery. Shop supplies the strip, the stage and the class names; this module supplies the thumbnails and the viewer, and shop never learns what a 3D model is.

A variation is a hidden child product row, so a model is only ever attached to a product id - this module holds no notion of options or variants, and reads shop-variations' tables only to name and list a product's variations, and only when it is installed.

Every auto-rotating thumbnail on a page draws through **one shared WebGL context**, blitted into per-thumbnail 2D canvases. A context each would be simpler and would break: browsers cap live contexts at roughly 8-16 per page and silently kill the oldest past that, which on a product with a dozen variations means thumbnails going blank on someone else's machine.

## Requirements

- Cactus core **v0.5.465** or newer (which is where `three` enters core's dependencies).
- The shop module **v0.1.43** or newer (which is where `shop.gallery-media` arrives).
- A media provider configured under **Settings › Media** - models are stored the same way images are.

## Licence

MIT.
