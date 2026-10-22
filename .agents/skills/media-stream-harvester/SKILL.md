---
name: media-stream-harvester
description: Direct extraction of streaming media URLs (m3u8, mp4, audio), high-resolution images, and downloadable documents with zero token overhead.
---

# Media & Stream Harvester Skill

Use this skill when you need to download or extract direct media URLs (videos, audio, HLS m3u8 streaming manifests, high-res images, PDF documents) from any webpage without clicking through media players or UI wrappers.

---

## 🚀 Key Advantages

- **Bypasses UI Wrappers**: Directly discovers hidden `<video>`, `<source>`, and HLS `.m3u8` manifests.
- **Zero Token Overhead**: Discovers all media URLs via browser JavaScript evaluation in 1 turn.
- **Filters Unwanted Assets**: Ignores UI tracking pixels and tiny icons, focusing on actual content.

---

## 🛠️ Usage via `brave_workflow`

Invoke the compiled workflow script `media-harvester` via `brave_workflow`:

```json
{
  "action": "run_script",
  "scriptName": "media-harvester",
  "params": {
    "filterType": "video",
    "maxResults": 20
  }
}
```

### Options

| Parameter | Description | Default |
| :--- | :--- | :--- |
| `filterType` | Filter media type: `all`, `video`, `audio`, `image`, `document` | `all` |
| `maxResults` | Maximum items to return | `50` |
