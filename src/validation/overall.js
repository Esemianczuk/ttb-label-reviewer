import { FIELD_LABELS } from '../app-state.js';
import { combineOcrResults } from '../ocr/ocr-types.js';
import { validateAlcohol } from './alcohol.js';
import { validateBrand } from './brand.js';
import { validateClassType } from './class-type.js';
import { validateGovernmentWarning } from './government-warning.js';
import { validateNetContents } from './net-contents.js';
import { validateOptionalTextField } from './optional-fields.js';
import { STATUS } from './status.js';

export function computeOverallStatus(fields) {
  const hasCriticalFail = fields.some((field) => field.severity === 'critical' && [STATUS.FAIL, STATUS.NOT_FOUND].includes(field.status));
  if (hasCriticalFail) return STATUS.FAIL;
  if (fields.some((field) => field.status === STATUS.NEEDS_REVIEW || field.status === STATUS.NOT_FOUND)) return STATUS.NEEDS_REVIEW;
  if (fields.some((field) => field.status === STATUS.WARNING)) return STATUS.PASS_WITH_WARNINGS;
  return STATUS.PASS;
}

export function validateLabelPacket(expected, imageResults) {
  const combinedOcr = combineOcrResults(
    imageResults.map((result, imageIndex) => ({
      ...result.ocrResult,
      blocks: (result.ocrResult?.blocks || []).map((block) => ({
        ...block,
        imageId: result.id,
        imageName: result.name,
        imageUrl: result.url,
        imageIndex,
      })),
    })),
  );
  const fields = [
    validateBrand(expected.brandName, combinedOcr),
    validateClassType(expected.classType, combinedOcr),
    validateAlcohol(expected.alcoholContent, combinedOcr),
    validateNetContents(expected.netContents, combinedOcr),
    validateGovernmentWarning(expected.governmentWarningRequired, combinedOcr),
  ];

  const optionalFields = [
    validateOptionalTextField(FIELD_LABELS.producerName, expected.producerName, combinedOcr),
    validateOptionalTextField(FIELD_LABELS.countryOfOrigin, expected.countryOfOrigin, combinedOcr, {
      passThreshold: 0.82,
      reviewThreshold: 0.62,
    }),
  ].filter(Boolean);

  const allFields = [...fields, ...optionalFields];
  return {
    overallStatus: computeOverallStatus(allFields),
    fields: allFields,
    combinedOcr,
    files: imageResults,
  };
}
