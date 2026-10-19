import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecomputingStatus } from "./RecomputingStatus";

const html = (active: boolean) =>
  renderToStaticMarkup(<RecomputingStatus active={active} label="recomputing…" />);

describe("recomputing indicator", () => {
  it("exposes no text while nothing is recomputing", () => {
    const idle = html(false);
    expect(idle).toContain('role="status"');
    expect(idle).not.toContain("recomputing");
  });

  it("puts the text inside the status region while it is", () => {
    const busy = html(true);
    expect(busy).toMatch(/role="status"[^>]*>[\s\S]*recomputing…/);
  });

  it("stops pulsing for a user who asked for reduced motion", () => {
    expect(html(true)).toContain("motion-reduce:animate-none");
  });
});
