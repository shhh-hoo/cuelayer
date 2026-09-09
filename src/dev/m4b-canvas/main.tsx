import React from "react";
import ReactDOM from "react-dom/client";
import M4BCanvas from "./M4BCanvas";
import TeachingSample from "./TeachingSample";

const sample = new URLSearchParams(window.location.search).get("design") === "2";
if (sample) document.title = "CueLayer · Teaching canvas";
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode>{sample ? <TeachingSample /> : <M4BCanvas />}</React.StrictMode>);
