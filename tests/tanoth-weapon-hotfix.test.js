"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const scriptPath = path.join(
  __dirname,
  "..",
  "Tanoth-WeaponHotfix-1.2.0.user.js",
);
const userscript = fs.readFileSync(scriptPath, "utf8");

function createHarness() {
  const storage = new Map();
  const logs = { info: [], warn: [], error: [] };
  const sandbox = {
    __random: 0,
    console: {
      info: (...args) => logs.info.push(args),
      warn: (...args) => logs.warn.push(args),
      error: (...args) => logs.error.push(args),
    },
  };
  sandbox.Math = Object.create(Math);
  sandbox.Math.random = () => sandbox.__random;
  sandbox.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(userscript, context, { filename: scriptPath });

  vm.runInContext(
    `
      window.__assetLookups = [];
      window.__plays = [];
      window.__missingAssets = new Set();

      window.lime = {
        embed: function () {
          const registry = {};

          function Point(x, y) {
            this.x = x == null ? 0 : x;
            this.y = y == null ? 0 : y;
          }

          function SoundTransform() {
            this.volume = 1;
          }

          function Assets() {}
          Assets.getSound = function (id) {
            window.__assetLookups.push(id);
            if (window.__missingAssets.has(id)) return null;
            return {
              play: function (start, loops, transform) {
                window.__plays.push({ id, start, loops, volume: transform.volume });
              },
            };
          };

          function SoundController() {
            this._scSoundVolume = 1;
            this.libPaths = {
              combat_block: "lib/sfx/combat_block.mp3",
              combat_crit: "lib/sfx/combat_crit.mp3",
              combat_hit1: "lib/sfx/combat_hit1.mp3",
              combat_hit2: "lib/sfx/combat_hit2.mp3",
              combat_hit3: "lib/sfx/combat_hit3.mp3",
              combat_hit_axe1: "lib/sfx/combat_hit_axe1.mp3",
              combat_hit_axe2: "lib/sfx/combat_hit_axe2.mp3",
              combat_hit_axe3: "lib/sfx/combat_hit_axe3.mp3",
              combat_hit_mace1: "lib/sfx/combat_hit_mace1.mp3",
              combat_hit_mace2: "lib/sfx/combat_hit_mace2.mp3",
              combat_hit_mace3: "lib/sfx/combat_hit_mace3.mp3",
              combat_bite1: "lib/sfx/combat_bite1.mp3",
              combat_bite2: "lib/sfx/combat_bite2.mp3",
              item_metall: "lib/sfx/item_metall.mp3",
            };
          }

          SoundController.getDragObjectSound = function (itemcode, isUnique, type) {
            if (isUnique) {
              if (itemcode === 36) return "item_metall";
              return "";
            }
            return type === 8 ? "item_metall" : "item_pickup";
          };

          SoundController.prototype.getWeaponSoundPrefix = function (id, type) {
            if (type === "unique") {
              if ([36, 37, 47].includes(id)) return "combat_hit_mace";
              if ([40, 42, 46, 48, 56].includes(id)) return "combat_hit_axe";
              return "combat_hit";
            }
            if ([2, 5, 8, 11, 13, 18, 21, 23, 26, 28].includes(id)) {
              return "combat_hit_mace";
            }
            if ([3, 6, 9, 12, 14, 17, 20, 24, 27, 29].includes(id)) {
              return "combat_hit_axe";
            }
            if (id === 50) return "combat_bite";
            if (id === 99) return "combat_crit";
            return "combat_hit";
          };

          SoundController.prototype.getWeaponSoundId = function (family) {
            if (family === "combat_bite") {
              return "combat_bite" + (1 + Math.round(Math.random()));
            }
            if (family === "combat_crit") return "combat_crit";
            if (["combat_hit", "combat_hit_axe", "combat_hit_mace"].includes(family)) {
              return family + (1 + Math.round(2 * Math.random()));
            }
            return "combat_hit" + (1 + Math.round(2 * Math.random()));
          };

          SoundController.prototype.play = function (which) {
            if (this._scSoundVolume > 0) {
              const sound = Assets.getSound("audio:" + this.libPaths[which]);
              const transform = new SoundTransform();
              transform.volume = this._scSoundVolume;
              sound.play(0, 1, transform);
            }
          };

          const controller = new SoundController();

          function BattleGround() {
            this.plInitCount = 0;
            this.opInitCount = 0;
            this.pl_weapon_loader = { url: "https://game/assets/unique186.png" };
            this.op_weapon_loader = { url: "https://game/assets/unique186.png" };
          }

          BattleGround.prototype.initPlWeapon = function () {
            this.plInitCount += 1;
          };
          BattleGround.prototype.initOpWeapon = function () {
            this.opInitCount += 1;
          };
          BattleGround.prototype.on_pl_weapon_complete = function (event) {
            this.sound_pl_weapon = controller.getWeaponSoundPrefix(event.id, event.type);
            this.pl_weapon = { dir: "right", deg: 30, rp: new Point(18, 118) };
            this.initPlWeapon();
          };
          BattleGround.prototype.on_op_weapon_complete = function (event) {
            this.sound_op_weapon = controller.getWeaponSoundPrefix(event.id, event.type);
            this.op_weapon = { dir: "left", deg: 30, rp: new Point(56, 118) };
            this.initOpWeapon();
          };
          BattleGround.prototype.startPlAttackAni = function (blocked) {
            if (blocked === 1) controller.play("combat_block");
            else controller.play(controller.getWeaponSoundId(this.sound_pl_weapon));
          };
          BattleGround.prototype.startOpAttackAni = function (blocked) {
            if (blocked === 1) controller.play("combat_block");
            else controller.play(controller.getWeaponSoundId(this.sound_op_weapon));
          };

          registry["openfl.geom.Point"] = Point;
          registry["openfl.media.SoundTransform"] = SoundTransform;
          registry["openfl.utils.Assets"] = Assets;
          registry["de.gameforge.modules.battle.BattleGround"] = BattleGround;
          registry["de.gameforge.util.sound.SoundController"] = SoundController;

          window.__classes = { Point, SoundTransform, Assets, SoundController, BattleGround };
          window.__controller = controller;
        },
      };
      window.lime.embed();
    `,
    context,
  );

  return {
    api: sandbox.TanothWeaponHotfix,
    classes: sandbox.__classes,
    context,
    controller: sandbox.__controller,
    logs,
    sandbox,
  };
}

test("unique186 is a mace-family weapon for both player and opponent", () => {
  const harness = createHarness();
  const battle = new harness.classes.BattleGround();

  battle.on_pl_weapon_complete({ id: 186, type: "unique" });
  battle.on_op_weapon_complete({ id: 186, type: "unique" });

  assert.equal(battle.sound_pl_weapon, "combat_hit_mace");
  assert.equal(battle.sound_op_weapon, "combat_hit_mace");
});

test("debug diagnostics identify actor, override, selection, and patch status", () => {
  const harness = createHarness();
  const battle = new harness.classes.BattleGround();
  harness.api.setAudioDebug(true);

  battle.on_pl_weapon_complete({ id: 186, type: "unique" });
  battle.startPlAttackAni(0);

  assert.ok(
    harness.api.audioDiagnostics.some(
      (record) =>
        record.actor === "System" && record.status === "Audio patch installed",
    ),
  );
  assert.ok(
    harness.api.audioDiagnostics.some(
      (record) =>
        record.weapon === "unique186" &&
        record.actor === "Player" &&
        record.original === "combat_hit" &&
        record.override === "combat_hit_mace" &&
        record.selected === "combat_hit_mace1" &&
        record.status === "OK",
    ),
  );
});

test("unconfigured and built-in weapon classifications are preserved", () => {
  const { controller } = createHarness();

  assert.equal(controller.getWeaponSoundPrefix(185, "unique"), "combat_hit");
  assert.equal(
    controller.getWeaponSoundPrefix(36, "unique"),
    "combat_hit_mace",
  );
  assert.equal(controller.getWeaponSoundPrefix(40, "unique"), "combat_hit_axe");
  assert.equal(controller.getWeaponSoundPrefix(2, "item_w"), "combat_hit_mace");
  assert.equal(controller.getWeaponSoundPrefix(3, "item_w"), "combat_hit_axe");
});

test("blocked attacks retain combat_block", () => {
  const harness = createHarness();
  const battle = new harness.classes.BattleGround();

  battle.on_pl_weapon_complete({ id: 186, type: "unique" });
  battle.startPlAttackAni(1);

  assert.equal(harness.sandbox.__plays.length, 1);
  assert.equal(harness.sandbox.__plays[0].id, "audio:lib/sfx/combat_block.mp3");
});

test("Tanoth's original sound variation selection is retained", () => {
  const harness = createHarness();
  harness.sandbox.__random = 0;
  assert.equal(
    harness.controller.getWeaponSoundId("combat_hit_mace"),
    "combat_hit_mace1",
  );
  harness.sandbox.__random = 0.99;
  assert.equal(
    harness.controller.getWeaponSoundId("combat_hit_mace"),
    "combat_hit_mace3",
  );
  assert.equal(
    harness.controller.getWeaponSoundId("combat_crit"),
    "combat_crit",
  );
});

test("empty, unknown, and unresolved sound assets are skipped safely", () => {
  const harness = createHarness();
  harness.api.setAudioDebug(true);

  assert.doesNotThrow(() => harness.controller.play(""));
  assert.doesNotThrow(() => harness.controller.play("not_registered"));
  harness.controller.libPaths.missing_asset = "lib/sfx/missing.mp3";
  harness.sandbox.__missingAssets.add("audio:lib/sfx/missing.mp3");
  assert.doesNotThrow(() => harness.controller.play("missing_asset"));

  assert.equal(harness.sandbox.__plays.length, 0);
  assert.ok(
    harness.api.audioDiagnostics.some((record) =>
      record.status.includes("Skipped unresolved asset"),
    ),
  );
});

test("muted sound effects remain muted and do not trigger asset lookup", () => {
  const harness = createHarness();
  harness.controller._scSoundVolume = 0;

  harness.controller.play("combat_hit1");

  assert.equal(harness.sandbox.__assetLookups.length, 0);
  assert.equal(harness.sandbox.__plays.length, 0);
});

test("equipment mapping is exact and unknown unique equipment cannot crash", () => {
  const harness = createHarness();
  const resolver = harness.classes.SoundController.getDragObjectSound;

  assert.equal(resolver(186, true, 8), "item_metall");
  assert.equal(resolver(999, true, 8), "");
  assert.doesNotThrow(() => harness.controller.play(resolver(999, true, 8)));
  assert.equal(harness.sandbox.__plays.length, 0);
});

test("patch installation is idempotent", () => {
  const harness = createHarness();
  const before = {
    play: harness.classes.SoundController.prototype.play,
    prefix: harness.classes.SoundController.prototype.getWeaponSoundPrefix,
    playerInit: harness.classes.BattleGround.prototype.initPlWeapon,
  };

  assert.equal(harness.api.reinstall(), true);
  assert.equal(harness.classes.SoundController.prototype.play, before.play);
  assert.equal(
    harness.classes.SoundController.prototype.getWeaponSoundPrefix,
    before.prefix,
  );
  assert.equal(
    harness.classes.BattleGround.prototype.initPlWeapon,
    before.playerInit,
  );
});

test("existing animation fallback still repairs direction, angle, and reference point", () => {
  const harness = createHarness();
  const battle = new harness.classes.BattleGround();
  battle.pl_weapon = { dir: null, deg: Number.NaN, rp: null };

  battle.initPlWeapon();

  assert.equal(battle.pl_weapon.dir, "right");
  assert.equal(battle.pl_weapon.deg, 30);
  assert.ok(battle.pl_weapon.rp instanceof harness.classes.Point);
  assert.deepEqual(
    { x: battle.pl_weapon.rp.x, y: battle.pl_weapon.rp.y },
    { x: 18, y: 150 },
  );
  assert.equal(battle.plInitCount, 1);
});

test("reference client still matches the narrow Haxe patch contract", (t) => {
  const referencePath = path.join(
    __dirname,
    "..",
    "references",
    "TanothHtml5.js",
  );
  if (!fs.existsSync(referencePath)) {
    t.skip("read-only reference client is not present");
    return;
  }
  const reference = fs.readFileSync(referencePath, "utf8");

  assert.match(
    reference,
    /\$hxClasses\["de\.gameforge\.util\.sound\.SoundController"\]/,
  );
  assert.match(reference, /getWeaponSoundPrefix: function\(id,type\)/);
  assert.match(reference, /getWeaponSoundId: function\(type\)/);
  assert.match(reference, /play: function\(which\)/);
  assert.match(
    reference,
    /getDragObjectSound = function\(itemcode,is_unique,type\)/,
  );
  assert.match(
    reference,
    /this\.sound_op_weapon = .*getWeaponSoundPrefix\(id,type\)/,
  );
  assert.match(
    reference,
    /this\.sound_pl_weapon = .*getWeaponSoundPrefix\(id,type\)/,
  );
  assert.match(reference, /if\(this\._assetOverride != -1\)/);
});
