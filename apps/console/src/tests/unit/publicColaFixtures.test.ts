import { describe, expect, it } from "vitest";
import { realColaFixtureSeeds } from "../../domain/application/realColaFixtures";

describe("public COLA fixture seeds", () => {
  it("loads the bundled real registry records with label images", () => {
    expect(realColaFixtureSeeds.length).toBe(41);
    expect(realColaFixtureSeeds.some((seed) => seed.id === "ttb-19337001000251")).toBe(true);
    expect(realColaFixtureSeeds.some((seed) => seed.id === "ttb-19344001000769")).toBe(false);

    const first = realColaFixtureSeeds[0];
    expect(first.source).toBe("public_cola_registry");
    expect(first.images.length).toBeGreaterThan(0);
    expect(first.images[0].url).toMatch(/label_/);
    expect(first.expected.applicationId).toBeTruthy();
  });

  it("promotes audited common TTB criteria into expected application fields", () => {
    const transcontinental = realColaFixtureSeeds.find((seed) => seed.id === "ttb-19337001000251");
    expect(transcontinental?.expected.brandName).toBe("TRANSCONTINENTAL");
    expect(transcontinental?.expected.alcoholContent).toBe("66.7% alc. by vol.");
    expect(transcontinental?.expected.netContents).toBe("750 ml");
    expect(transcontinental?.expected.producerName).toBe("LA MAISON & VELIER");
    expect(transcontinental?.expected.countryOfOrigin).toBe("TRINIDAD/TOBAGO");
    expect(transcontinental?.forcedFailures?.alcoholContent).toBeUndefined();
    expect(transcontinental?.forcedFailures?.netContents).toBeUndefined();
    expect(transcontinental?.metadata.packetPath).toContain("fixtures/public-cola-registry/records/19337001000251");
  });

  it("keeps domestic origin/state metadata out of country-of-origin review criteria", () => {
    const devilsBackbone = realColaFixtureSeeds.find((seed) => seed.id === "ttb-19346001000245");
    expect(devilsBackbone?.expected.brandName).toBe("DEVILS BACKBONE");
    expect(devilsBackbone?.expected.alcoholContent).toBe("7.5% ALC/VOL");
    expect(devilsBackbone?.expected.netContents).toBe("12 FL OZ (355ML)");
    expect(devilsBackbone?.expected.countryOfOrigin).toBeUndefined();
  });
});
