const express = require("express");
const jwt = require("jsonwebtoken");
const { database, UserModel, UserController, decorateName } = require("./BackendUtils");

const JWT_SECRET = process.env.JWT_SECRET || "stumble-project-is-the-best";

const VALID_ROLES = ["player", "pro", "boss", "goat", "og", "mod", "dev", "co_owner", "owner"];

const LEGACY_ROLES = { project: "og" };

function normalizeRole(role) {
  role = LEGACY_ROLES[role] || role;
  return VALID_ROLES.includes(role) ? role : "player";
}

function roleFlags(role) {
  role = normalizeRole(role);
  return {
    role,
    isOwner: role === "owner",
    isCoOwner: role === "co_owner",
    isDev: role === "dev",
    isMod: role === "mod",
    isOg: role === "og",
    isGoat: role === "goat",
    isBoss: role === "boss",
    isPro: role === "pro",
    isPlayer: role === "player",
  };
}

async function findUser(target) {
  if (!target) return null;
  return (
    (await database.getUserByQuery({ username: target })) ||
    (await database.getUserByQuery({ stumbleId: target })) ||
    (await database.getUserByQuery({ deviceId: target }))
  );
}

function requireAdmin(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!process.env.ADMIN_API_KEY || key !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
}

const router = express.Router();

router.post("/api/v1/userLogin", async (req, res) => {
  try {
    const { userId, deviceId, nickName, createNewUser } = req.body || {};
    if (!deviceId) return res.status(400).json({ message: "DeviceId is required" });

    let user = await UserModel.findByDeviceId(deviceId);

    if (!user && nickName && nickName.trim()) {
      user = await database.getUserByQuery({ username: nickName.trim() });
      if (user) {

        await database.updateUser({ stumbleId: user.stumbleId }, { deviceId });
        user.deviceId = deviceId;
        console.log(`[Auth] re-keyed ${user.username} onto deviceId ${deviceId} (was a different id)`);
      }
    }

    if (!user) {
      if (createNewUser === false) return res.status(404).json({ message: "User not found" });

      user = await UserModel.create(req.ip, deviceId, { Version: "0.64" });
      const uname = (nickName && nickName.trim()) || user.username;

      await database.updateUser({ deviceId }, { username: uname, role: user.role || "player", "userProfile.userName": uname });
      user.username = uname;
    } else if (nickName && nickName.trim() && user.username !== nickName.trim()) {

      await database.updateUser({ deviceId }, { username: nickName.trim(), "userProfile.userName": nickName.trim() });
      user.username = nickName.trim();
    }

    const accessToken = jwt.sign({ deviceId, userId: userId || deviceId }, JWT_SECRET, { expiresIn: "3650d" });
    const expireAt = new Date(Date.now() + 3650 * 24 * 3600 * 1000).toISOString();
    res.json({ accessToken, refreshToken: accessToken, expireAt });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post("/api/v1/userGet", async (req, res) => {
  try {
    const { accessToken } = req.body || {};
    if (!accessToken) return res.status(400).json({ message: "accessToken is required" });

    let payload;
    try { payload = jwt.verify(accessToken, JWT_SECRET); }
    catch { return res.status(401).json({ message: "invalid token" }); }

    let user = await UserModel.findByDeviceId(payload.deviceId);
    if (!user) {

      user = await UserModel.create("0.0.0.0", payload.deviceId, { Version: "0.64" });
    }

    res.json({
      id: String(user.stumbleId || user.deviceId),
      nick: user.username || "Player",
      createdAt: user.creationDate || user.createdAt || "",
      ban: !!user.isBanned,
      shadowBan: !!user.shadowBanned,
      banReason: user.banReason || "",
      nameTag: user.nameTag || "",
      nameTagColor: user.nameTagColor || "",

      nameColor: user.nameColor || "",
      badgeEnabled: !!user.badgeEnabled,
      badgeText: user.badgeText || "",
      badgeColor: user.badgeColor || "",
      ...roleFlags(user.role || "player"),
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

function roleRank(role) {

  const i = VALID_ROLES.indexOf(normalizeRole(role));
  return i < 0 ? 0 : i;
}
function sanitizeTag(tag) {
  return String(tag || "").replace(/[<>\[\]]/g, "").trim().slice(0, 6);
}
function sanitizeColor(color) {
  let c = String(color || "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(c)) return "FFD700";
  return c.toUpperCase();
}

router.post("/api/v1/setTag", async (req, res) => {
  try {
    const { accessToken, tag, color } = req.body || {};
    if (!accessToken) return res.status(400).json({ message: "accessToken required" });

    let payload;
    try { payload = jwt.verify(accessToken, JWT_SECRET); }
    catch { return res.status(401).json({ message: "invalid token" }); }

    const user = await UserModel.findByDeviceId(payload.deviceId);
    if (!user) return res.status(404).json({ message: "user not found" });

    if (roleRank(user.role || "player") < roleRank("og")) {
      return res.status(403).json({ message: "requires OG tier or higher" });
    }

    const cleanTag = sanitizeTag(tag);
    const cleanColor = sanitizeColor(color);
    await database.updateUser({ deviceId: payload.deviceId }, { nameTag: cleanTag, nameTagColor: cleanColor });
    res.json({ ok: true, tag: cleanTag, color: cleanColor });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

function sanitizeHexOrEmpty(color) {
  const c = String(color || "").trim().replace("#", "");
  return /^[0-9a-fA-F]{6}$/.test(c) ? c.toUpperCase() : "";
}

function sanitizeBadgeText(text) {
  return String(text || "").replace(/<[^>]*>/g, "").trim().slice(0, 16);
}

router.post("/api/v1/setDecor", async (req, res) => {
  try {
    const { accessToken, nameColor, badgeEnabled, badgeText, badgeColor, userName } = req.body || {};
    if (!accessToken) return res.status(400).json({ message: "accessToken required" });

    let payload;
    try { payload = jwt.verify(accessToken, JWT_SECRET); }
    catch { return res.status(401).json({ message: "invalid token" }); }

    const user = await UserModel.findByDeviceId(payload.deviceId);
    if (!user) return res.status(404).json({ message: "user not found" });

    const updates = { nameColor: sanitizeHexOrEmpty(nameColor) };

    const wantedName = typeof userName === "string" ? userName.trim() : "";
    if (wantedName && wantedName !== user.username) {

      const taken = await database.getUserByQuery({ username: wantedName });
      if (taken && taken.stumbleId !== user.stumbleId && taken.deviceId !== user.deviceId) {
        return res.status(409).json({ message: "name already taken" });
      }
      updates.username = wantedName;
    }

    const isOwner = roleRank(user.role || "player") >= roleRank("owner");
    if (isOwner) {
      updates.badgeEnabled = !!badgeEnabled;
      updates.badgeText = sanitizeBadgeText(badgeText);
      updates.badgeColor = sanitizeHexOrEmpty(badgeColor);
    }

    await database.updateUser({ deviceId: payload.deviceId }, updates);
    res.json({ ok: true, ...updates, badgeStored: isOwner });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post("/api/v1/decors", async (req, res) => {
  try {
    const { accessToken, names } = req.body || {};
    if (!accessToken) return res.status(400).json({ message: "accessToken required" });

    try { jwt.verify(accessToken, JWT_SECRET); }
    catch { return res.status(401).json({ message: "invalid token" }); }

    if (!Array.isArray(names) || names.length === 0) return res.json({ decors: [] });

    const wanted = names
      .filter(n => typeof n === "string" && n.trim())
      .map(n => n.trim())
      .slice(0, 64);
    if (wanted.length === 0) return res.json({ decors: [] });

    const patterns = wanted.map(n => "^" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");

    const rows = await database.collections.Users.find({
      $or: patterns.map(p => ({ username: { $regex: p, $options: "i" } }))
    }).toArray();

    const decors = rows.map(u => ({
      userName: u.username || "",
      role: VALID_ROLES.includes(u.role) ? u.role : "player",
      nameTag: u.nameTag || "",
      nameTagColor: u.nameTagColor || "",
      nameColor: u.nameColor || "",
      badgeEnabled: !!u.badgeEnabled,
      badgeText: u.badgeText || "",
      badgeColor: u.badgeColor || "",
    }));

    res.json({ decors });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post("/mod/role", async (req, res) => {
  try {
    const { stumbleId, deviceId, username } = req.body || {};
    const user = await findUser(stumbleId || deviceId || username);
    if (!user) return res.json({ ...roleFlags("player"), shadowBanned: false, banned: false, found: false });
    res.json({
      ...roleFlags(user.role || "player"),
      shadowBanned: !!user.shadowBanned,
      banned: !!user.isBanned,
      found: true,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/setrole", requireAdmin, async (req, res) => {
  try {
    const { target, role } = req.body || {};
    if (!VALID_ROLES.includes(role))
      return res.status(400).json({ error: "invalid role. valid: " + VALID_ROLES.join(", ") });
    const user = await findUser(target);
    if (!user) return res.status(404).json({ error: "user not found: " + target });

    const plain = user.username || "";
    const updates = { role };

    if (plain) updates["userProfile.userName"] = decorateName(role, plain);

    await database.updateUser({ deviceId: user.deviceId }, updates);
    res.json({ ok: true, target: user.username, role });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/setcurrency", requireAdmin, async (req, res) => {
  try {
    const { target, gems, coins, passTokens, zeroAll } = req.body || {};
    const user = await findUser(target);
    if (!user) return res.status(404).json({ error: "user not found: " + target });

    const balances = Array.isArray(user.balances) ? user.balances.map(b => ({ ...b })) : [];
    const setBal = (name, amt) => {
      const b = balances.find(x => x.name === name);
      if (b) b.amount = amt;
      else balances.push({ name, amount: amt, secondsSince: 0, secondsPerUnit: 0, maxAmount: 0, lastGiven: new Date() });
    };

    const updates = {};
    if (zeroAll) {
      for (const b of balances) b.amount = 0;
      updates.passTokens = 0;
    } else {
      if (gems !== undefined) setBal("gems", Number(gems) || 0);
      if (coins !== undefined) setBal("coins", Number(coins) || 0);
      if (passTokens !== undefined) updates.passTokens = Number(passTokens) || 0;
    }
    updates.balances = balances;

    await database.updateUser({ deviceId: user.deviceId }, updates);
    res.json({
      ok: true,
      target: user.username,
      gems: (balances.find(b => b.name === "gems") || {}).amount,
      coins: (balances.find(b => b.name === "coins") || {}).amount,
      passTokens: updates.passTokens
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/settag", requireAdmin, async (req, res) => {
  try {
    const { target, tag, color } = req.body || {};
    const user = await findUser(target);
    if (!user) return res.status(404).json({ error: "user not found: " + target });
    const clean = sanitizeTag(tag);
    const cleanColor = sanitizeColor(color);
    await database.updateUser({ deviceId: user.deviceId }, { nameTag: clean, nameTagColor: cleanColor });
    res.json({ ok: true, target: user.username, tag: clean, color: cleanColor });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/ban", requireAdmin, async (req, res) => {
  try {
    const { target, type = "full", reason = "" } = req.body || {};
    const user = await findUser(target);
    if (!user) return res.status(404).json({ error: "user not found" });

    if ((user.role || "player") === "dev") {
      return res.status(403).json({ error: "cannot ban a dev" });
    }

    const set = type === "full" ? { isBanned: true } : { shadowBanned: true };
    set.banReason = String(reason || "");
    set.bannedAt = new Date().toISOString();
    await database.updateUser({ deviceId: user.deviceId }, set);

    try { if (type === "full" && user.deviceId) UserController.bannedDevices.set(user.deviceId, { until: Date.now() + 3650 * 24 * 60 * 60 * 1000, bannedAt: Date.now() }); } catch (e) {}
    res.json({ ok: true, target: user.username, deviceId: user.deviceId, type, reason: set.banReason });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/unban", requireAdmin, async (req, res) => {
  try {
    const target = (req.body || {}).target;
    const user = await findUser(target);
    if (!user) return res.status(404).json({ error: "user not found: " + target });

    await database.updateUser(
      { deviceId: user.deviceId },
      { isBanned: false, shadowBanned: false, banReason: "", bannedAt: null, hwids: [] }
    );

    try { if (user.deviceId) UserController.bannedDevices.delete(user.deviceId); } catch (e) {}

    res.json({ ok: true, target: user.username, deviceId: user.deviceId, unbanned: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/resetcurrency", requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};

    const DEFAULT_NAMES = [
      "gems", "hard_currency", "hard", "premium_currency",
      "dust", "dust_backup", "stumble_tokens", "stumble_token", "tokens",
      "soft_currency", "soft", "coins", "coin", "stumble_coins"
    ];
    const names = (typeof body.names === "string" && body.names.trim())
      ? body.names.split(",").map(s => s.trim()).filter(Boolean)
      : DEFAULT_NAMES;
    const all = await database.collections.Users.find({}).toArray();
    let updated = 0;
    const details = [];
    for (const u of all) {
      const balances = Array.isArray(u.balances) ? u.balances : [];
      const zeroedHere = [];
      for (const b of balances) {
        if (b && names.includes(b.name) && b.amount !== 0) {
          zeroedHere.push({ name: b.name, was: b.amount });
          b.amount = 0;
        }
      }
      if (zeroedHere.length) {
        await database.updateUser({ stumbleId: u.stumbleId }, { balances });
        updated++;
        details.push({ user: u.username || u.stumbleId || u.deviceId, zeroed: zeroedHere });
      }
    }
    res.json({ ok: true, names, usersScanned: all.length, usersUpdated: updated, details });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/duplicates", requireAdmin, async (req, res) => {
  try {
    const users = await database.collections.Users.find({}).toArray();
    const byDevice = {};
    for (const u of users) {
      const k = u.deviceId || "";
      if (!k) continue;
      (byDevice[k] = byDevice[k] || []).push({ username: u.username || "", stumbleId: u.stumbleId || "", role: u.role || "player" });
    }
    const dupes = Object.entries(byDevice)
      .filter(([, rows]) => rows.length > 1)
      .map(([deviceId, rows]) => ({ deviceId, rows }));
    res.json({ total: users.length, duplicateDeviceIds: dupes.length, dupes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/createuser", requireAdmin, async (req, res) => {
  try {
    const { deviceId, username, role, nameColor, badgeText, badgeColor, nameTag, nameTagColor } = req.body || {};
    if (!deviceId || !username) return res.status(400).json({ error: "deviceId and username are required" });

    const existing = await UserModel.findByDeviceId(deviceId);
    if (existing) return res.status(409).json({ error: "a user already has that deviceId: " + existing.username });

    const created = await UserModel.create(req.ip, deviceId, { Version: "0.64" });

    const ZERO = ["gems", "dust", "coins", "tournament_ticket_rare", "tournament_ticket_legendary"];
    const balances = (created.balances || []).map(b => (ZERO.includes(b.name) ? { ...b, amount: 0 } : b));

    const updates = {
      username,
      "userProfile.userName": username,
      role: VALID_ROLES.includes(role) ? role : "player",
      balances,
      crowns: 0,
      skillRating: 0,
      tournamentSeasons: [{ seasonId: 1, xp: 0, claimedAwards: [] }],
      nameColor: sanitizeHexOrEmpty(nameColor),
      badgeText: sanitizeBadgeText(badgeText),
      badgeColor: sanitizeHexOrEmpty(badgeColor),
      badgeEnabled: !!(badgeText && String(badgeText).trim()),
      nameTag: sanitizeTag(nameTag),
      nameTagColor: nameTagColor ? sanitizeColor(nameTagColor) : "",
    };
    updates["userProfile.crowns"] = 0;
    updates["userProfile.trophies"] = 0;

    await database.updateUser({ deviceId }, updates);
    const user = await UserModel.findByDeviceId(deviceId);
    console.log(`[Admin] created account '${username}' (deviceId ${deviceId}, role ${updates.role})`);

    res.json({
      created: true, username, deviceId, stumbleId: user.stumbleId || "", role: updates.role,
      nameColor: updates.nameColor, badgeText: updates.badgeText, badgeColor: updates.badgeColor,
      gems: (user.balances || []).find(b => b.name === "gems")?.amount ?? null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/deleteuser", requireAdmin, async (req, res) => {
  try {
    const { username, confirm } = req.body || {};
    if (!username) return res.status(400).json({ error: "username is required" });
    if (confirm !== true) return res.status(400).json({ error: "confirm:true is required" });

    const user = await database.getUserByQuery({ username });
    if (!user) return res.status(404).json({ error: "user not found: " + username });

    await database.collections.Users.deleteOne({ username });
    console.log(`[Admin] deleted account '${username}' (deviceId ${user.deviceId}, role ${user.role || "player"})`);
    res.json({ deleted: true, username, deviceId: user.deviceId || "", stumbleId: user.stumbleId || "" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/find", requireAdmin, async (req, res) => {
  try {
    const target = (req.body || {}).target;
    const user = await findUser(target);
    if (!user) return res.status(404).json({ found: false, error: "user not found: " + target });
    res.json({
      found: true,
      username: user.username || "",

      id: user.id,
      idFitsInt32: Number.isInteger(Number(user.id)) && Number(user.id) > 0 && Number(user.id) <= 2147483647,
      deviceId: user.deviceId || "",
      stumbleId: user.stumbleId || "",
      role: user.role || "player",
      banned: !!user.isBanned,
      shadowBanned: !!user.shadowBanned,
      banReason: user.banReason || "",

      balances: (user.balances || []).map(b => ({ name: b.name, amount: b.amount })),
      tournamentSeasons: user.tournamentSeasons || [],
      crowns: user.crowns || 0,

      nameTag: user.nameTag || "",
      nameTagColor: user.nameTagColor || "",
      nameColor: user.nameColor || "",
      badgeText: user.badgeText || "",
      badgeEnabled: !!user.badgeEnabled,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/creatorcode/add", requireAdmin, async (req, res) => {
  try {
    const { code, creatorName, reward } = req.body || {};
    if (!code) return res.status(400).json({ error: "code required" });
    await database.collections.CreatorCodes.updateOne(
      { creatorCode: code },
      { $set: { creatorCode: code, creatorName: creatorName || code, reward: Number(reward) || 1000 } },
      { upsert: true }
    );
    res.json({ ok: true, code, creatorName: creatorName || code, reward: Number(reward) || 1000 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/creatorcode/remove", requireAdmin, async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: "code required" });
    await database.collections.CreatorCodes.deleteOne({ creatorCode: code });
    res.json({ ok: true, removed: code });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/creatorcode/list", requireAdmin, async (req, res) => {
  try {
    const rows = await database.collections.CreatorCodes.find({}).toArray();
    res.json({ count: rows.length, codes: rows.map((c) => ({ creatorCode: c.creatorCode, creatorName: c.creatorName, reward: c.reward })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/roles", requireAdmin, async (req, res) => {
  try {
    const all = await database.collections.Users.find({}).toArray();
    const withRole = all
      .filter((u) => (u.role && u.role !== "player") || u.shadowBanned || u.isBanned)
      .map((u) => ({ username: u.username, deviceId: u.deviceId, stumbleId: u.stumbleId, role: u.role || "player", shadowBanned: !!u.shadowBanned, banned: !!u.isBanned }));
    res.json({ count: withRole.length, users: withRole });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
