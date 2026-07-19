// three ships its meshopt decoder as a plain .js module with no types beside it
// (unlike the loaders under examples/jsm/loaders, which are typed). Declared here
// so the GLTFLoader wiring in lib/three/load-model.ts can import it without a
// blanket ts-ignore.
//
// Its shape is taken from the very method it is handed to, rather than written out
// by hand: the decoder's full surface is a dozen buffer functions this module never
// calls, and a hand-copied version of it would be one three upgrade away from
// describing something that no longer exists.
declare module 'three/examples/jsm/libs/meshopt_decoder.module.js' {
  import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
  // NonNullable because the setter accepts null to mean "no decoder", which is not
  // something this export can ever be.
  export const MeshoptDecoder: NonNullable<Parameters<GLTFLoader['setMeshoptDecoder']>[0]>
}
