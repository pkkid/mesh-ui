import type { LegacyMeshApi, MeshApi } from "@shared/types";

declare global {
  interface Window {
    /** `LegacyMeshApi` goes with the prototype LoginView (M1.9). */
    mesh: MeshApi & LegacyMeshApi;
  }
}
