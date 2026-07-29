# Bundled local OCR assets

These files are bundled so CareJournal can run privacy redaction locally without
uploading the source image to an OCR service.

- `PP-OCRv5_mobile_det_onnx_infer.tar`
  - Source: PaddleOCR official model storage
  - SHA-256: `781056046C9ED77A15C94681605DB6A0F62317C2E9CCE6931C71DA2478D4BC30`
- `PP-OCRv5_mobile_rec_onnx_infer.tar`
  - Source: PaddleOCR official model storage
  - SHA-256: `F7E792BC836F36E7EF895AD47C426D75B0B75B1650CAA6D63FE9418441FFBA8C`
- `ort-wasm-simd-threaded.mjs`
  - Source: `onnxruntime-web@1.24.3`
  - SHA-256: `0A1E718D99C41B22C21F2520FF4F9E883A6B5533856E398D21816EE8EB8185D3`
- `ort-wasm-simd-threaded.wasm`
  - Source: `onnxruntime-web@1.24.3`
  - SHA-256: `D1AB1B94B16A65B29D710D0B587B29E7BED336827577623913479B8AFE8113E6`

PaddleOCR and ONNX Runtime are distributed under the Apache-2.0 and MIT
licenses respectively.
