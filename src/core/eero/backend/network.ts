/**
 * eero backend, network area: the account's networks, one network, its
 * health (derived from `GET {net}`, no extra calls) and the signed-in user's
 * permissions. See docs/architecture/commands.md (network).
 */

import { BackendError } from "../../errors";
import type * as M from "../../model";
import { mapHealth, mapNetwork, mapNetworkSummary, mapPermissions, roleFor, unknownNetworkSummary } from "../map/network";
import { asList, type RawAccount, type RawAccountNetworkRef, type RawNetwork, type RawPermissions } from "../raw";
import { idFromUrl, Links, networkPath } from "../urls";
import type { EeroArea, EeroContext } from "./index";

const linksByContext = new WeakMap<EeroContext, Links>();

/**
 * Network links eero handed back (`url`, `resources.*`), shared by the
 * network and internet areas of one backend. Keys: `net:{id}` and
 * `net:{id}.{resource}`.
 */
export function networkLinks(ctx: EeroContext): Links {
  let links = linksByContext.get(ctx);
  if (!links) {
    links = new Links();
    linksByContext.set(ctx, links);
  }
  return links;
}

/** `GET {net}`, remembering its url and resources. */
export async function fetchNetwork(ctx: EeroContext, id: M.Id): Promise<RawNetwork> {
  const links = networkLinks(ctx);
  const raw = await ctx.client.request<RawNetwork | null>({ method: "GET", path: links.get(`net:${id}`, networkPath(id)) });
  if (!raw || typeof raw !== "object") throw new BackendError("eero_error", "eero sent no data for this network.");
  links.set(`net:${id}`, raw.url);
  links.addResources(`net:${id}`, raw.resources);
  return raw;
}

/** `GET {net}/permissions`, or null when eero refuses (older firmware, some roles). */
async function fetchPermissions(ctx: EeroContext, id: M.Id): Promise<RawPermissions | null> {
  const links = networkLinks(ctx);
  try {
    const path = links.get(`net:${id}.permissions`, `${links.get(`net:${id}`, networkPath(id))}/permissions`);
    return (await ctx.client.request<RawPermissions | null>({ method: "GET", path })) ?? null;
  } catch (err) {
    if (err instanceof BackendError && err.code === "eero_error") return null;
    throw err;
  }
}

/** Network refs from the account, else from `GET /2.2/networks`. */
async function networkRefs(ctx: EeroContext): Promise<{ account: RawAccount | null; refs: RawAccountNetworkRef[] }> {
  const account = await ctx.client.request<RawAccount | null>({ method: "GET", path: "/2.2/account" });
  let refs = asList<RawAccountNetworkRef>(account?.networks).filter((r) => typeof r.url === "string");
  if (refs.length === 0) refs = asList<RawAccountNetworkRef>(await ctx.client.request({ method: "GET", path: "/2.2/networks" }), "networks").filter((r) => typeof r.url === "string");
  return { account: account ?? null, refs };
}

export const network: EeroArea<"network"> = (ctx) => {
  const links = networkLinks(ctx);

  return {
    async list() {
      const { account, refs } = await networkRefs(ctx);
      return Promise.all(
        refs.map(async (ref): Promise<M.NetworkSummary> => {
          const id = idFromUrl(ref.url ?? "");
          links.set(`net:${id}`, ref.url);
          const [raw, perms] = await Promise.all([
            fetchNetwork(ctx, id).catch((err: unknown) => {
              // One unreachable network must not hide the others.
              if (err instanceof BackendError && err.code === "eero_error") return null;
              throw err;
            }),
            fetchPermissions(ctx, id),
          ]);
          const role = roleFor(perms, account);
          return raw
            ? mapNetworkSummary(raw, { id, role, name: ref.name, nickname: ref.nickname_label })
            : unknownNetworkSummary(id, ref.name ?? null, ref.nickname_label ?? null, role);
        }),
      );
    },

    async get(id) {
      const [raw, perms] = await Promise.all([fetchNetwork(ctx, id), fetchPermissions(ctx, id)]);
      return mapNetwork(raw, { id, role: roleFor(perms, null) });
    },

    async health(id) {
      return mapHealth(await fetchNetwork(ctx, id));
    },

    async permissions(id) {
      const perms = await fetchPermissions(ctx, id);
      if (!perms) throw new BackendError("eero_error", "eero did not send permissions for this network.");
      return mapPermissions(perms);
    },
  };
};
