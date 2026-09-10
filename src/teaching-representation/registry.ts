import type { RepresentationCapability } from './capability.ts';

/** Implementation registry, never a lesson payload store. The composition root
 * registers trusted capabilities; Canvas has no domain implementation imports. */
export class CapabilityRegistry {
  private readonly implementations = new Map<string, RepresentationCapability>();
  register(capability: RepresentationCapability): this {
    if (!capability.capabilityId.trim() || this.implementations.has(capability.capabilityId)) throw new Error('duplicate-or-empty-capability');
    this.implementations.set(capability.capabilityId, Object.freeze({ ...capability }));
    return this;
  }
  resolve(id: string): RepresentationCapability {
    const capability = this.implementations.get(id);
    if (!capability) throw new Error(`unknown-capability:${id}`);
    return capability;
  }
}
