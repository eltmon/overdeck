// Ported from t3code (MIT, Copyright (c) 2026 T3 Tools Inc.)
// upstream: apps/web/src/components/files/DelimitedTablePreview.tsx @ 2d8a843e6b
import { lazy, Suspense } from "react";
import { ViewerLoading } from "../shared/ViewerChrome";

const LargeTextViewer = lazy(() => import("./LargeTextViewer"));
export function DelimitedTablePreview(props: {
  readonly name: string;
  readonly text: string;
  readonly delimiter: "," | "\t";
}) {
  return (
    <Suspense fallback={<ViewerLoading />}>
      <LargeTextViewer key={props.name} {...props} />
    </Suspense>
  );
}
