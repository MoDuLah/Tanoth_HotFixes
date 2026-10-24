// ==UserScript==
// @name         Tanoth - Weapon Rendering Hotfix
// @namespace    modulah.github.io
// @version      1.2.0
// @description  Fixes missing weapon animation metadata, T5 weapon sound families, and unsafe Tanoth audio playback.
// @author       MoDuL
// @homepageURL  https://github.com/MoDuLah/Tanoth_HotFixes
// @supportURL   https://github.com/MoDuLah/Tanoth_HotFixes/issues
// @match        https://*.tanoth.gameforge.com/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @license      MIT
// ==/UserScript==

(() => {
  "use strict";

  const existing = window.TanothWeaponHotfix;
  if (existing && existing.__tanothWeaponHotfix === true) {
    if (typeof existing.reinstall === "function") existing.reinstall();
    return;
  }

  // This script MUST run in the webpage's JS world at document-start.
  // It hooks Lime's game startup and captures selected Haxe classes while
  // their private $hxClasses registry is populated. The prototypes are then
  // patched after class declarations finish, but before battles run.
  // No downloads, external scripts, server requests, or eval() are used.

  const VERSION = "1.2.0";
  const PREFIX = "[Tanoth Weapon Hotfix]";
  const AUDIO_PREFIX = "[Tanoth Hotfix][Audio]";
  const PATCH_MARKER = "__tanothWeaponHotfix120";
  const CLASS_NAMES = Object.freeze([
    "openfl.geom.Point",
    "openfl.media.SoundTransform",
    "openfl.utils.Assets",
    "de.gameforge.modules.battle.BattleGround",
    "de.gameforge.util.sound.SoundController",
  ]);

  // Combat mappings use the weapon ID parsed from the battle image filename.
  // A mapping is applied only when both its type bucket and exact ID match.
  const WEAPON_SOUND_OVERRIDES = Object.freeze({
    unique: Object.freeze({
      186: "combat_hit_mace",
    }),
    normal: Object.freeze({}),
  });

  // Equipment mappings use Item.item/itemcode, not the displayed image ID.
  // Workspace observations verify that Heartforge Hammer's itemcode is 186.
  const EQUIPMENT_SOUND_OVERRIDES = Object.freeze({
    unique: Object.freeze({
      186: "item_metall",
    }),
    normal: Object.freeze({}),
  });

  const COMBAT_SOUND_FAMILIES = new Set([
    "combat_hit",
    "combat_hit_axe",
    "combat_hit_mace",
    "combat_bite",
    "combat_crit",
  ]);
  const EQUIPMENT_SOUND_IDS = new Set([
    "item_cloth",
    "item_metall",
    "item_pickup",
    "item_potion",
    "item_ring",
    "item_sword",
  ]);

  const AUDIO_DEBUG_STORAGE = "modul.tanoth.weapon-hotfix.v1.2.audio-debug";
  const MAX_AUDIO_DIAGNOSTICS = 100;
  const hookedLimeObjects = new WeakSet();
  const taggedEmbedWrappers = new WeakSet();
  const warnedAudioIssues = new Set();
  const state = {
    status: "waiting for Lime startup",
    patched: false,
    animationPatched: false,
    audioPatched: false,
    captures: Object.create(null),
    warnings: [],
    audioDiagnostics: [],
    audioDebug: false,
    audioContext: null,
    audioWeapons: { Player: null, Opponent: null },
    embedDepth: 0,
    installAttempts: 0,
  };

  try {
    state.audioDebug =
      window.localStorage.getItem(AUDIO_DEBUG_STORAGE) === "true";
  } catch (_) {
    /* Private mode / denied storage: diagnostics remain disabled. */
  }

  // Original fallback reference point was (18, 118) / (56, 118).
  // Raise only weapons that are MISSING reference-point metadata.
  // Increasing RP.y moves the image UP because the game places its
  // picture container at -RP.y. Leave genuine RP values untouched.
  const BASE_RP_Y = 118;
  const DEFAULT_LIFT_PX = 32;
  const STORAGE_PREFIX = "modul.tanoth.weapon-hotfix.v1.1.lift.";
  const current = { pl: null, op: null };

  function loadLift(side) {
    try {
      const saved = window.localStorage.getItem(STORAGE_PREFIX + side);
      const value = saved === null ? NaN : Number(saved);
      if (Number.isFinite(value) && value >= -30 && value <= 120) {
        return Math.round(value);
      }
    } catch (_) {
      /* Private mode / denied storage: use default. */
    }
    return DEFAULT_LIFT_PX;
  }

  const lift = { pl: loadLift("pl"), op: loadLift("op") };

  function getMediaUrl(loader) {
    if (!loader) return "";
    // ch.sfug.net.MediaLoader is generated from Haxe. Its URL is exposed
    // through get_url(), not necessarily via a normal JS .url property.
    try {
      if (typeof loader.get_url === "function") {
        const url = loader.get_url();
        if (typeof url === "string") return url;
      }
    } catch (_) {
      /* Fall through. */
    }
    return typeof loader.url === "string" ? loader.url : "";
  }

  function setLift(pixels, which = "both") {
    const n = Number(pixels);
    if (!Number.isFinite(n) || n < -30 || n > 120) {
      throw new RangeError("Lift must be a number between -30 and 120 pixels.");
    }
    if (!["both", "player", "opponent", "pl", "op"].includes(which)) {
      throw new Error("Side must be player, opponent, or both.");
    }
    const value = Math.round(n);
    const sides =
      which === "both"
        ? ["pl", "op"]
        : [which === "player" ? "pl" : which === "opponent" ? "op" : which];
    for (const side of sides) {
      const delta = value - lift[side];
      lift[side] = value;
      const active = current[side];
      if (active && active.weapon && active.weapon.__tanothFallbackRP) {
        const { weapon } = active;
        const point = weapon.rp;
        if (point && Number.isFinite(point.y)) point.y += delta;
        const container =
          typeof weapon.getChildByName === "function"
            ? weapon.getChildByName("pic_container")
            : null;
        if (
          container &&
          typeof container.get_y === "function" &&
          typeof container.set_y === "function"
        ) {
          // Existing animation/tweens operate on the parent weapon;
          // move ONLY the image's local anchor, not the animation path.
          container.set_y(container.get_y() - delta);
        }
      }
      try {
        window.localStorage.setItem(STORAGE_PREFIX + side, String(value));
      } catch (_) {
        /* Live value still works without storage. */
      }
    }
    console.info(PREFIX, "Fallback anchor lift set (pixels):", { ...lift });
    return { player: lift.pl, opponent: lift.op };
  }

  function setAudioDebug(enabled) {
    state.audioDebug = Boolean(enabled);
    warnedAudioIssues.clear();
    try {
      window.localStorage.setItem(
        AUDIO_DEBUG_STORAGE,
        String(state.audioDebug),
      );
    } catch (_) {
      /* The live setting still works without storage. */
    }
    console.info(
      AUDIO_PREFIX,
      state.audioDebug ? "Diagnostics enabled." : "Diagnostics disabled.",
    );
    if (state.audioDebug) {
      addAudioDiagnostic({
        actor: "System",
        status: state.audioPatched
          ? "Audio patch installed"
          : `Audio patch not active (${state.status})`,
      });
    }
    return state.audioDebug;
  }

  function addAudioDiagnostic(detail, level = "info") {
    if (!state.audioDebug) return;
    const record = {
      timestamp: new Date().toISOString(),
      weapon: detail.weapon || "(not applicable)",
      actor: detail.actor || "Unknown",
      original: detail.original ?? "(none)",
      override: detail.override ?? detail.original ?? "(none)",
      selected: detail.selected ?? "(not selected)",
      status: detail.status || "OK",
    };
    state.audioDiagnostics.push(record);
    if (state.audioDiagnostics.length > MAX_AUDIO_DIAGNOSTICS) {
      state.audioDiagnostics.splice(
        0,
        state.audioDiagnostics.length - MAX_AUDIO_DIAGNOSTICS,
      );
    }
    const message = [
      `Weapon: ${record.weapon}`,
      `Actor: ${record.actor}`,
      `Original: ${record.original}`,
      `Override: ${record.override}`,
      `Selected: ${record.selected}`,
      `Status: ${record.status}`,
    ].join("\n");
    const logger = level === "warn" ? console.warn : console.info;
    logger(AUDIO_PREFIX, message);
  }

  function warnAudioOnce(key, detail) {
    if (!state.audioDebug || warnedAudioIssues.has(key)) return;
    warnedAudioIssues.add(key);
    addAudioDiagnostic(detail, "warn");
  }

  function normalizeWeaponType(type) {
    return String(type).toLowerCase() === "unique" ? "unique" : "normal";
  }

  function resolveWeaponSoundFamily(id, type, originalFamily) {
    const kind = normalizeWeaponType(type);
    const numericId = Number(id);
    const bucket = WEAPON_SOUND_OVERRIDES[kind];
    const hasOverride =
      Number.isInteger(numericId) &&
      Object.prototype.hasOwnProperty.call(bucket, numericId);
    const configured = hasOverride ? bucket[numericId] : null;
    if (!configured) {
      return { family: originalFamily, kind, overridden: false };
    }
    if (!COMBAT_SOUND_FAMILIES.has(configured)) {
      warnAudioOnce(`invalid-combat-override:${kind}:${numericId}`, {
        weapon: `${kind}${numericId}`,
        original: originalFamily,
        override: configured,
        status: "Ignored invalid combat override",
      });
      return { family: originalFamily, kind, overridden: false };
    }
    return { family: configured, kind, overridden: true };
  }

  function resolveEquipmentSound(itemcode, isUnique, type, originalSound) {
    const kind = isUnique ? "unique" : "normal";
    const numericId = Number(itemcode);
    const bucket = EQUIPMENT_SOUND_OVERRIDES[kind];
    const hasOverride =
      Number.isInteger(numericId) &&
      Object.prototype.hasOwnProperty.call(bucket, numericId);
    const configured = hasOverride ? bucket[numericId] : null;
    if (!configured) return { sound: originalSound, kind, overridden: false };
    if (!EQUIPMENT_SOUND_IDS.has(configured)) {
      warnAudioOnce(`invalid-equipment-override:${kind}:${numericId}`, {
        weapon: `${kind}${numericId}`,
        actor: "Equipment",
        original: originalSound,
        override: configured,
        status: "Ignored invalid equipment override",
      });
      return { sound: originalSound, kind, overridden: false };
    }
    return { sound: configured, kind, overridden: true, type };
  }

  function logWarning(kind, side, battlefield, extra = {}) {
    const weaponLoader = battlefield[side + "_weapon_loader"];
    const url = getMediaUrl(weaponLoader);
    const filename = url.split("/").pop().split("?")[0] || "(unknown)";
    const parsedId = filename.match(/(?:unique|item_weapon)(\d+)\.png$/i);
    const detail = {
      side: side === "pl" ? "player" : "opponent",
      kind,
      filename,
      weaponId: parsedId ? Number(parsedId[1]) : null,
      weaponType: filename.toLowerCase().startsWith("unique")
        ? "unique"
        : "regular/unknown",
      imageURL: url,
      ...extra,
    };
    state.warnings.push(detail);
    console.warn(PREFIX, kind, detail);
  }

  function repairWeapon(battlefield, side, Point) {
    const weapon = battlefield[side + "_weapon"];
    if (!weapon) return;

    if (weapon.dir !== "left" && weapon.dir !== "right") {
      logWarning(
        'Missing/invalid direction; using "right"',
        side,
        battlefield,
        {
          previousDirection: weapon.dir,
        },
      );
      weapon.dir = "right";
    }

    if (
      weapon.deg === null ||
      weapon.deg === undefined ||
      !Number.isFinite(Number(weapon.deg))
    ) {
      logWarning("Missing/invalid angle; using 30 degrees", side, battlefield, {
        previousAngle: weapon.deg,
      });
      weapon.deg = 30;
    }

    const point = weapon.rp;
    if (
      !(point instanceof Point) ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y)
    ) {
      // The point MUST be an actual openfl.geom.Point: the original game
      // performs a Haxe class cast before reading .x and .y.
      const x = weapon.dir === "left" ? 56 : 18;
      const y = BASE_RP_Y + lift[side];
      logWarning(
        "Missing/invalid weapon reference point; using raised fallback",
        side,
        battlefield,
        {
          previousReferencePoint: point,
          fallback: { x, y },
          liftedByPixels: lift[side],
        },
      );
      weapon.rp = new Point(x, y);
      weapon.__tanothFallbackRP = true;
      current[side] = { weapon };
    } else if (!weapon.__tanothFallbackRP) {
      // Do not modify Gameforge's correct positioning metadata.
      current[side] = null;
    }
  }

  function isWrapped(fn, label) {
    return typeof fn === "function" && fn[PATCH_MARKER] === label;
  }

  function markWrapper(fn, label) {
    Object.defineProperty(fn, PATCH_MARKER, {
      configurable: false,
      enumerable: false,
      value: label,
    });
    return fn;
  }

  function wrapMethodOnce(target, methodName, label, factory) {
    const original = target && target[methodName];
    if (typeof original !== "function") return false;
    if (isWrapped(original, label)) return true;
    target[methodName] = markWrapper(factory(original), label);
    return true;
  }

  function withAudioContext(actor, battlefield, callback) {
    const previous = state.audioContext;
    state.audioContext = { actor, battlefield };
    try {
      return callback();
    } finally {
      state.audioContext = previous;
    }
  }

  function patchBattleGround() {
    const BattleGround =
      state.captures["de.gameforge.modules.battle.BattleGround"];
    const Point = state.captures["openfl.geom.Point"];
    if (!BattleGround || !Point || !BattleGround.prototype) return false;

    const proto = BattleGround.prototype;
    for (const [methodName, side] of [
      ["initPlWeapon", "pl"],
      ["initOpWeapon", "op"],
    ]) {
      if (
        !wrapMethodOnce(
          proto,
          methodName,
          `animation:${methodName}`,
          (original) =>
            function (...args) {
              repairWeapon(this, side, Point);
              return original.apply(this, args);
            },
        )
      ) {
        return false;
      }
    }

    for (const [methodName, actor] of [
      ["on_pl_weapon_complete", "Player"],
      ["on_op_weapon_complete", "Opponent"],
      ["startPlAttackAni", "Player"],
      ["startOpAttackAni", "Opponent"],
    ]) {
      wrapMethodOnce(
        proto,
        methodName,
        `audio-context:${methodName}`,
        (original) =>
          function (...args) {
            return withAudioContext(actor, this, () =>
              original.apply(this, args),
            );
          },
      );
    }

    return true;
  }

  function patchSoundController() {
    const SoundController =
      state.captures["de.gameforge.util.sound.SoundController"];
    const Assets = state.captures["openfl.utils.Assets"];
    const SoundTransform = state.captures["openfl.media.SoundTransform"];
    if (
      !SoundController ||
      !SoundController.prototype ||
      !Assets ||
      typeof Assets.getSound !== "function" ||
      typeof SoundTransform !== "function"
    ) {
      return false;
    }

    const proto = SoundController.prototype;
    const prefixPatched = wrapMethodOnce(
      proto,
      "getWeaponSoundPrefix",
      "audio:getWeaponSoundPrefix",
      (original) =>
        function (id, type, ...rest) {
          const originalFamily = original.call(this, id, type, ...rest);
          const resolution = resolveWeaponSoundFamily(id, type, originalFamily);
          const actor = state.audioContext?.actor || "Unknown";
          const detail = {
            weaponId: Number(id),
            weaponType: resolution.kind,
            weapon: `${resolution.kind}${id}`,
            actor,
            original: originalFamily,
            override: resolution.family,
            selected: null,
            status: resolution.overridden ? "Override applied" : "Unchanged",
          };
          if (actor === "Player" || actor === "Opponent") {
            state.audioWeapons[actor] = detail;
          }
          addAudioDiagnostic(detail);
          return resolution.family;
        },
    );

    const idPatched = wrapMethodOnce(
      proto,
      "getWeaponSoundId",
      "audio:getWeaponSoundId",
      (original) =>
        function (family, ...rest) {
          const selected = original.call(this, family, ...rest);
          const actor = state.audioContext?.actor || "Unknown";
          const weapon = state.audioWeapons[actor];
          addAudioDiagnostic({
            weapon: weapon?.weapon || "(unresolved weapon)",
            actor,
            original: weapon?.original || family,
            override: family,
            selected,
            status: "OK",
          });
          return selected;
        },
    );

    const playPatched = wrapMethodOnce(
      proto,
      "play",
      "audio:play",
      () =>
        function (which) {
          // Match the original mute condition exactly and avoid even looking
          // up an asset when effects volume is zero.
          if (!(this._scSoundVolume > 0)) return;

          const soundId = typeof which === "string" ? which.trim() : "";
          if (!soundId) {
            warnAudioOnce("missing-sound-id", {
              actor: state.audioContext?.actor || "Unknown",
              selected: which,
              status: "Skipped empty sound identifier",
            });
            return;
          }
          if (
            !this.libPaths ||
            !Object.prototype.hasOwnProperty.call(this.libPaths, soundId)
          ) {
            warnAudioOnce(`unknown-sound-id:${soundId}`, {
              actor: state.audioContext?.actor || "Unknown",
              selected: soundId,
              status: "Skipped unregistered sound identifier",
            });
            return;
          }

          const path = this.libPaths[soundId];
          if (typeof path !== "string" || !path.trim()) {
            warnAudioOnce(`missing-sound-path:${soundId}`, {
              actor: state.audioContext?.actor || "Unknown",
              selected: soundId,
              status: "Skipped empty sound asset path",
            });
            return;
          }

          // Do not catch getSound() or Sound.play() exceptions: only the known
          // null/missing-asset path is handled, so unrelated failures remain
          // visible to Tanoth and browser diagnostics.
          const sound = Assets.getSound("audio:" + path);
          if (!sound || typeof sound.play !== "function") {
            warnAudioOnce(`missing-sound-asset:${soundId}:${path}`, {
              actor: state.audioContext?.actor || "Unknown",
              selected: soundId,
              status: `Skipped unresolved asset: ${path}`,
            });
            return;
          }

          const soundTransform = new SoundTransform();
          soundTransform.volume = this._scSoundVolume;
          sound.play(0, 1, soundTransform);
        },
    );

    const originalEquipmentResolver = SoundController.getDragObjectSound;
    let equipmentPatched = false;
    if (
      typeof originalEquipmentResolver === "function" &&
      isWrapped(originalEquipmentResolver, "audio:getDragObjectSound")
    ) {
      equipmentPatched = true;
    } else if (typeof originalEquipmentResolver === "function") {
      SoundController.getDragObjectSound = markWrapper(function (
        itemcode,
        isUnique,
        type,
        ...rest
      ) {
        const originalSound = originalEquipmentResolver.call(
          this,
          itemcode,
          isUnique,
          type,
          ...rest,
        );
        const resolution = resolveEquipmentSound(
          itemcode,
          isUnique,
          type,
          originalSound,
        );
        if (resolution.overridden) {
          addAudioDiagnostic({
            weapon: `${resolution.kind}${itemcode}`,
            actor: "Equipment",
            original: originalSound,
            override: resolution.sound,
            selected: resolution.sound,
            status: "Override applied",
          });
        }
        return resolution.sound;
      }, "audio:getDragObjectSound");
      equipmentPatched = true;
    }

    return prefixPatched && idPatched && playPatched && equipmentPatched;
  }

  function installPatches() {
    state.installAttempts += 1;
    const wasPatched = state.patched;
    state.animationPatched = patchBattleGround();
    state.audioPatched = patchSoundController();
    state.patched = state.animationPatched && state.audioPatched;

    if (state.patched) {
      state.status = "active";
      if (!wasPatched) {
        console.info(
          PREFIX,
          "ACTIVE: weapon renderers and audio are protected. Missing-RP weapon images are raised by",
          { player: lift.pl, opponent: lift.op },
          "pixels.",
        );
        addAudioDiagnostic({
          actor: "System",
          status: "Audio patch installed",
        });
      }
    } else if (state.animationPatched || state.audioPatched) {
      state.status = `partially active: animation=${state.animationPatched}, audio=${state.audioPatched}`;
      console.warn(PREFIX, state.status);
    } else {
      state.status =
        "game loaded, but required classes or methods were not captured";
      console.error(PREFIX, state.status, {
        capturedClasses: Object.keys(state.captures),
      });
    }
    return state.patched;
  }

  function captureClassesWhile(callback) {
    // Haxe registers classes as $hxClasses["qualified.Name"] = Ctor.
    // The registry is private to the generated script. Temporarily intercept
    // only the five uncommon property names needed by this hotfix during
    // synchronous startup, then restore Object.prototype immediately.
    const saved = [];
    try {
      for (const name of CLASS_NAMES) {
        const previous = Object.getOwnPropertyDescriptor(
          Object.prototype,
          name,
        );
        if (previous && !previous.configurable) {
          throw new Error("Cannot intercept class registry key: " + name);
        }
        saved.push([name, previous]);
        Object.defineProperty(Object.prototype, name, {
          configurable: true,
          get() {
            return undefined;
          },
          set(value) {
            // Preserve normal JS assignment semantics: create an own property
            // on the registry rather than a persistent prototype property.
            Object.defineProperty(this, name, {
              configurable: true,
              enumerable: true,
              writable: true,
              value,
            });
            if (typeof value === "function") state.captures[name] = value;
          },
        });
      }
      return callback();
    } finally {
      for (let i = saved.length - 1; i >= 0; i--) {
        const [name, previous] = saved[i];
        if (previous) Object.defineProperty(Object.prototype, name, previous);
        else delete Object.prototype[name];
      }
    }
  }

  function wrapEmbed(fn) {
    if (typeof fn !== "function") return fn;
    if (taggedEmbedWrappers.has(fn) || isWrapped(fn, "lime:embed")) return fn;

    const wrappedEmbed = markWrapper(function (...args) {
      if (state.patched || state.embedDepth > 0) return fn.apply(this, args);

      state.embedDepth += 1;
      state.status = "capturing game classes during Lime startup";
      try {
        return captureClassesWhile(() => fn.apply(this, args));
      } finally {
        state.embedDepth -= 1;
        // Lime invokes the generated Haxe script synchronously. Prototypes
        // are fully defined once the original embed function returns.
        installPatches();
      }
    }, "lime:embed");
    taggedEmbedWrappers.add(wrappedEmbed);
    return wrappedEmbed;
  }

  function hookLime(lime) {
    if (!lime || (typeof lime !== "object" && typeof lime !== "function"))
      return;
    if (hookedLimeObjects.has(lime)) return;
    hookedLimeObjects.add(lime);

    const prior = Object.getOwnPropertyDescriptor(lime, "embed");
    if (prior && !prior.configurable) {
      console.warn(
        PREFIX,
        "Lime embed property is non-configurable; cannot hook startup.",
      );
      return;
    }
    let embedValue = wrapEmbed(lime.embed);
    Object.defineProperty(lime, "embed", {
      configurable: true,
      enumerable: prior ? prior.enumerable : true,
      get() {
        return embedValue;
      },
      set(value) {
        embedValue = wrapEmbed(value);
      },
    });
    console.info(PREFIX, "Lime startup hook installed.");
  }

  const priorLime = Object.getOwnPropertyDescriptor(window, "lime");
  if (!priorLime || priorLime.configurable) {
    let limeValue = window.lime;
    Object.defineProperty(window, "lime", {
      configurable: true,
      enumerable: priorLime ? priorLime.enumerable : true,
      get() {
        return limeValue;
      },
      set(value) {
        limeValue = value;
        hookLime(value);
      },
    });
    hookLime(limeValue);
  } else {
    hookLime(window.lime);
  }

  // Inspect or configure in DevTools Console:
  // window.TanothWeaponHotfix.status
  // window.TanothWeaponHotfix.warnings
  // window.TanothWeaponHotfix.setAudioDebug(true)
  // window.TanothWeaponHotfix.audioDiagnostics
  Object.defineProperty(window, "TanothWeaponHotfix", {
    configurable: true,
    value: {
      __tanothWeaponHotfix: true,
      version: VERSION,
      get status() {
        return state.status;
      },
      get patched() {
        return state.patched;
      },
      get animationPatched() {
        return state.animationPatched;
      },
      get audioPatched() {
        return state.audioPatched;
      },
      get warnings() {
        return state.warnings.slice();
      },
      get audioDebug() {
        return state.audioDebug;
      },
      get audioDiagnostics() {
        return state.audioDiagnostics.slice();
      },
      get soundOverrides() {
        return {
          unique: { ...WEAPON_SOUND_OVERRIDES.unique },
          normal: { ...WEAPON_SOUND_OVERRIDES.normal },
        };
      },
      get equipmentSoundOverrides() {
        return {
          unique: { ...EQUIPMENT_SOUND_OVERRIDES.unique },
          normal: { ...EQUIPMENT_SOUND_OVERRIDES.normal },
        };
      },
      get lift() {
        return { player: lift.pl, opponent: lift.op };
      },
      reinstall: installPatches,
      setAudioDebug,
      setLift,
    },
  });
  console.info(PREFIX, "Loaded at document-start; awaiting game startup.");
})();
