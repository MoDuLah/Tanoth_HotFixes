# Tanoth Weapon Rendering & Audio Hotfix

Version 1.2.0 extends the existing Firefox-oriented weapon rendering hotfix. It preserves the direction, rotation, reference-point fallback, adjustable lift, and warning behaviour from version 1.1.0 while adding narrowly scoped audio corrections.

## What it fixes

- Missing or invalid weapon direction, angle, and reference-point metadata no longer crashes the battle renderer.
- `unique186` (Heartforge Hammer) now uses Tanoth's existing `combat_hit_mace` family instead of the generic hit family.
- Dragging Heartforge Hammer uses the existing `item_metall` equipment sound.
- Empty, unregistered, or unresolved sound assets are skipped before Tanoth can call `.play()` on `null`.
- Player and opponent attacks use the same exact override rules; blocked attacks still use `combat_block`.

The script does not download replacement audio, rewrite MP3 URLs, change generic sword sounds, or bypass Tanoth's volume and mute settings.

## Installation

Install `Tanoth-WeaponHotfix-1.2.0.user.js` in a userscript manager that supports page-context execution. The script must run at `document-start` with `@sandbox raw`, as configured in its metadata.

Firefox desktop is the primary target. Firefox Mobile compatibility depends on the userscript manager providing the same raw page context and early execution guarantees.

## How the audio patch works

Tanoth's Haxe-generated classes live inside the generated client closure rather than on `window`. During Lime's synchronous startup, the hotfix briefly observes five exact `$hxClasses` registry keys, restores `Object.prototype` immediately, and then patches the captured prototypes.

Combat overrides are defined in `WEAPON_SOUND_OVERRIDES` and require both an exact weapon type and an exact ID:

```javascript
const WEAPON_SOUND_OVERRIDES = {
  unique: {
    186: "combat_hit_mace",
  },
  normal: {},
};
```

Add future mappings to the appropriate `unique` or `normal` bucket. Valid families are `combat_hit`, `combat_hit_axe`, `combat_hit_mace`, `combat_bite`, and `combat_crit`. Tanoth's original `getWeaponSoundId()` still selects the numbered variation.

Equipment sounds are separate. `getDragObjectSound()` receives the inventory item's underlying `itemcode`, which can differ from a displayed image when `asset_override` is present. Therefore, an equipment mapping must be added only after the itemcode is verified. Workspace observations verify Heartforge Hammer as unique `itemcode 186`, so its exact `item_metall` mapping is enabled in `EQUIPMENT_SOUND_OVERRIDES`.

## Diagnostics

Audio diagnostics are off by default. In the Firefox developer console:

```javascript
window.TanothWeaponHotfix.setAudioDebug(true);
window.TanothWeaponHotfix.audioDiagnostics;
```

Disable them again with:

```javascript
window.TanothWeaponHotfix.setAudioDebug(false);
```

Debug records include the weapon ID/type, actor, original and overridden family, selected sound identifier, unresolved assets, and installation status. Repeated missing-asset warnings are deduplicated, and only the latest 100 records are retained. Authentication and session data are never logged.

Existing animation controls remain available:

```javascript
window.TanothWeaponHotfix.status;
window.TanothWeaponHotfix.warnings;
window.TanothWeaponHotfix.setLift(32, "both");
```

## Automated tests

The tests use Node's built-in test runner and a small simulated Haxe/Lime environment:

```powershell
npm test
```

No third-party packages are required.

## Manual Firefox checklist

1. Install version 1.2.0 and reload Tanoth completely.
2. Confirm `window.TanothWeaponHotfix.status` is `active` and both patch flags are `true`.
3. Enable audio diagnostics and start battles with Heartforge Hammer on the player.
4. Confirm player hits select `combat_hit_mace1`, `combat_hit_mace2`, or `combat_hit_mace3`.
5. Fight an opponent displaying `unique186.png` and confirm the opponent also uses the mace family.
6. Confirm blocked player and opponent attacks still play `combat_block`.
7. Drag Heartforge Hammer and confirm it uses `item_metall` without duplicate playback.
8. Set sound effects volume to zero and confirm the hotfix does not produce audio.
9. Exercise another unique weapon plus a known axe and mace; confirm their original sounds are unchanged.
10. Confirm the original missing-reference-point weapon renders at the expected lifted position.
11. Repeat on Firefox Mobile only if the installed userscript manager supports `@sandbox raw` at `document-start`.

## Known limitations

- The patch depends on exact generated Haxe class and method names. It fails safely and reports partial/inactive status if a future client changes them.
- Static and automated checks cannot prove browser userscript timing, real asset availability, or audible output. Complete the Firefox checklist before claiming live compatibility.
- `references/TanothHtml5.js` is read-only analysis material. It is excluded from version control and must never be bundled or redistributed with the userscript.
