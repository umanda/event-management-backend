const express = require("express");
const Participant = require("../models/Participant");
const { authenticateToken, requirePermission } = require("../middleware/auth");
const router = express.Router();

// Get dashboard statistics
router.get("/stats", authenticateToken, async (req, res) => {
  try {
    // Get basic counts
    const totalParticipants = await Participant.countDocuments();
    const presentParticipants = await Participant.countDocuments({
      isPresent: true,
    });
    const totalPlayers = await Participant.countDocuments({ isPlayer: true });
    const presentPlayers = await Participant.countDocuments({
      isPlayer: true,
      isPresent: true,
    });

    // Get all participants for detailed entitlement analysis
    const allParticipants = await Participant.find().select(
      "entitlements isPlayer isPresent"
    );

    // Calculate entitlement statistics
    const entitlementStats = {
      breakfast: calculateBooleanEntitlementStats(allParticipants, "breakfast"),
      lunch: calculateBooleanEntitlementStats(allParticipants, "lunch"),
      beer: calculateCountableEntitlementStats(allParticipants, "beer"), // Special handling for beer
      eveningMeal: calculateBooleanEntitlementStats(
        allParticipants,
        "eveningMeal"
      ),
      specialBeverage: calculateSpecialEntitlementStats(
        allParticipants,
        "specialBeverage"
      ),
      specialMeal: calculateSpecialEntitlementStats(
        allParticipants,
        "specialMeal"
      ),
    };

    // Get recent attendance (last 10)
    const recentAttendance = await Participant.find({ isPresent: true })
      .select("participantId name isPlayer attendanceTime")
      .sort({ attendanceTime: -1 })
      .limit(10);

    // Get recent distributions (participants with recent entitlements)
    const recentDistributions = await Participant.find({
      $or: [
        { "entitlements.breakfast.givenAt": { $exists: true } },
        { "entitlements.lunch.givenAt": { $exists: true } },
        { "entitlements.beer.givenAt.0": { $exists: true } },
        { "entitlements.eveningMeal.givenAt": { $exists: true } },
        { "entitlements.specialBeverage.givenAt": { $exists: true } },
        { "entitlements.specialMeal.givenAt": { $exists: true } },
      ],
    })
      .select("participantId name isPlayer entitlements")
      .sort({ "entitlements.lunch.givenAt": -1 })
      .limit(10)
      .populate(
        "entitlements.breakfast.givenBy entitlements.lunch.givenBy entitlements.beer.givenBy entitlements.eveningMeal.givenBy entitlements.specialBeverage.givenBy entitlements.specialMeal.givenBy",
        "username"
      );

    // Process recent distributions to show what was given
    const processedDistributions = recentDistributions
      .map((participant) => {
        const distributions = [];

        // Check each entitlement type
        if (participant.entitlements.breakfast.given) {
          distributions.push({
            type: "breakfast",
            givenAt: participant.entitlements.breakfast.givenAt,
            givenBy: participant.entitlements.breakfast.givenBy?.username,
          });
        }

        if (participant.entitlements.lunch.given) {
          distributions.push({
            type: "lunch",
            givenAt: participant.entitlements.lunch.givenAt,
            givenBy: participant.entitlements.lunch.givenBy?.username,
          });
        }

        // Special handling for beer (countable)
        if (participant.entitlements.beer.given > 0) {
          const beerCount = participant.entitlements.beer.given;
          const lastBeerTime =
            participant.entitlements.beer.givenAt[
              participant.entitlements.beer.givenAt.length - 1
            ];
          const lastBeerGiver =
            participant.entitlements.beer.givenBy[
              participant.entitlements.beer.givenBy.length - 1
            ];

          distributions.push({
            type: "beer",
            count: beerCount,
            givenAt: lastBeerTime,
            givenBy: lastBeerGiver?.username,
          });
        }

        if (participant.entitlements.eveningMeal?.given) {
          distributions.push({
            type: "eveningMeal",
            givenAt: participant.entitlements.eveningMeal.givenAt,
            givenBy: participant.entitlements.eveningMeal.givenBy?.username,
          });
        }

        if (participant.entitlements.specialBeverage?.given) {
          distributions.push({
            type: "specialBeverage",
            givenAt: participant.entitlements.specialBeverage.givenAt,
            givenBy: participant.entitlements.specialBeverage.givenBy?.username,
          });
        }

        if (participant.entitlements.specialMeal?.given) {
          distributions.push({
            type: "specialMeal",
            givenAt: participant.entitlements.specialMeal.givenAt,
            givenBy: participant.entitlements.specialMeal.givenBy?.username,
          });
        }

        return {
          participantId: participant.participantId,
          name: participant.name,
          isPlayer: participant.isPlayer,
          distributions: distributions.sort(
            (a, b) => new Date(b.givenAt) - new Date(a.givenAt)
          ),
        };
      })
      .filter((p) => p.distributions.length > 0);

    res.json({
      success: true,
      stats: {
        totalParticipants,
        presentParticipants,
        totalPlayers,
        presentPlayers,
        entitlementStats,
        recentAttendance,
        recentDistributions: processedDistributions.slice(0, 10),
        lastUpdated: new Date(),
      },
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching dashboard statistics",
    });
  }
});

// Helper function for boolean entitlements (breakfast, lunch, eveningMeal)
function calculateBooleanEntitlementStats(participants, entitlementType) {
  const eligible = participants.filter((p) => p.entitlements[entitlementType]);
  const given = eligible.filter((p) => p.entitlements[entitlementType].given);
  const pending = eligible.filter(
    (p) => !p.entitlements[entitlementType].given && p.isPresent
  );

  return {
    given: given.length,
    pending: pending.length,
    totalEligible: eligible.length,
    percentage:
      eligible.length > 0
        ? Math.round((given.length / eligible.length) * 100)
        : 0,
  };
}

// Helper function for countable entitlements (beer)
function calculateCountableEntitlementStats(participants, entitlementType) {
  const eligible = participants.filter((p) => p.entitlements[entitlementType]);
  const givenParticipants = eligible.filter(
    (p) => p.entitlements[entitlementType].given > 0
  );
  const pendingParticipants = eligible.filter(
    (p) => p.entitlements[entitlementType].given === 0 && p.isPresent
  );

  // Calculate total beer count given
  const totalBeerGiven = eligible.reduce(
    (sum, p) => sum + (p.entitlements[entitlementType].given || 0),
    0
  );

  return {
    given: givenParticipants.length, // Number of participants who received beer
    pending: pendingParticipants.length, // Number of present participants who haven't received beer
    totalEligible: eligible.length,
    percentage:
      eligible.length > 0
        ? Math.round((givenParticipants.length / eligible.length) * 100)
        : 0,
    totalCountGiven: totalBeerGiven, // Additional field showing total beer count
  };
}

// Helper function for special entitlements (only for players)
function calculateSpecialEntitlementStats(participants, entitlementType) {
  const eligible = participants.filter(
    (p) => p.isPlayer && p.entitlements[entitlementType]
  );
  const given = eligible.filter((p) => p.entitlements[entitlementType].given);
  const pending = eligible.filter(
    (p) => !p.entitlements[entitlementType].given && p.isPresent
  );

  return {
    given: given.length,
    pending: pending.length,
    totalEligible: eligible.length,
    percentage:
      eligible.length > 0
        ? Math.round((given.length / eligible.length) * 100)
        : 0,
  };
}

// Get participants with filters and search
router.get("/participants", authenticateToken, async (req, res) => {
  try {
    const {
      limit = 20,
      page = 1,
      isPresent,
      isPlayer,
      foodPreference,
      search,
    } = req.query;

    let filter = {};

    if (isPresent !== undefined) {
      filter.isPresent = isPresent === "true";
    }

    if (isPlayer !== undefined) {
      filter.isPlayer = isPlayer === "true";
    }

    if (foodPreference) {
      filter.foodPreference = foodPreference;
    }

    // Add search functionality
    if (search) {
      const searchRegex = new RegExp(search, "i");
      filter.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { participantId: searchRegex },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const participants = await Participant.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select(
        "participantId name email isPlayer isPresent attendanceTime foodPreference entitlements"
      )
      .populate("attendanceMarkedBy", "username");

    const total = await Participant.countDocuments(filter);

    res.json({
      success: true,
      participants,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get dashboard participants error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching participants",
    });
  }
});

// Get entitlement summary by type
router.get(
  "/entitlements/:entitlementType",
  authenticateToken,
  async (req, res) => {
    try {
      const { entitlementType } = req.params;
      const validTypes = [
        "breakfast",
        "lunch",
        "beer",
        "eveningMeal",
        "specialBeverage",
        "specialMeal",
      ];

      if (!validTypes.includes(entitlementType)) {
        return res.status(400).json({
          success: false,
          message: "Invalid entitlement type",
        });
      }

      let participants;

      if (
        entitlementType === "specialBeverage" ||
        entitlementType === "specialMeal"
      ) {
        // Special entitlements only for players
        participants = await Participant.find({
          isPlayer: true,
          [`entitlements.${entitlementType}`]: { $exists: true },
        })
          .select(
            `participantId name email isPresent entitlements.${entitlementType}`
          )
          .populate(`entitlements.${entitlementType}.givenBy`, "username")
          .sort({ name: 1 });
      } else {
        // Regular entitlements for all
        participants = await Participant.find({
          [`entitlements.${entitlementType}`]: { $exists: true },
        })
          .select(
            `participantId name email isPresent entitlements.${entitlementType}`
          )
          .populate(`entitlements.${entitlementType}.givenBy`, "username")
          .sort({ name: 1 });
      }

      // Process the data based on entitlement type
      const processedParticipants = participants.map((p) => {
        const entitlement = p.entitlements[entitlementType];

        if (entitlementType === "beer") {
          return {
            participantId: p.participantId,
            name: p.name,
            email: p.email,
            isPresent: p.isPresent,
            given: entitlement.given, // Number of beers given
            status:
              entitlement.given > 0
                ? "given"
                : p.isPresent
                ? "pending"
                : "not-present",
            givenAt: entitlement.givenAt,
            givenBy: entitlement.givenBy?.map((gb) => gb.username) || [],
          };
        } else {
          return {
            participantId: p.participantId,
            name: p.name,
            email: p.email,
            isPresent: p.isPresent,
            given: entitlement.given,
            status: entitlement.given
              ? "given"
              : p.isPresent
              ? "pending"
              : "not-present",
            givenAt: entitlement.givenAt,
            givenBy: entitlement.givenBy?.username || null,
          };
        }
      });

      res.json({
        success: true,
        entitlementType,
        participants: processedParticipants,
        summary: {
          total: participants.length,
          given: processedParticipants.filter((p) =>
            entitlementType === "beer" ? p.given > 0 : p.given
          ).length,
          pending: processedParticipants.filter((p) => p.status === "pending")
            .length,
          notPresent: processedParticipants.filter(
            (p) => p.status === "not-present"
          ).length,
        },
      });
    } catch (error) {
      console.error("Get entitlement summary error:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching entitlement summary",
      });
    }
  }
);

// Get attendance summary
router.get("/attendance", authenticateToken, async (req, res) => {
  try {
    const participants = await Participant.find()
      .select("participantId name email isPlayer isPresent attendanceTime")
      .populate("attendanceMarkedBy", "username")
      .sort({ attendanceTime: -1 });

    const present = participants.filter((p) => p.isPresent);
    const absent = participants.filter((p) => !p.isPresent);

    res.json({
      success: true,
      summary: {
        total: participants.length,
        present: present.length,
        absent: absent.length,
        players: {
          total: participants.filter((p) => p.isPlayer).length,
          present: present.filter((p) => p.isPlayer).length,
          absent: absent.filter((p) => p.isPlayer).length,
        },
      },
      participants: {
        present,
        absent,
      },
    });
  } catch (error) {
    console.error("Get attendance summary error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching attendance summary",
    });
  }
});

module.exports = router;
