import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
const routes = HttpRouter.add("GET", "/test", Effect.succeed(
  HttpServerResponse.text(JSON.stringify({ works: true }), { contentType: "application/json" })
));
const server = HttpRouter.serve(routes).pipe(Layer.provideMerge(BunHttpServer.layer({ port: 3099 })));
BunRuntime.runMain(Layer.launch(server));
