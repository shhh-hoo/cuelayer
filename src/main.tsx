import React from "react";
import ReactDOM from "react-dom/client";
import "./session.css";

// The fixture route never loads or mounts the live session/provider application.
const { default: App } = import.meta.env.DEV && window.location.pathname === "/dev/core-canvas"
  ? await import("./spikes/core-canvas/CoreCanvasSpike")
  : await import("./App");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
