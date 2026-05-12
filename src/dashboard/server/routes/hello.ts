import { Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http';

export const HELLO_HTML = '<html><body>Hello</body></html>';

export const helloResponse = HttpServerResponse.text(HELLO_HTML, { contentType: 'text/html' });

const getHelloRoute = HttpRouter.add(
  'GET',
  '/hello',
  helloResponse,
);

export const helloRouteLayer = Layer.mergeAll(getHelloRoute);
