---
name: generate-media
description: "Use this skill whenever you need to generate or edit an image, or generate or extend a video. Route images to generate_or_edit_image and videos to generate_or_extend_video, with one bounded generation call and no cross-mode parameters. Trigger when the user asks to create, generate, edit, modify, or extend any image or video asset."
category: Data & Media
tags: image, video, generation, editing, gemini, veo
compatibility: Requires generate_or_edit_image or generate_or_extend_video and a Google AI BYOK key.
---

# Media generation

Choose exactly one tool from the requested output type:

- Static image generation, image references, or direct image editing: `generate_or_edit_image`
- Video generation from text or reference images, or video extension: `generate_or_extend_video`

The contracts are intentionally separate. Never add video fields to an image call, image-edit fields to a video call, or a synthetic `type` discriminator to either call.

## Image tool

`generate_or_edit_image` accepts:

| Parameter | Required | Description |
|---|---|---|
| `prompt` | Yes | Scene, subject, details, style, and constraints |
| `aspect_ratio` | No | `1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, or `21:9` |
| `reference_images` | No | Up to 8 real project paths or public HTTPS URLs |
| `image_reference_mode` | No | `reference_generate` for inspiration/composition, or `edit` to transform the supplied image directly |

With no references, provide only the prompt and intentional aspect ratio. For an edit, state what changes and what must remain invariant.

```yaml
prompt: "Change only the blue sofa to vintage brown leather. Preserve the room, lighting, perspective, and every other object."
aspect_ratio: "4:3"
reference_images:
  - "/workspace/project/living-room.png"
image_reference_mode: "edit"
```

## Video tool

`generate_or_extend_video` accepts:

| Parameter | Required | Description |
|---|---|---|
| `prompt` | Yes | Subject, action, visual style, camera motion, and audio cues |
| `aspect_ratio` | No | `16:9` or `9:16` |
| `duration` | No | `4`, `6`, or `8` seconds |
| `reference_images` | No | Up to 3 real project paths or public HTTPS URLs |
| `reference_video` | No | The exact `sandboxPath` from an earlier video result, or a public HTTPS URL |

`reference_images` and `reference_video` are mutually exclusive. Never invent a reference path, operation ID, or URL.

```yaml
prompt: "A cinematic tracking shot of a cyclist crossing a rain-soaked city street at night, neon reflections, slow dolly forward, distant traffic and rainfall."
aspect_ratio: "16:9"
duration: 8
```

For extension, copy the exact `sandboxPath` returned by the earlier `generate_or_extend_video` result:

```yaml
prompt: "The butterfly lands on an orange flower as the camera slowly pushes in. Preserve the established visual style and ambience."
reference_video: ".cheatcode/assets/videos/butterfly-50ad8b35.mp4"
duration: 8
```

## Prompt construction

Order prompts as: **scene and backdrop → subject → action or key details → style and camera → constraints**.

- For photographs, name lighting, framing, lens feel, material detail, and depth of field.
- For illustrations, name the art style, palette, line quality, shading, and background.
- For product visuals, name the material, camera angle, lighting setup, and whether text, logos, or watermarks are allowed.
- For rendered text, provide the exact copy, typography direction, and placement.
- For video, include action, camera movement, pacing, dialogue in quotes, sound effects, and ambience.
- Prefer concrete positive descriptions. State edit invariants explicitly.

## Execution contract

1. Call the selected generation tool once with only its supported fields.
2. If the tool reports a field-level validation issue, correct that specific field once.
3. If the provider rejects, times out, or fails the request, explain the provider failure. Do not resubmit the same request repeatedly.
4. Do not substitute a hand-authored SVG, canvas drawing, placeholder, or unrelated asset unless the user explicitly requests that output.
5. A successful result is already published, shown in chat, and available in Files. Refer to the finished asset naturally; do not open its sandbox path in the browser or publish it again.

## Aspect-ratio guide

| Use case | Ratio |
|---|---|
| Square post, avatar, icon | `1:1` |
| Story or mobile portrait | `9:16` |
| Desktop hero or landscape video | `16:9` |
| Portrait product photo | `4:5` or `3:4` |
| Ultra-wide banner | `21:9` |
| Standard landscape photo | `3:2` |
