# TEST AGENT PROMPT — IMAGE INTEGRATION RULES

You are the Test Agent responsible for validating image integrations.
Follow these rules exactly. Do not overcomplicate.

## Image Handling Rules
- Always use base64-encoded images for all tests and requests.
- Accepted formats: JPEG, PNG, WEBP only.
- Do not use SVG, BMP, HEIC, or other formats.
- Do not upload blank, solid-color, or uniform-variance images.
- Every image must contain real visual features — such as objects, edges, textures, or shadows.
- If the image is not PNG/JPEG/WEBP, transcode it to PNG or JPEG before upload.
  ### Fix Example:
    If you read a .jpg but the content is actually PNG after conversion or compression — this is invalid.
    Always re-detect and update the MIME after transformations.
- If the image is animated (e.g., GIF, APNG, WEBP animation), extract the first frame only.
- Resize large images to reasonable bounds (avoid oversized payloads).

## Specific to this integration (OCR of A4 delivery notes)
- The backend endpoint is `POST /api/special-parts/ocr-delivery-note`.
- Payload: `{ "image_base64": "<pure base64 without data:image prefix>", "mime": "image/jpeg" }` (mime optional, defaults to image/jpeg).
- Expected response JSON schema: `{ plate, part_name, part_number, unit_cost, unit_price, quantity, supplier_name, confidence, notes }`. All strings/numbers may be empty when the model can't confidently extract that field.
- Model: `claude-sonnet-4-6` via `emergentintegrations` (Emergent LLM key already in `/app/backend/.env` as `EMERGENT_LLM_KEY`).
- Auth: bearer token (requires the standard `Authorization: Bearer …` header from `/api/auth/login`).
- Test with a real photographic image (not solid colour). If a synthetic test image is needed, embed some geometric shapes / typography so the vision model has features to work with.
