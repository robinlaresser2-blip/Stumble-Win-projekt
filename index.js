require("dotenv").config();
const crypto = require("crypto");
const https = require("https");
const express = require("express");
const rateLimit = require("express-rate-limit");
const Console = require("./ConsoleUtils");
const CryptoUtils = require("./CryptoUtils");
const SharedUtils = require("./SharedUtils");
const ClubController = require("./ClubController");

const {
  BackendUtils,
  database,
  UserModel,
  UserController,
  RoundController,
  BattlePassController,
  EconomyController,
  AnalyticsController,
  FriendsController,
  NewsController,
  MissionsController,
  TournamentXController,
  MatchmakingController,
  TournamentController,
  SocialController,
  EventsController,
  CreatorCodeController,
  authenticate,
  errorControll,
  sendShared,
  OnlineCheck,
  VerifyPhoton,
  getAppId
} = require("./BackendUtils");

const app = express();
const Title = "StumbleShadow Backend " + process.env.version;
const PORT = process.env.PORT || 8080;

app.head("/health", (req, res) => res.status(200).end());

app.get("/health", (req, res) => res.status(200).json({
  ok: true,
  uptime: Math.round(process.uptime()),
  ts: new Date().toISOString(),
}));

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests, slow down."
}));

app.use(express.json());

const _diagReqs = [];

const DIAG_MAX_ENTRIES = 300;
const DIAG_MAX_BODY = 2000;
const DIAG_MAX_RESP = 8000;

function nullPaths(value, prefix, out, depth) {
  if (out.length >= 40 || depth > 2 || value === undefined) return out;

  if (value === null) {
    out.push(prefix || "<root>");
    return out;
  }

  if (typeof value !== "object") return out;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length && i < 5; i++) {
      nullPaths(
        value[i],
        `${prefix}[${i}]`,
        out,
        depth + 1
      );
    }

    return out;
  }

  for (const k of Object.keys(value)) {
    nullPaths(
      value[k],
      prefix ? `${prefix}.${k}` : k,
      out,
      depth + 1
    );
  }

  return out;
}

app.use((req, res, next) => {
  try {
    const started = Date.now();

    const entry = {
      t: new Date().toISOString(),
      m: req.method,
      url: req.originalUrl,
      ct: req.headers["content-type"] || "",
      body:
        req.body && Object.keys(req.body).length
          ? JSON.stringify(req.body).slice(0, DIAG_MAX_BODY)
          : "",
      status: 0,
      ms: 0,
      resp: "",
      nulls: [],
      err: "",
    };

    req._diag = entry;

    _diagReqs.push(entry);

    if (_diagReqs.length > DIAG_MAX_ENTRIES) {
      _diagReqs.shift();
    }

    res.on("finish", () => {
      try {
        entry.status = res.statusCode;
        entry.ms = Date.now() - started;
      } catch (e) {}
    });

    res.on("close", () => {
      try {
        if (!entry.status) {
          entry.status = -1;
          entry.err = "client closed";
          entry.ms = Date.now() - started;
        }
      } catch (e) {}
    });

    const sendJson = res.json.bind(res);

    res.json = (payload) => {
      try {
        entry.resp = JSON.stringify(payload).slice(0, DIAG_MAX_RESP);
        entry.nulls = nullPaths(payload, "", [], 0);
      } catch (e) {
        entry.resp =
          "<unserialisable: " + e.message + ">";
      }

      return sendJson(payload);
    };

    const sendRaw = res.send.bind(res);

    res.send = (payload) => {
      try {
        if (!entry.resp) {
          entry.resp = (
            typeof payload === "string"
              ? payload
              : JSON.stringify(payload)
          ).slice(0, DIAG_MAX_RESP);
        }
      } catch (e) {}

      return sendRaw(payload);
    };

  } catch (e) {}

  next();
});

const _diagNotes = [];

app.post("/debug/note", (req, res) => {
  try {
    const { who, text } = req.body || {};

    _diagNotes.push({
      t: new Date().toISOString(),
      who: String(who || "?").slice(0, 80),
      text: String(text || "").slice(0, 500),
    });

    if (_diagNotes.length > 400) {
      _diagNotes.shift();
    }

  } catch (e) {}

  res.status(200).json({ ok: true });
});

function requireAdminKey(req, res, next) {
  const key =
    req.headers["x-api-key"] || req.query.key;

  if (
    !process.env.ADMIN_API_KEY ||
    key !== process.env.ADMIN_API_KEY
  ) {
    return res.status(403).json({
      error: "forbidden"
    });
  }

  next();
}

app.get("/debug/requests", requireAdminKey, (req, res) => {
  let rows = _diagReqs;

  if (req.query.url) {
    rows = rows.filter(
      x => x.url.includes(String(req.query.url))
    );
  }

  if (req.query.since) {
    rows = rows.filter(
      x => x.t >= String(req.query.since)
    );
  }

  if (req.query.status) {
    rows = rows.filter(
      x => String(x.status) === String(req.query.status)
    );
  }

  const limit = Math.max(
    1,
    Math.min(
      300,
      parseInt(req.query.limit) || 50
    )
  );

  rows = rows.slice(-limit);

  if (req.query.slim) {
    rows = rows.map(
      ({ t, m, url, status, ms, nulls }) => ({
        t,
        m,
        url,
        status,
        ms,
        nulls
      })
    );
  }

  res.status(200).json({
    total: _diagReqs.length,
    returned: rows.length,
    reqs: rows
  });
});

app.get("/debug/clear", requireAdminKey, (req, res) => {
  _diagReqs.length = 0;
  res.status(200).send("cleared");
});

app.get("/debug/notes", requireAdminKey, (req, res) => {
  const limit = Math.max(
    1,
    Math.min(
      400,
      parseInt(req.query.limit) || 100
    )
  );

  res.status(200).json({
    total: _diagNotes.length,
    notes: _diagNotes.slice(-limit)
  });
});

app.get("/debug/notes/clear", requireAdminKey, (req, res) => {
  _diagNotes.length = 0;
  res.status(200).send("cleared");
});

app.use(require("./RolesModule"));

app.get("/shared", sendShared);

const ASSETS_REPO =
  process.env.ASSETS_REPO ||
  "ccperfectshot11/StumbleGuysCache";

app.get("/assets/manifest", async (req, res) => {
  try {
    if (!process.env.GITHUB_TOKEN) {
      return res.status(503).json({
        error: "assets not configured"
      });
    }

    const headers = {
      Authorization:
        `Bearer ${process.env.GITHUB_TOKEN}`,
      "User-Agent": "StumbleShadow",
      Accept:
        "application/vnd.github+json",
    };

    const relRes = await fetch(
      `https://api.github.com/repos/${ASSETS_REPO}/releases/latest`,
      { headers }
    );

    if (!relRes.ok) {
      return res.status(502).json({
        error: `github ${relRes.status}`
      });
    }

    const release = await relRes.json();

    const asset =
      (release.assets || []).find(
        a => a.name.endsWith(".zip")
      );

    if (!asset) {
      return res.status(502).json({
        error: "no zip in latest release"
      });
    }

    const dl = await fetch(asset.url, {
      headers: {
        ...headers,
        Accept: "application/octet-stream"
      },
      redirect: "manual",
    });

    const url =
      dl.headers.get("location");

    if (!url) {
      return res.status(502).json({
        error: "no signed url"
      });
    }

    res.status(200).json({
      version: release.tag_name,
      url,
      sizeBytes: asset.size
    });

  } catch (err) {
    Console.error(
      "Assets",
      "manifest failed:",
      err
    );

    res.status(500).json({
      error: "manifest failed"
    });
  }
});

app.get(
  "/user/steampricesv2",
  (req, res) =>
    res.status(200).json({})
);

app.post("/party/update", (req, res) => {
  try {
    const {
      action,
      username,
      id,
      code
    } = req.body || {};

    console.log(
      `[Party] ${username || "?"} (${id || "?"}) ${
        action || "update"
      }${code ? " code=" + code : ""}`
    );

  } catch (e) {}

  res.status(200).send("OK");
});

const AC_IMMUNE_ROLES = [
  "dev",
  "owner"
];

async function isAntiCheatImmune(deviceId) {
  try {
    if (!deviceId) return false;

    const u =
      await UserModel.findByDeviceId(deviceId);

    return !!(
      u &&
      AC_IMMUNE_ROLES.includes(u.role)
    );

  } catch (e) {
    return false;
  }
}

app.post("/anticheat/report", async (req, res) => {
  try {
    const {
      stumbleId,
      deviceId,
      reason,
      key,
      hwids
    } = req.body || {};

    if (
      process.env.ACKey &&
      key !== process.env.ACKey
    ) {
      return res.status(403).json({
        error: "bad key"
      });
    }

    if (!stumbleId && !deviceId) {
      return res.status(400).json({
        error: "stumbleId or deviceId required"
      });
    }

    let user = null;

    if (stumbleId) {
      user =
        await UserModel.findByStumbleId(
          stumbleId
        );
    }

    if (!user && deviceId) {
      user =
        await UserModel.findByDeviceId(
          deviceId
        );
    }

    if (!user) {
      Console.log(
        "AntiCheat",
        `Report with no matching user (stumbleId=${stumbleId}, deviceId=${deviceId}, reason=${reason})`
      );

      return res.status(404).json({
        error: "user not found"
      });
    }

    if (
      await isAntiCheatImmune(user.deviceId)
    ) {
      Console.log(
        "AntiCheat",
        `IMMUNE (privileged) ${user.username} — report ignored (reason: ${reason || "?"})`
      );

      return res.status(200).json({
        status: "immune"
      });
    }

    await UserModel.update(
      user.stumbleId,
      {
        isBanned: true,
        banReason:
          `[AntiCheat] ${reason || "cheat detected"}`,
        bannedAt: new Date(),
      }
    );

    try {
      if (Array.isArray(hwids)) {
        for (const hw of hwids) {
          if (
            typeof hw === "string" &&
            hw.length > 0
          ) {
            await UserModel.addHwid(
              user.stumbleId,
              hw
            );
          }
        }
      }
    } catch (e) {}

    try {
      if (user.deviceId) {
        UserController.bannedDevices.set(
          user.deviceId,
          {
            until:
              Date.now() +
              3650 *
              24 *
              60 *
              60 *
              1000,
            bannedAt: Date.now()
          }
        );
      }
    } catch (e) {}

    Console.log(
      "AntiCheat",
      `BANNED ${user.username} (stumbleId=${user.stumbleId}) reason: ${reason || "?"}, hwids: ${Array.isArray(hwids) ? hwids.length : 0}`
    );

    return res.status(200).json({
      status: "banned"
    });

  } catch (err) {
    Console.error(
      "AntiCheat",
      "Error:",
      err
    );

    return res.status(500).json({
      error: "internal error"
    });
  }
});

app.post("/anticheat/check", async (req, res) => {
  try {
    const {
      stumbleId,
      deviceId,
      hwids,
      key
    } = req.body || {};

    if (
      process.env.ACKey &&
      key !== process.env.ACKey
    ) {
      return res.status(403).json({
        error: "bad key"
      });
    }

    if (stumbleId || deviceId) {
      let me = null;

      if (stumbleId) {
        me =
          await UserModel.findByStumbleId(
            stumbleId
          );
      }

      if (!me && deviceId) {
        me =
          await UserModel.findByDeviceId(
            deviceId
          );
      }

      if (
        me &&
        await isAntiCheatImmune(
          me.deviceId
        )
      ) {
        return res.status(200).json({
          banned: false,
          immune: true
        });
      }

      if (me && me.isBanned) {
        return res.status(200).json({
          banned: true,
          immune: false,
          reason:
            me.banReason || "Banned"
        });
      }
    }

    const bannedOwner =
      await UserModel.findBannedByHwids(hwids);

    if (bannedOwner) {
      Console.log(
        "AntiCheat",
        `Evasion detected: machine of banned ${bannedOwner.username} used by stumbleId=${stumbleId || "?"}`
      );

      if (stumbleId) {
        const me =
          await UserModel.findByStumbleId(
            stumbleId
          );

        if (me) {
          await UserModel.update(
            me.stumbleId,
            {
              isBanned: true,
              banReason:
                `[AntiCheat] evasion (shares hardware with ${bannedOwner.username})`,
              bannedAt: new Date(),
            }
          );

          try {
            if (Array.isArray(hwids)) {
              for (const hw of hwids) {
                if (
                  typeof hw === "string" &&
                  hw.length > 0
                ) {
                  await UserModel.addHwid(
                    me.stumbleId,
                    hw
                  );
                }
              }
            }
          } catch (e) {}

          try {
            if (me.deviceId) {
              UserController.bannedDevices.set(
                me.deviceId,
                {
                  until:
                    Date.now() +
                    3650 *
                    24 *
                    60 *
                    60 *
                    1000,
                  bannedAt: Date.now()
                }
              );
            }
          } catch (e) {}
        }
      }

      return res.status(200).json({
        banned: true,
        reason:
          `evasion (shares hardware with ${bannedOwner.username})`
      });
    }

    return res.status(200).json({
      banned: false,
      immune: false
    });

  } catch (err) {
    Console.error(
      "AntiCheat",
      "Error:",
      err
    );

    return res.status(200).json({
      banned: false,
      immune: false
    });
  }
});

app.use(authenticate);

// ============================================
// CLUB SYSTEM
// ============================================

app.post(
  "/clubs/create",
  ClubController.create
);

app.post(
  "/clubs/search",
  ClubController.search
);

app.get(
  "/clubs/:id",
  ClubController.get
);

app.get(
  "/clubs/:id/members",
  ClubController.members
);

app.post(
  "/clubs/join",
  ClubController.join
);

app.post(
  "/clubs/leave",
  ClubController.leave
);

app.get(
  "/clubs/me",
  ClubController.mine
);

app.patch(
  "/clubs/:id",
  ClubController.update
);

app.delete(
  "/clubs/:id",
  ClubController.remove
);

// ============================================
// PHOTON
// ============================================

app.post(
  "/photon/auth",
  VerifyPhoton
);

app.get(
  "/photon/auth",
  VerifyPhoton
);

app.get(
  "/photon/get",
  getAppId
);

app.get(
  "/onlinecheck",
  OnlineCheck
);

app.get(
  "/matchmaking/filter",
  MatchmakingController.getMatchmakingFilter
);

app.post(
  "/user/login",
  UserController.login
);

app.get(
  "/user/config",
  sendShared
);

app.get(
  "/usersettings",
  UserController.getSettings
);

app.post(
  "/user/updateusername",
  UserController.updateUsername
);

app.post(
  "/user/update",
  UserController.updateUsername
);

app.get(
  "/user/deleteaccount",
  UserController.deleteAccount
);

app.post(
  "/user/linkplatform",
  UserController.linkPlatform
);

app.post(
  "/user/unlinkplatform",
  UserController.unlinkPlatform
);

app.get(
  "/shared/:version/:type",
  sendShared
);

app.post(
  "/user/profile",
  UserController.getProfile
);

app.post(
  "/user-equipped-cosmetics/update",
  UserController.updateCosmetics
);

app.post(
  "/user/cosmetics/addskin",
  UserController.addSkin
);

app.post(
  "/user/cosmetics/setequipped",
  UserController.setEquippedCosmetic
);

app.post(
  "/user/inventory/selection",
  UserController.setEquippedCosmetic
);

app.get(
  "/economy/offers/purchasedV2/",
  (req, res) => res.status(200).json({})
);

app.get(
  "/cosmetic-sources-config",
  (req, res) => res.status(200).json([])
);

app.get(
  "/collection-events/me",
  (req, res) =>
    res.status(200).json({
      CollectionEvents: []
    })
);

function pusherConfigured(res) {
  if (
    process.env.PUSHER_KEY &&
    process.env.PUSHER_SECRET
  ) {
    return true;
  }

  res.status(503).json({
    error: "pusher not configured"
  });

  return false;
}

function pusherAuth(stringToSign) {
  const sig =
    crypto
      .createHmac(
        "sha256",
        process.env.PUSHER_SECRET
      )
      .update(stringToSign)
      .digest("hex");

  return `${process.env.PUSHER_KEY}:${sig}`;
}

function pusherTrigger(
  channel,
  event,
  data
) {
  return new Promise((resolve) => {
    const appId =
      process.env.PUSHER_APP_ID;

    const key =
      process.env.PUSHER_KEY;

    const secret =
      process.env.PUSHER_SECRET;

    const cluster =
      process.env.PUSHER_CLUSTER || "eu";

    if (
      !appId ||
      !key ||
      !secret
    ) {
      Console.error(
        "Pusher",
        "trigger skipped: PUSHER_APP_ID/KEY/SECRET not set"
      );

      _diagNotes.push({
        t: new Date().toISOString(),
        who: "pusher",
        text:
          `SKIP ${event}->${channel}: missing ${
            !appId ? "APP_ID " : ""
          }${!key ? "KEY " : ""}${
            !secret ? "SECRET" : ""
          }`
      });

      return resolve(false);
    }

    const body =
      JSON.stringify({
        name: event,
        channels: [channel],
        data: JSON.stringify(data)
      });

    const bodyMd5 =
      crypto
        .createHash("md5")
        .update(body)
        .digest("hex");

    const params = {
      auth_key: key,
      auth_timestamp:
        Math.floor(Date.now() / 1000),
      auth_version: "1.0",
      body_md5: bodyMd5,
    };

    const qs =
      Object.keys(params)
        .sort()
        .map(
          k =>
            `${k}=${params[k]}`
        )
        .join("&");

    const path =
      `/apps/${appId}/events`;

    const sig =
      crypto
        .createHmac(
          "sha256",
          secret
        )
        .update(
          `POST\n${path}\n${qs}`
        )
        .digest("hex");

    const req =
      https.request(
        {
          host:
            `api-${cluster}.pusher.com`,
          port: 443,
          method: "POST",
          path:
            `${path}?${qs}&auth_signature=${sig}`,
          headers: {
            "Content-Type":
              "application/json",
            "Content-Length":
              Buffer.byteLength(body)
          },
        },
        (res) => {
          let out = "";

          res.on(
            "data",
            c => (out += c)
          );

          res.on(
            "end",
            () => {
              _diagNotes.push({
                t:
                  new Date().toISOString(),
                who: "pusher",
                text:
                  `${event}->${channel} HTTP ${res.statusCode} ${String(out).slice(0, 120)}`
              });

              if (
                res.statusCode >= 200 &&
                res.statusCode < 300
              ) {
                resolve(true);
              } else {
                Console.error(
                  "Pusher",
                  `trigger ${event} -> HTTP ${res.statusCode}: ${out}`
                );

                resolve(false);
              }
            }
          );
        }
      );

    req.on(
      "error",
      (e) => {
        Console.error(
          "Pusher",
          `trigger ${event} error: ${e.message}`
        );

        _diagNotes.push({
          t:
            new Date().toISOString(),
          who: "pusher",
          text:
            `ERR ${event}->${channel}: ${e.message}`
        });

        resolve(false);
      }
    );

    req.write(body);
    req.end();
  });
}

app.post(
  "/pusher/authorize",
  (req, res) => {
    if (!pusherConfigured(res))
      return;

    const {
      channel_name,
      socket_id
    } = req.body || {};

    if (
      !channel_name ||
      !socket_id
    ) {
      return res.status(400).json({
        error:
          "missing channel_name or socket_id"
      });
    }

    if (
      channel_name !==
      `private-user-${req.user.id}`
    ) {
      return res.status(403).json({
        error: "not your channel"
      });
    }

    res.status(200).json({
      auth: pusherAuth(
        `${socket_id}:${channel_name}`
      )
    });
  }
);

app.post(
  "/pusher/authenticate",
  (req, res) => {
    if (!pusherConfigured(res))
      return;

    const {
      socket_id
    } = req.body || {};

    if (!socket_id) {
      return res.status(400).json({
        error:
          "missing socket_id"
      });
    }

    const userData =
      JSON.stringify({
        id: String(req.user.id)
      });

    res.status(200).json({
      auth: pusherAuth(
        `${socket_id}::user::${userData}`
      ),
      user_data: userData,
    });
  }
);

app.get(
  "/user/creator-codes",
  CreatorCodeController.getCreator
);

app.post(
  "/user/creator-codes",
  CreatorCodeController.support
);

app.delete(
  "/user/creator-codes",
  CreatorCodeController.stopSupport
);

app.delete(
  "/user/creator-codes/:code",
  CreatorCodeController.stopSupport
);

app.get(
  "/admin/creator-codes/list",
  CreatorCodeController.getList
);

app.post(
  "/friends/request/accept",
  FriendsController.add
);

app.delete(
  "/friends/:UserId",
  FriendsController.remove
);

app.get(
  "/friends",
  FriendsController.list
);

app.post(
  "/friends/search",
  FriendsController.search
);

app.post(
  "/friends/request",
  FriendsController.request
);

app.post(
  "/friends/accept",
  FriendsController.accept
);

app.post(
  "/friends/request/decline",
  FriendsController.reject
);

app.post(
  "/friends/cancel",
  FriendsController.cancel
);

app.get(
  "/friends/request",
  FriendsController.pending
);

app.post(
  "/friends/block",
  FriendsController.block
);

app.post(
  "/friends/unblock",
  FriendsController.unblock
);

app.post(
  "/party/invite",
  async (req, res) => {
    try {
      const sender = req.user;

      const {
        UserIds,
        PhotonAppId,
        PhotonRoomCode,
        PhotonRegion,
        EventId
      } = req.body || {};

      if (
        !Array.isArray(UserIds) ||
        UserIds.length === 0 ||
        !PhotonRoomCode
      ) {
        return res.status(400).json({
          error:
            "missing UserIds or PhotonRoomCode"
        });
      }

      const payload = {
        UserId: sender.id,
        RoomCode: PhotonRoomCode,
        PhotonRegion:
          PhotonRegion || "",
        PhotonAppId:
          PhotonAppId || "",
        PartyContext:
          EventId
            ? {
                "game-event-id":
                  EventId
              }
            : {},
      };

      await Promise.all(
        UserIds.map(
          targetId =>
            pusherTrigger(
              `private-user-${targetId}`,
              "stumble:v0:party_invite",
              payload
            )
        )
      );

      res.status(200).json({
        ok: true
      });

    } catch (err) {
      Console.error(
        "Party",
        "invite error:",
        err
      );

      res.status(500).json({
        error: "internal error"
      });
    }
  }
);

app.post(
  "/game/recently-played-with",
  (req, res) =>
    res.status(200).json({
      ok: true
    })
);

app.get(
  "/social/interactions",
  SocialController.getInteractions
);

app.get(
  "//social/interactions",
  SocialController.getInteractions
);

app.get(
  "/round/finish/:round",
  RoundController.finishRound
);

app.get(
  "/round/finishv2/:round",
  RoundController.finishRound
);

app.post(
  "/round/finish/v4/:round",
  RoundController.finishRoundV4
);

app.post(
  "/round/eventfinish/v4/:round",
  RoundController.finishRoundV4
);

app.get(
  "/battlepass",
  BattlePassController.getBattlePass
);

app.post(
  "/battlepass/claimv3",
  BattlePassController.claimReward
);

app.post(
  "/battlepass/purchase",
  BattlePassController.purchaseBattlePass
);

app.post(
  "/battlepass/complete",
  BattlePassController.completeBattlePass
);

app.get(
  "/economy/purchase/:item",
  EconomyController.purchase
);

app.get(
  "/economy/purchasegasha/:itemId/:count",
  EconomyController.purchaseGasha
);

app.get(
  "/economy/purchaseluckyspin",
  EconomyController.purchaseLuckySpin
);

app.get(
  "/economy/purchasedrop/:itemId/:count",
  EconomyController.purchaseLuckySpin
);

app.post(
  "/economy/:currencyType/give/:amount",
  EconomyController.giveCurrency
);

app.get(
  "/missions",
  MissionsController.getMissions
);

app.post(
  "/missions/:missionId/rewards/claim/v2",
  MissionsController.claimMissionReward
);

app.post(
  "/missions/objective/:objectiveId/:milestoneId/rewards/claim/v2",
  MissionsController.claimMilestoneReward
);

app.post(
  "/friends/request/accept",
  FriendsController.add
);

app.delete(
  "/friends/:UserId",
  FriendsController.remove
);

app.get(
  "/friends",
  FriendsController.list
);

app.post(
  "/friends/search",
  FriendsController.search
);

app.post(
  "/friends/request",
  FriendsController.request
);

app.post(
  "/friends/accept",
  FriendsController.accept
);

app.post(
  "/friends/request/decline",
  FriendsController.reject
);

app.post(
  "/friends/cancel",
  FriendsController.cancel
);

app.get(
  "/friends/request",
  FriendsController.pending
);

app.get(
  "/game-events/me",
  EventsController.getActive
);

app.get(
  "/news/getall",
  NewsController.GetNews
);

app.post(
  "/analytics",
  AnalyticsController.analytic
);

app.get(
  "/highscore/:type/list/",
  async (req, res, next) => {
    try {
      const {
        type
      } = req.params;

      const {
        start = 0,
        count = 100,
        country = "global"
      } = req.query;

      const startNum =
        parseInt(start, 10);

      const countNum =
        parseInt(count, 10);

      if (!type) {
        return res.status(400).json({
          error:
            "O tipo é necessário"
        });
      }

      if (
        isNaN(startNum) ||
        isNaN(countNum)
      ) {
        return res.status(400).json({
          error:
            "Os parâmetros start e count devem ser números"
        });
      }

      const result =
        await UserModel.GetHighscore(
          type,
          country,
          startNum,
          countNum
        );

      res.json(result);

    } catch (err) {
      next(err);
    }
  }
);

app.get(
  "/social/interactions",
  SocialController.getInteractions
);

app.get(
  "/tournamentx/active",
  TournamentXController.getActive
);

app.get(
  "/tournamentx/active/v2",
  TournamentXController.getActive
);

app.post(
  "/tournamentx/:tournamentId/join",
  TournamentXController.join
);

app.post(
  "/tournamentx/:tournamentId/join/v2",
  TournamentXController.join
);

app.post(
  "/tournamentx/:tournamentId/leave",
  TournamentXController.leave
);

app.post(
  "/tournamentx/:tournamentId/leave/v2",
  TournamentXController.leave
);

app.delete(
  "/tournamentx/:tournamentId/leave",
  TournamentXController.leave
);

app.get(
  "/tournamentx/seasons",
  TournamentXController.getSeasons
);

app.get(
  "/tournamentx/season/:seasonId/progress",
  TournamentXController.getSeasonProgress
);

app.post(
  "/tournamentx/season/:seasonId/claim/:awardId",
  TournamentXController.claimSeasonReward
);

app.post(
  "/round/tournament/finish/v2",
  TournamentXController.finish
);

app.get(
  "/api/v1/ping",
  async (req, res) => {
    res.status(200).send("OK");
  }
);

app.post(
  "/api/v1/userLoginExternal",
  TournamentController.login
);

app.get(
  "/api/v1/tournaments",
  TournamentController.getActive
);

app.get(
  "/round/finish/:round",
  RoundController.finishRound
);

app.get(
  "/round/finishv2/:round",
  RoundController.finishRound
);

app.post(
  "/round/finish/v4/:round?",
  RoundController.finishRoundV4
);

app.post(
  "/round/eventfinish/v4/:round?",
  RoundController.finishRoundV4
);

app.post(
  "/round/finish/v3/:country/:gameId/:userId",
  (req, res) => {
    req.params.round =
      req.body.Round;

    RoundController.finishRoundV4(
      req,
      res
    );
  }
);

app.get(
  "/economy/luckyspin",
  (req, res) =>
    EconomyController.getLuckySpin(
      req,
      res
    )
);

app.post(
  "/round/customroundfinish/:country/:gameId/:userId",
  RoundController.finishCustomRound
);

app.post(
  "//round/customroundfinish/:country/:gameId/:userId",
  RoundController.finishCustomRound
);

require("./ShopFix")(app);

app.use(
  (err, req, res, next) => {
    try {
      if (req._diag) {
        req._diag.err =
          String(
            (err && err.stack) ||
            err
          ).slice(0, 1500);
      }
    } catch (e) {}

    next(err);
  }
);

app.use(errorControll);

app.listen(
  PORT,
  () => {
    const currentDate =
      new Date()
        .toLocaleString()
        .replace(",", " |");

    console.clear();

    Console.log(
      "Server",
      `[${Title}] | ${currentDate} | ${CryptoUtils.SessionToken()}`
    );

    Console.log(
      "Server",
      `Listening on port ${PORT}`
    );
  }
);