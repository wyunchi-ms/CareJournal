# CareJournal app icon system

`care-journal-foreground-v2.png` is the single high-resolution artwork source, refined with ImageGen and stored with transparency. Do not generate one platform's icon from another platform's already-resized output.

Run from the repository root:

```powershell
npm run icons:generate
```

The generator writes:

- Android adaptive foregrounds and legacy square/round icons for all five density buckets;
- a 512 px HarmonyOS icon;
- an opaque 1024 px iOS App Store icon without a pre-applied corner mask;
- explicitly named 32, 128, 256, and 512 px desktop PNG assets, plus a Windows ICO whose 16–256 px frames are rendered independently (256 px is the ICO format maximum used by Windows).

Windows frames from 16–48 px use a dedicated high-contrast ECG glyph drawn directly on each final pixel grid. The critical 16–32 px frames contain only three exact RGBA colors and no resampling or antialias transition pixels; a restrained leaf accent appears only at 40/48 px. At that scale the journal outline, binding rings, gradients, and other hairline details are intentionally omitted. Frames from 64–256 px retain the complete artwork. Mobile artwork keeps a wider safe zone so launchers can apply their own masks without clipping the notebook or leaf.

The 48 px glyph is intentionally the first ICO directory entry. Tauri 2 decodes only `entries()[0]` for its runtime default window icon; Windows then downsamples that image into the 24 px taskbar slot. The remaining ICO frames are still available to the executable resource and Windows shell.
