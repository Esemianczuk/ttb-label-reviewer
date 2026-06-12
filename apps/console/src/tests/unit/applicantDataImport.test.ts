import { describe, expect, it } from "vitest";
import { importApplicantDataFile, valuesFromApplicantData } from "../../pages/applicant/applicantUtils";

describe("applicant application data import", () => {
  it("extracts public COLA registry JSON into applicant fields and flags missing required values", async () => {
    const file = new File(
      [
        JSON.stringify({
          source: { system: "TTB Public COLA Registry" },
          ttb_id: "19337001000251",
          serial_number: "191918",
          applicant_name: "Public Registry Applicant",
          application: {
            brand_name: "TRANSCONTINENTAL",
            fanciful_name: "RUM LINE",
            class_type: "OTHER FOREIGN RUM",
            origin: "TRINIDAD/TOBAGO"
          },
          raw_fields: [
            { label: "Brand Name", value: "TRANSCONTINENTAL" },
            { label: "Fanciful Name", value: "RUM LINE" },
            { label: "Class/Type Code", value: "OTHER FOREIGN RUM" },
            { label: "Origin Code", value: "TRINIDAD/TOBAGO" }
          ]
        })
      ],
      "metadata.json",
      { type: "application/json" }
    );

    const result = await importApplicantDataFile(file);
    expect(result.values).toMatchObject({
      brandName: "TRANSCONTINENTAL",
      fancifulName: "RUM LINE",
      classType: "OTHER FOREIGN RUM",
      productType: "distilled_spirits",
      applicationId: "19337001000251",
      labelId: "191918",
      submitter: "Public Registry Applicant"
    });
    expect(result.attentionFields).toEqual(["alcoholContent", "netContents"]);
  });

  it("extracts label/value text from printable forms", () => {
    const values = valuesFromApplicantData(
      "printable_cola.html",
      `
        <table>
          <tr><td>Brand Name</td><td>DEVILS BACKBONE</td></tr>
          <tr><td>Class/Type Code</td><td>BEER</td></tr>
          <tr><td>Alcohol Content</td><td>5.2% ALC/VOL</td></tr>
          <tr><td>Net Contents</td><td>12 FL OZ</td></tr>
          <tr><td>Serial #</td><td>20001</td></tr>
        </table>
      `
    );

    expect(values).toMatchObject({
      brandName: "DEVILS BACKBONE",
      classType: "BEER",
      alcoholContent: "5.2% ALC/VOL",
      netContents: "12 FL OZ",
      productType: "malt_beverage",
      labelId: "20001"
    });
  });
});
