// Shared glTF-Transform NodeIO factory: registers all extensions plus the
// meshopt encoder/decoder, matching what validate-assets.mjs needs to open
// the compressed .glb outputs and what the texture-attach step needs to
// write intermediate .glb files.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

let ioPromise;

export function getIO() {
  if (!ioPromise) {
    ioPromise = (async () => {
      await MeshoptDecoder.ready;
      await MeshoptEncoder.ready;
      return new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({
          'meshopt.decoder': MeshoptDecoder,
          'meshopt.encoder': MeshoptEncoder,
        });
    })();
  }
  return ioPromise;
}
