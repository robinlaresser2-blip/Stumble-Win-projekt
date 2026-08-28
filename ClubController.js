const crypto = require("crypto");
const { database } = require("./BackendUtils");

const MAX_MEMBERS = 50;
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 24;
const MAX_DESCRIPTION_LENGTH = 120;

function cleanText(value, maxLength) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function createClubId() {
  return crypto.randomBytes(8).toString("hex");
}

function publicClub(club) {
  if (!club) return null;

  return {
    id: club.id,
    name: club.name,
    description: club.description || "",
    ownerId: club.ownerId,
    ownerName: club.ownerName,
    memberCount: Array.isArray(club.members) ? club.members.length : 0,
    maxMembers: club.maxMembers || MAX_MEMBERS,
    level: club.level || 1,
    xp: club.xp || 0,
    createdAt: club.createdAt,
    updatedAt: club.updatedAt
  };
}

function publicMember(member) {
  return {
    userId: member.userId,
    username: member.username,
    role: member.role,
    joinedAt: member.joinedAt
  };
}

class ClubController {

  // ============================================
  // CREATE CLUB
  // ============================================

  static async create(req, res) {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "not authenticated"
        });
      }

      const name = cleanText(req.body?.name, MAX_NAME_LENGTH);
      const description = cleanText(
        req.body?.description,
        MAX_DESCRIPTION_LENGTH
      );

      if (!name || name.length < MIN_NAME_LENGTH) {
        return res.status(400).json({
          success: false,
          message: `club name must be at least ${MIN_NAME_LENGTH} characters`
        });
      }

      // Prüfen, ob der Name bereits existiert
      const existingClub =
        await database.collections.Clubs.findOne({
          nameLower: name.toLowerCase()
        });

      if (existingClub) {
        return res.status(409).json({
          success: false,
          message: "club name already exists"
        });
      }

      // Prüfen, ob Spieler bereits in einem Club ist
      const existingMembership =
        await database.collections.Clubs.findOne({
          "members.userId": user.stumbleId
        });

      if (existingMembership) {
        return res.status(409).json({
          success: false,
          message: "you are already in a club",
          club: publicClub(existingMembership)
        });
      }

      const now = new Date();

      const club = {
        id: createClubId(),

        name,
        nameLower: name.toLowerCase(),
        description,

        ownerId: user.stumbleId,
        ownerName: user.username,

        maxMembers: MAX_MEMBERS,

        level: 1,
        xp: 0,

        members: [
          {
            userId: user.stumbleId,
            username: user.username,
            role: "owner",
            joinedAt: now
          }
        ],

        createdAt: now,
        updatedAt: now
      };

      await database.collections.Clubs.insertOne(club);

      console.log(
        `[Clubs] ${user.username} created club "${name}"`
      );

      return res.status(201).json({
        success: true,
        message: "club created",
        club: publicClub(club)
      });

    } catch (err) {
      console.error("[Clubs] Create error:", err);

      return res.status(500).json({
        success: false,
        message: "internal server error"
      });
    }
  }


  // ============================================
  // SEARCH CLUBS
  // ============================================

  static async search(req, res) {
    try {
      const query = cleanText(req.body?.query, MAX_NAME_LENGTH);

      if (!query) {
        return res.status(400).json({
          success: false,
          message: "query is required"
        });
      }

      const regex = new RegExp(
        query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );

      const clubs = await database.collections.Clubs
        .find({
          name: { $regex: regex }
        })
        .sort({
          memberCount: -1,
          createdAt: -1
        })
        .limit(20)
        .toArray();

      return res.status(200).json({
        success: true,
        clubs: clubs.map(publicClub)
      });

    } catch (err) {
      console.error("[Clubs] Search error:", err);

      return res.status(500).json({
        success: false,
        message: "internal server error"
      });
    }
  }


  // ============================================
  // GET CLUB
  // ============================================

  static async get(req, res) {
    try {
      const clubId = String(req.params.id || "").trim();

      if (!clubId) {
        return res.status(400).json({
          success: false,
          message: "club id is required"
        });
      }

      const club =
        await database.collections.Clubs.findOne({
          id: clubId
        });

      if (!club) {
        return res.status(404).json({
          success: false,
          message: "club not found"
        });
      }

      return res.status(200).json({
        success: true,
        club: publicClub(club)
      });

    } catch (err) {
      console.error("[Clubs] Get error:", err);

      return res.status(500).json({
        success: false,
        message: "internal server error"
      });
    }
  }


  // ============================================
  // GET MEMBERS
  // ============================================

  static async members(req, res) {
    try {
      const clubId = String(req.params.id || "").trim();

      const club =
        await database.collections.Clubs.findOne({
          id: clubId
        });

      if (!club) {
        return res.status(404).json({
          success: false,
          message: "club not found"
        });
      }

      const members = Array.isArray(club.members)
        ? club.members.map(publicMember)
        : [];

      return res.status(200).json({
        success: true,
        clubId: club.id,
        members
      });

    } catch (err) {
      console.error("[Clubs] Members error:", err);

      return res.status(500).json({
        success: false,
        message: "internal server error"
      });
    }
  }


  // ============================================
  // JOIN CLUB
  // ============================================

  static async join(req, res) {
    try {
      const user = req.user;
      const clubId = String(req.body?.clubId || "").trim();

      if (!clubId) {
        return res.status(400).json({
          success: false,
          message: "clubId is required"
        });
      }

      // Bereits in einem Club?
      const currentClub =
        await database.collections.Clubs.findOne({
          "members.userId": user.stumbleId
        });

      if (currentClub) {
        return res.status(409).json({
          success: false,
          message: "you are already in a club",
          club: publicClub(currentClub)
        });
      }

      const club =
        await database.collections.Clubs.findOne({
          id: clubId
        });

      if (!club) {
        return res.status(404).json({
          success: false,
          message: "club not found"
        });
      }

      const members = Array.isArray(club.members)
        ? club.members
        : [];

      if (members.length >= (club.maxMembers || MAX_MEMBERS)) {
        return res.status(409).json({
          success: false,
          message: "club is full"
        });
      }

      if (
        members.some(
          member => member.userId === user.stumbleId
        )
      ) {
        return res.status(409).json({
          success: false,
          message: "already a member"
        });
      }

      const now = new Date();

      const member = {
        userId: user.stumbleId,
        username: user.username,
        role: "member",
        joinedAt: now
      };

      const result =
        await database.collections.Clubs.updateOne(
          {
            id: clubId,
            "members.userId": {
              $ne: user.stumbleId
            },
            $expr: {
              $lt: [
                { $size: "$members" },
                { $ifNull: ["$maxMembers", MAX_MEMBERS] }
              ]
            }
          },
          {
            $push: {
              members: member
            },
            $set: {
              updatedAt: now
            }
          }
        );

      if (result.modifiedCount === 0) {
        return res.status(409).json({
          success: false,
          message: "could not join club"
        });
      }

      const updatedClub =
        await database.collections.Clubs.findOne({
          id: clubId
        });

      console.log(
        `[Clubs] ${user.username} joined "${updatedClub.name}"`
      );

      return res.status(200).json({
        success: true,
        message: "joined club",
        club: publicClub(updatedClub)
      });

    } catch (err) {
      console.error("[Clubs] Join error:", err);

      return res.status(500).json({
        success: false,
        message: "internal server error"
      });
    }
  }


  // ============================================
  // LEAVE CLUB
  // ============================================

  static async leave(req, res) {
    try {
      const user = req.user;

      const club =
        await database.collections.Clubs.findOne({
          "members.userId": user.stumbleId
        });

      if (!club) {
        return res.status(404).json({
          success: false,
          message: "you are not in a club"
        });
      }

      if (club.ownerId === user.stumbleId) {
        return res.status(400).json({
          success: false,
          message: "owner cannot leave the club. Transfer ownership or delete the club first."
        });
      }

      const result =
        await database.collections.Clubs.updateOne(
          {
            id: club.id
          },
          {
            $pull: {
              members: {
                userId: user.stumbleId
              }
            },
            $set: {
              updatedAt: new Date()
            }
          }
        );

      if (result.modifiedCount === 0) {
        return res.status(400).json({
          success: false,
          message: "could not leave club"
        });
      }

      console.log(
        `[Clubs] ${user.username} left "${club.name}"`
      );

      return res.status(200).json({
        success: true,
        message: "left club"
      });

    } catch (err) {
      console.error("[Clubs] Leave error:", err);

      return res.status(500).json({
        success: false,
        message: "internal server error"
      });
    }
  }


  // ============================================
  // MY CLUB
  // ============================================

  static async mine(req, res) {
    try {
      const user = req.user;

      const club =
        await database.collections.Clubs.findOne({
          "members.userId": user.stumbleId
        });

      if (!club) {
        return res.status(404).json({
          success: false,
          message: "you are not in a club"
        });
      }

      return res.status(200).json({
        success: true,
        club: publicClub(club)
      });

    } catch (err) {
      console.error("[Clubs] Mine error:", err);

      return res.status(500).json({
        success: false,
        message: "internal server error"
      });
    }
  }


  // ============================================
  // UPDATE CLUB
  // ============================================

  static async update(req, res) {
    try {
      const user = req.user;
      const clubId = String(req.params.id || "").trim();

      const club =
        await database.collections.Clubs.findOne({
          id: clubId
        });

      if (!club) {
        return res.status(404).json({
          success: false,
          message: "club not found"
        });
      }

      if (club.ownerId !== user.stumbleId) {
        return res.status(403).json({
          success: false,
          message: "only the owner can edit the club"
        });
      }

      const updates = {};

      if (req.body?.name !== undefined) {
        const name = cleanText(
          req.body.name,
          MAX_NAME_LENGTH
        );

        if (name.length < MIN_NAME_LENGTH) {
          return res.status(400).json({
            success: false,
            message: "invalid club name"
          });
        }

        const duplicate =
          await database.collections.Clubs.findOne({
            nameLower: name.toLowerCase(),
            id: { $ne: clubId }
          });

        if (duplicate) {
          return res.status(409).json({
            success: false,
            message: "club name already exists"
          });
        }

        updates.name = name;
        updates.nameLower = name.toLowerCase();
      }

      if (req.body?.description !== undefined) {
        updates.description = cleanText(
          req.body.description,
          MAX_DESCRIPTION_LENGTH
        );
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          success: false,
          message: "nothing to update"
        });
      }

      updates.updatedAt = new Date();

      await database.collections.Clubs.updateOne(
        { id: clubId },
        { $set: updates }
      );

      const updatedClub =
        await database.collections.Clubs.findOne({
          id: clubId
        });

      return res.status(200).json({
        success: true,
        message: "club updated",
        club: publicClub(updatedClub)
      });

    } catch (err) {
      console.error("[Clubs] Update error:", err);

      return res.status(500).json({
        success: false,
        message: "internal server error"
      });
    }
  }


  // ============================================
  // DELETE CLUB
  // ============================================

  static async remove(req, res) {
    try {
      const user = req.user;
      const clubId = String(req.params.id || "").trim();

      const club =
        await database.collections.Clubs.findOne({
          id: clubId
        });

      if (!club) {
        return res.status(404).json({
          success: false,
          message: "club not found"
        });
      }

      if (club.ownerId !== user.stumbleId) {
        return res.status(403).json({
          success: false,
          message: "only the owner can delete the club"
        });
      }

      await database.collections.Clubs.deleteOne({
        id: clubId
      });

      console.log(
        `[Clubs] ${user.username} deleted "${club.name}"`
      );

      return res.status(200).json({
        success: true,
        message: "club deleted"
      });

    } catch (err) {
      console.error("[Clubs] Delete error:", err);

      return res.status(500).json({
        success: false,
        message: "internal server error"
      });
    }
  }
}

module.exports = ClubController;
