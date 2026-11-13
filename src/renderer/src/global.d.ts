import type { LegacyMeshApi, MeshApi } from "@shared/types";

declare global {
  interface Window {
    /** `LegacyMeshApi` goes once the prototype pages are retired (M1.7, M1.9). */
    mesh: MeshApi & LegacyMeshApi;
  }
}
