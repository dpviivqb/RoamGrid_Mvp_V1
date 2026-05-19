export function createPulsingMarkerElement() {
  const root = document.createElement("div");
  root.className = "roamgrid-marker";

  const ring = document.createElement("div");
  ring.className = "roamgrid-marker-ring";

  const core = document.createElement("div");
  core.className = "roamgrid-marker-core";

  root.append(ring, core);
  return root;
}
