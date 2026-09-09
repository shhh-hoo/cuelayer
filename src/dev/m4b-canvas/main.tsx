import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import M4BCanvas from "./M4BCanvas";
import TeachingSample from "./TeachingSample";

const design = new URLSearchParams(window.location.search).get("design");
const sample = design === "2";
const Choreography = lazy(() => import("../m4b-choreography/Choreography.tsx"));
if (sample) document.title = "CueLayer · Teaching canvas";
if (design === "choreography") document.title = "CueLayer · Teaching choreography";
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode>{design === "choreography"
  ? <Suspense fallback={<p>Opening teaching choreography…</p>}><Choreography /></Suspense>
  : sample ? <TeachingSample /> : <M4BCanvas />}</React.StrictMode>);
