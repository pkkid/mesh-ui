import type { MeshApi } from "@shared/types";

declare global {
  interface Window {
    mesh: MeshApi;
  }
}
