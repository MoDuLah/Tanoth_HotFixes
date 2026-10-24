# Implementation report

The hotfix was advanced from 1.1.0 to 1.2.0 without creating a second independent userscript.

## Technique

The existing Lime startup interception remains in place. Its temporary class-registry capture was expanded from `Point` and `BattleGround` to also capture `SoundController`, `openfl.utils.Assets`, and `SoundTransform` from the generated Haxe closure. The interception is limited to those exact keys and is removed in a `finally` block before normal gameplay continues.

`SoundController.getWeaponSoundPrefix()` is wrapped so that the original result is calculated first and only an exact type-and-ID override can replace it. `getWeaponSoundId()` remains the source of numbered variations. `SoundController.play()` now performs the same volume-aware playback using a captured `SoundTransform`, but only after validating the requested ID, `libPaths` entry, and resolved asset.

BattleGround's player/opponent load and attack methods are wrapped only to carry diagnostic actor context. Their original control flow, including the separate `combat_block` branch, is unchanged. All wrappers carry stable markers, and repeat installation reuses them.

The reference client proves that displayed images may be changed with `asset_override`, so image ID alone is not a safe equipment key. Separate workspace observations identify Heartforge Hammer as an actual unique item with `itemcode 186`; that evidence supports the exact `item_metall` equipment mapping.

## Files

- `Tanoth-WeaponHotfix-1.2.0.user.js`: integrated rendering and audio hotfix.
- `tests/tanoth-weapon-hotfix.test.js`: isolated class-capture and runtime tests.
- `README.md`: configuration, diagnostics, limitations, and Firefox checklist.
- `.gitignore`: excludes the read-only reference client and common test output.
- `package.json`: dependency-free test command.

## Verification scope

Automated tests cover combat overrides, original classifications, both actors, block sound preservation, variations, missing assets, mute handling, equipment resolution, idempotence, and the existing animation fallback. Static syntax validation is also run.

Audible playback, real Gameforge asset registration, and Firefox/Firefox Mobile userscript timing still require the documented manual browser checklist.
