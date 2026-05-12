import { HttpRouter, HttpServerResponse } from 'effect/unstable/http';

const helloRoute = HttpRouter.add(
  'GET',
  '/hello',
  HttpServerResponse.text('<html><body>Hello</body></html>', {
    contentType: 'text/html',
  }),
);

export const helloRouteLayer = helloRoute;
