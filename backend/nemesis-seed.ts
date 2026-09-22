/** Build local genesis indexes from the serialized BlockElement, never remote chain statistics. */
export function buildNemesisSeedState(element: Buffer) {
  if (element.length < 4) throw new Error('Truncated nemesis block element');
  const blockSize = element.readUInt32LE(0);
  if (blockSize < 4 || blockSize + 64 > element.length) {
    throw new Error('Nemesis block element is missing its entity/generation hashes');
  }
  // BlockElementSerializer writes the entity hash immediately after the block.
  const hash = element.subarray(blockSize, blockSize + 32);
  if (hash.every(byte => byte === 0)) throw new Error('Nemesis entity hash must not be zero');

  const index = Buffer.alloc(8);
  index.writeBigUInt64LE(1n);
  // HashFile is indexed by height: slot zero is unused, slot one is the entity hash.
  const hashes = Buffer.concat([Buffer.alloc(32), hash]);
  const proofIndex = Buffer.alloc(48);
  proofIndex.writeUInt32LE(1, 0); // epoch
  proofIndex.writeUInt32LE(1, 4); // point
  proofIndex.writeBigUInt64LE(1n, 8);
  hash.copy(proofIndex, 16);

  const proof = Buffer.alloc(56);
  proof.writeUInt32LE(56, 0); // size includes the header
  proof.writeUInt32LE(1, 4); // version
  proofIndex.copy(proof, 8);
  return { index, hashes, proofIndex, proof };
}
