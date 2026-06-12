import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GovStatusTag } from "../../../components/common/GovStatusTag";

describe("GovStatusTag", () => {
  it("renders status text so color is not the only indicator", () => {
    render(<GovStatusTag status="NEEDS_CORRECTION" />);
    expect(screen.getByText("Needs correction")).toBeInTheDocument();
  });

  it("renders review status text with an aria-hidden icon", () => {
    const { container } = render(<GovStatusTag status="FAIL" />);
    expect(screen.getByText("Fail")).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
