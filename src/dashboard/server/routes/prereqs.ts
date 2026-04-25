import { jsonResponse } from "../http-helpers.js";
import { httpHandler } from "./http-handler.js";
/**
 * Prerequisite route module — lazy tool checking and installation
 *
 * Endpoints:
 *   GET  /api/prereqs             — list all features and their tool status
 *   GET  /api/prereqs/:feature    — check which tools are missing for a feature
 *   POST /api/prereqs/install     — install a specific tool by name
 */

import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import {
  PREREQ_REGISTRY,
  INSTALLABLE_TOOLS,
  isToolInstalled,
  installTool,
  type PrereqFeature,
  type PrereqTool,
} from "../../../lib/prereqs/registry.js";

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
});

// ─── Route: GET /api/prereqs ──────────────────────────────────────────────────

const listPrereqsRoute = HttpRouter.add(
  "GET",
  "/api/prereqs",
  httpHandler(
    Effect.gen(function* () {
      const features = Object.entries(PREREQ_REGISTRY).map(
        ([feature, tools]) => ({
          feature,
          tools,
        })
      );
      return jsonResponse({ features, installable: INSTALLABLE_TOOLS });
    })
  )
);

// ─── Route: GET /api/prereqs/:feature ─────────────────────────────────────────

const checkFeatureRoute = HttpRouter.add(
  "GET",
  "/api/prereqs/:feature",
  httpHandler(
    Effect.gen(function* () {
      const params = yield* HttpRouter.params;
      const feature = params["feature"] ?? "";

      if (!(feature in PREREQ_REGISTRY)) {
        return jsonResponse({ error: `Unknown feature: ${feature}` }, { status: 400 });
      }

      const tools = PREREQ_REGISTRY[feature as PrereqFeature];
      const status = yield* Effect.promise(async () => {
        const entries = await Promise.all(
          tools.map(async (tool) => ({
            tool,
            installed: await isToolInstalled(tool),
            installable: INSTALLABLE_TOOLS.includes(tool as PrereqTool),
          }))
        );
        return entries;
      });

      const missing = status.filter((s) => !s.installed);

      return jsonResponse({
        feature,
        tools: status,
        ready: missing.length === 0,
        missing: missing.map((m) => m.tool),
      });
    })
  )
);

// ─── Route: POST /api/prereqs/install ─────────────────────────────────────────

const installToolRoute = HttpRouter.add(
  "POST",
  "/api/prereqs/install",
  httpHandler(
    Effect.gen(function* () {
      const body = (yield* readJsonBody) as { tool?: string };
      const tool = body.tool;

      if (!tool) {
        return jsonResponse({ error: "Missing 'tool' in request body" }, { status: 400 });
      }

      if (!INSTALLABLE_TOOLS.some((t) => t === tool)) {
        return jsonResponse(
          { error: `Tool '${tool}' is not auto-installable` },
          { status: 400 }
        );
      }

      const result = yield* Effect.promise(() =>
        installTool(tool as PrereqTool)
      );

      return jsonResponse(result, { status: result.success ? 200 : 500 });

      return jsonResponse(result, { status: result.success ? 200 : 500 });
    })
  )
);

export const prereqsRouteLayer = Layer.mergeAll(
  listPrereqsRoute,
  checkFeatureRoute,
  installToolRoute
);

export default prereqsRouteLayer;
