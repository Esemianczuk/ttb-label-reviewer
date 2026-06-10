# TTB COLA Sheet OCR Test Report

This report covers the twelve synthetic TTB/COLA-style sheets in `/home/eric/DocumentsFAST/Take_Home_Project`. The source files were renamed to stable product names and copied into `public/label-packets/` for browser OCR testing and the fixture-backed sample queue.

## Source File Mapping

| Product | Renamed source file | Sample packet id |
| --- | --- | --- |
| Hollow Ridge Kentucky Straight Bourbon Whiskey | `hollow-ridge-bourbon-cola-sheet.png` | `hollow-ridge-bourbon` |
| Highland Coast Lightkeeper Gin | `highland-coast-lightkeeper-gin-cola-sheet.png` | `highland-coast-lightkeeper-gin` |
| Tideline California Small Batch Gin | `tideline-california-gin-cola-sheet.png` | `tideline-california-gin` |
| Riverlight Kentucky Straight Rye Whiskey | `riverlight-rye-whiskey-cola-sheet.png` | `riverlight-rye-whiskey` |
| Sundaze Watermelon Hard Seltzer | `sundaze-hard-seltzer-cola-sheet.png` | `sundaze-hard-seltzer` |
| Horizon Point Sunset Reserve Bourbon | `horizon-point-sunset-reserve-bourbon-cola-sheet.png` | `horizon-point-sunset-reserve` |
| Sunburst Social Peach Lime Fizz | `sunburst-social-peach-lime-fizz-cola-sheet.png` | `sunburst-social-peach-lime-fizz` |
| Lumin8 Blue Raspberry Vodka Beverage | `lumin8-blue-raspberry-cola-sheet.png` | `lumin8-blue-raspberry` |
| Arbor Hill Cabernet Sauvignon | `arbor-hill-cabernet-sauvignon-cola-sheet.png` | `arbor-hill-cabernet-sauvignon` |
| Northern Lights Vodka | `northern-lights-vodka-cola-sheet.png` | `northern-lights-vodka` |
| High Tide Pineapple Passionfruit | `high-tide-pineapple-passionfruit-cola-sheet.png` | `high-tide-pineapple-passionfruit` |
| Estrella Tequila Blanco | `estrella-tequila-blanco-cola-sheet.png` | `estrella-tequila-blanco` |

## Expected Field Analysis

| Product | Brand | Class/type | Alcohol | Net contents | Producer/applicant evidence |
| --- | --- | --- | --- | --- | --- |
| Hollow Ridge | HOLLOW RIDGE | Kentucky Straight Bourbon Whiskey | 45% ALC/VOL (90 PROOF) | 750 mL | Sunset Ridge Spirits, LLC |
| Highland Coast | HIGHLAND COAST | Distilled Spirits Specialty | 47% ALC/VOL (94 PROOF) | 750 mL | Highland Coast Distilling Co. |
| Tideline | TIDELINE | California Small Batch Gin | 47% ALC/VOL (94 PROOF) | 750 mL | Coastal Point Distilling Co. |
| Riverlight | RIVERLIGHT | Kentucky Straight Rye Whiskey | 50% ALC/VOL (100 PROOF) | 750 mL | Bluewater Distilling Company, LLC |
| Sundaze | SUNDAZE | Hard Seltzer | 5% ALC/VOL | 12 FL. OZ. (355 mL) | Coastal Beverages, Inc. |
| Horizon Point | HORIZON POINT | Kentucky Straight Bourbon Whiskey | 45% ALC/VOL (90 PROOF) | 750 mL | Horizon Point Distilling Co. |
| Sunburst Social | SUNBURST SOCIAL | Distilled Spirits Specialty | 5% ALC/VOL | 355 mL (12 FL OZ) | Sunburst Social Spirits Co. |
| Lumin8 | LUMIN8 | Ready-to-Drink Vodka Beverage | 7% ALC/VOL | 355 mL (12 FL. OZ.) | VibeCraft Beverages, LLC |
| Arbor Hill | ARBOR HILL | Cabernet Sauvignon | 14.5% ALC/VOL | 750 mL | Arbor Hill Wine Company, LLC |
| Northern Lights | NORTHERN LIGHTS | Vodka | 40% ALC/VOL (80 PROOF) | 750 mL | Northern Lights Distilling Co., LLC |
| High Tide | HIGH TIDE | Spiked Sparkling Water | 4.5% ALC/VOL | 12 FL. OZ. (355 mL) | High Tide Spirits, LLC |
| Estrella | ESTRELLA | Tequila Blanco | 40% ALC/VOL (80 PROOF) | 750 mL | Estrella Spirits Company |

All twelve sheets visibly include a government warning. Horizon Point, Sunburst Social, Northern Lights, and Estrella also include country-of-origin evidence in the expected data and OCR fixtures.

## Browser OCR Baseline

Engine: Tesseract.js 7, English LSTM model, reusable browser-style worker.

Crop preset:

| Variant | Purpose |
| --- | --- |
| `application-top` | Top form fields, needed for alternate sheet layouts |
| `product-info` | Product field table |
| `application-left` | Applicant and certification summary |
| `label-area` | Main label artwork area |
| `lower-label-strip` | Back, carton, neck, and lower panels |
| `warning-right` | Common right-side warning area |
| `warning-lower-middle` | Horizon-style lower warning area |
| `warning-seltzer-back` | Sundaze can-back warning area |

Node baseline using the same Tesseract settings for the original six COLA sheets:

| Packet | Runtime | Overall | Notes |
| --- | ---: | --- | --- |
| `hollow-ridge-bourbon` | 4027 ms | PASS | All required fields passed |
| `highland-coast-lightkeeper-gin` | 4495 ms | PASS | All required fields passed |
| `tideline-california-gin` | 3631 ms | NEEDS_REVIEW | Government warning heading and evidence found, small legal text not fully confident |
| `riverlight-rye-whiskey` | 4324 ms | PASS | All required fields passed |
| `sundaze-hard-seltzer` | 3599 ms | NEEDS_REVIEW | Core fields passed, small can warning needs review |
| `horizon-point-sunset-reserve` | 3551 ms | PASS | Includes country of origin match |

The target is under five seconds per image after the Tesseract worker and language data are available. First page load may take longer while the browser downloads and caches OCR assets.

## Fixture Policy

Each packet includes an OCR fixture for deterministic unit tests. The manifest sets `useFixtureByDefault: true` for the sample queue so the UI processes each application immediately, like a database-backed review queue. Uploaded images still run live browser OCR.
