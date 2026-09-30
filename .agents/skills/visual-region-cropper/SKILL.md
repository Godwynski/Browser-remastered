---
name: visual-region-cropper
description: Targeted bounding-box screenshot capture and visual verification with 85%+ visual token savings. Captures only the target element or coordinates instead of full-screen images.
---

# Visual Region Cropper Skill

Use this skill when you need visual verification (charts, captchas, confirmation cards, canvas elements, badges) but want to minimize multimodal context consumption.

> [!TIP]
> **85%–95% Visual Token Reduction**: A full-screen 1080p screenshot consumes ~1,500–2,000 visual tokens. A cropped screenshot of a single element consumes only ~100–200 tokens and processes 3x faster.

---

## 🚀 Key Advantages
- **Drastic Token Savings**: Only encodes the pixels relevant to the question.
- **Fast Visual Grounding**: Eliminates visual noise from browser toolbars, sidebars, and background banners.
- **Artifact Persistence**: Automatically saves JPEG artifacts in `artifacts/screenshots/` for human review or multi-turn caching.

---

## 🛠️ Usage via `brave_workflow`

Invoke the compiled workflow script `crop-screenshot` via `brave_workflow`:

### 1. Crop by CSS Selector
```json
{
  "action": "run_script",
  "scriptName": "crop-screenshot",
  "params": {
    "selector": ".confirmation-card, #captcha-image, canvas#price-chart",
    "quality": 75
  }
}
```

### 2. Crop by Coordinate Clip
```json
{
  "action": "run_script",
  "scriptName": "crop-screenshot",
  "params": {
    "clip": { "x": 100, "y": 200, "width": 400, "height": 300 }
  }
}
```

### Options
| Parameter | Description | Default |
| :--- | :--- | :--- |
| `selector` | CSS selector of target element to crop | Optional |
| `clip` | Bounding box object `{ x, y, width, height }` | Optional |
| `quality` | JPEG image compression quality (1-100) | `75` |
| `saveToFile` | Whether to persist image in `artifacts/screenshots/` | `true` |
