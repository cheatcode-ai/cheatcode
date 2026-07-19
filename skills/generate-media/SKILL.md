---
name: generate-media
description: "Use this skill whenever you need to generate or edit images, or generate or extend videos using the generate_or_edit_media tool. Covers prompt engineering, parameter selection, reference image usage, and video generation/extension. Trigger when the user asks to create, generate, edit, modify, or extend any image or video asset."
category: Data & Media
tags: image, video, generation, editing, gemini, veo
compatibility: Requires the generate_or_edit_media tool and a Google BYOK key.
---

# generate_or_edit_media Tool Guide

## Tool Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | `"image"` or `"video"` | Yes | Whether to generate an image or video |
| `prompt` | string (min 3 chars) | Yes | The generation/edit prompt |
| `reference_images` | string[] (max 8) | No | Paths or URLs to reference images. Mutually exclusive with `reference_video` |
| `image_reference_mode` | `"reference_generate"` or `"edit"` | No | Image-only. `reference_generate` (default) creates a new image inspired by references. `edit` directly transforms a referenced image |
| `reference_video` | string | No | Video extension only. Use the **real** `sandboxPath` from a prior generate_or_edit_media video result (e.g. `.cheatcode/assets/videos/...mp4`), or an HTTPS URL to that file. Mutually exclusive with `reference_images` |
| `aspect_ratio` | string | No | Image: `1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, `21:9`. Video: `16:9` (default) or `9:16` |
| `duration` | `4`, `6`, or `8` | No | Video only. Length in seconds |

## Underlying Models

- **Images**: Gemini 3.1 Flash Image (`gemini-3.1-flash-image`)
- **Videos**: Veo 3.1 (`veo-3.1-generate-preview`) — generates at 1080p with native audio

## Decision Tree

### 1. Image or video?

- Static visual asset → `type: "image"`
- Motion, animation, cinematic clip, anything with audio → `type: "video"`

### 2. Generate or edit?

- **No reference images** → Pure generation (just `prompt`)
- **Reference images for style/mood/composition guidance** → Set `reference_images`, leave `image_reference_mode` unset (defaults to `reference_generate`)
- **Directly transforming an existing image** (inpainting, object removal, style transfer on the image itself) → Set `reference_images` + `image_reference_mode: "edit"`
- **Extending a prior generated video** → Set `reference_video` to the prior result's `sandboxPath` (under `.cheatcode/assets/videos/`). Do NOT combine with `reference_images`

### 3. Aspect ratio

Pick the ratio that fits the intended use:

| Use case | Recommended ratio |
|----------|-------------------|
| Square social post, avatar, icon | `1:1` |
| Instagram story, mobile portrait video | `9:16` |
| YouTube thumbnail, desktop hero, landscape video | `16:9` |
| Product photo (portrait) | `4:5` or `3:4` |
| Ultra-wide banner | `21:9` |
| Standard photo landscape | `3:2` |

## Writing Effective Prompts

### Prompt Structure

Order your prompt: **scene/backdrop → subject → key details → style → constraints**.

### For Photorealistic Images

Use photography language: camera angles, lens types, lighting, and fine details.

```
A photorealistic close-up portrait of an elderly Japanese ceramicist in a
dimly lit workshop, hands shaping wet clay on a pottery wheel. Warm side
lighting from a single window, shallow depth of field with a 85mm f/1.4
lens. Weathered hands with clay residue, focused expression. 3:2 landscape.
```

### For Stylized Illustrations and Stickers

Be explicit about the art style and background.

```
A kawaii-style sticker of a happy red panda holding a bubble tea, pastel
color palette with soft pink and mint green, clean bold outlines, flat
shading, white background.
```

### For Text in Images

Gemini excels at rendering text. Be explicit about the text content, style, and placement. For tricky words, spell them letter-by-letter.

```
Create a modern minimalist logo for a coffee shop with the text "The Daily
Grind" in a clean sans-serif font. Earthy brown and cream color scheme,
centered composition on white background.
```

### For Product Mockups

Describe the product, materials, lighting setup, and camera angle.

```
A high-resolution studio-lit product photograph of a minimalist ceramic
coffee mug on a light marble surface. Three-point softbox lighting for even
illumination, slight three-quarter angle, ultra-realistic with sharp focus
on the matte texture. No logos, no text, no watermark.
```

### For Video Prompts

Include subject, action, style, camera motion, and audio cues.

```
A cinematic tracking shot of a woman walking through a rain-soaked Tokyo
street at night, neon reflections on wet pavement. She opens an umbrella as
thunder rumbles in the distance. Slow dolly forward, shallow depth of field,
moody blue-orange color grading.
```

### Prompting for Video Audio

Veo 3.1 natively generates audio. Provide cues for dialogue, sound effects, and ambiance:

- **Dialogue**: Use quotes. `"This must be the key," he murmured.`
- **Sound effects**: Describe explicitly. `Tires screeching loudly, engine roaring.`
- **Ambient noise**: Describe the soundscape. `A faint hum resonates in the background, birds chirping.`

## Editing Images

### Adding/Removing Elements

Provide the image via `reference_images` and set `image_reference_mode: "edit"`.

```
prompt: "Using the provided image, add a small knitted wizard hat on the cat's head. Match the original lighting and style."
reference_images: ["/path/to/cat-photo.png"]
image_reference_mode: "edit"
```

### Inpainting (Semantic Masking)

Conversationally define a mask — no explicit mask file needed.

```
prompt: "Change only the blue sofa to a vintage brown leather chesterfield sofa. Keep everything else exactly the same."
reference_images: ["/path/to/living-room.png"]
image_reference_mode: "edit"
```

### Style Transfer

Provide the style reference and describe the transformation.

```
prompt: "Transform this photograph into a watercolor painting style. Preserve the original composition but render with visible brushstrokes and soft color bleeding."
reference_images: ["/path/to/photo.jpg"]
image_reference_mode: "edit"
```

### Compositing Multiple Images

Provide multiple references and describe how they combine.

```
prompt: "Create a professional e-commerce fashion photo. Place the dress from the first image on the model from the second image. Match lighting and perspective."
reference_images: ["/path/to/dress.png", "/path/to/model.png"]
image_reference_mode: "reference_generate"
```

## Video-Specific Features

### Image-to-Video

Generate an image first, then use it as the starting frame.

```
type: "video"
prompt: "Panning wide shot of this calico kitten waking up and stretching in warm sunshine"
reference_images: ["/path/to/kitten-image.png"]
```

### Video Extension

Extend a video you already generated with this tool. Copy `sandboxPath` from that run's JSON output — do **not** invent or guess a URI.

```
type: "video"
prompt: "The butterfly lands gently on an orange flower as a puppy runs up"
reference_video: ".cheatcode/assets/videos/a-fluffy-orange-tabby-cat-sitting-on-a-sunny-win-50ad8b35.mp4"
duration: 8
```

Where to get `reference_video`:
- **Always prefer** the `sandboxPath` field from the previous generate_or_edit_media result (paths look like `.cheatcode/assets/videos/<slug>-<hash>.mp4`).
- A public **HTTPS URL** to the same file also works when you have one.
- **Do not** use placeholder examples, Vertex operation IDs, or `projects/.../operations/...` strings unless that exact value was returned by a prior tool call on your stack.

Constraints for video extension:
- Source must be a video this tool (or a compatible prior generation) already produced — not an arbitrary upload unless readable at the path/URL you provide
- Maximum input length: 141 seconds
- Cannot combine `reference_video` with `reference_images`

### Reference Images for Video

Veo supports up to 3 reference images to guide video content (character appearance, product identity).

```
type: "video"
prompt: "A woman in a flamingo feather dress walks through shallow turquoise lagoon water. Cinematic, dreamlike atmosphere."
reference_images: ["/path/to/dress.png", "/path/to/woman.png", "/path/to/sunglasses.png"]
```

**Important**: Video reference images are capped at 3 (unlike images which allow up to 8).

## Best Practices

1. **Be specific over generic**: Instead of "fantasy armor," write "ornate elven plate armor, etched with silver leaf patterns, with a high collar and pauldrons shaped like falcon wings."
2. **State intent**: "Create a logo for a high-end minimalist skincare brand" beats "Create a logo."
3. **Iterate with single changes**: Don't rewrite the whole prompt. Follow up with "Keep everything the same, but make the lighting warmer."
4. **Use step-by-step for complex scenes**: "First, a misty forest at dawn. Then, a moss-covered stone altar in the foreground. Finally, a glowing sword on the altar."
5. **Positive framing over negation**: Instead of "no cars," write "an empty, deserted street with no signs of traffic."
6. **Camera language for composition**: Use terms like `wide-angle shot`, `macro shot`, `low-angle perspective`, `dolly shot`, `aerial view`.
7. **For edits, state invariants explicitly**: "Change only the background; keep the product, edges, and shadows unchanged."
8. **Re-state invariants on each iteration**: Gemini can drift on follow-ups; repeat what must stay the same.

## Common Mistakes

- Setting `image_reference_mode: "edit"` when you just want style inspiration (use default `reference_generate` instead)
- Providing `reference_images` alongside `reference_video` (mutually exclusive)
- Using placeholder or made-up `reference_video` values (e.g. `projects/xxx/.../operations/xxx`) instead of the actual `sandboxPath` from the last video result
- Pointing `reference_video` at a path that does not exist in the sandbox (read the path from the tool output; do not fabricate it)
- Providing too many references for video (max 3 for video, max 8 for images)
- Using `duration` for image generation (video-only parameter)
- Forgetting to specify `type` — always required
