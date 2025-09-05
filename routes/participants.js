const express = require("express");
const Participant = require("../models/Participant");
const EventSettings = require("../models/EventSettings");
const {
  generateParticipantId,
  generateQRCode,
} = require("../utils/qrGenerator");
const { sendQRCodeEmail } = require("../utils/emailSender");
const { authenticateToken, requirePermission } = require("../middleware/auth");
const router = express.Router();

// Get beer limit setting
async function getBeerLimit() {
  const setting = await EventSettings.findOne({ settingName: "beerLimit" });
  return setting ? setting.settingValue : 2; // Default limit of 2
}

// Test route
router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "Participants routes working",
    timestamp: new Date().toISOString(),
  });
});

// Bulk mark entitlements (MUST come before parameterized routes)
router.post(
  "/bulk/entitlement",
  authenticateToken,
  requirePermission("canDistributeFood"),
  async (req, res) => {
    try {
      const { participantIds, entitlementType } = req.body;

      if (!Array.isArray(participantIds) || !entitlementType) {
        return res.status(400).json({
          success: false,
          message: "participantIds array and entitlementType are required",
        });
      }

      const validEntitlements = [
        "breakfast",
        "lunch",
        "beer",
        "eveningMeal",
        "specialBeverage",
        "specialMeal",
      ];
      if (!validEntitlements.includes(entitlementType)) {
        return res.status(400).json({
          success: false,
          message: "Invalid entitlement type",
        });
      }

      const results = [];
      const errors = [];

      for (const participantId of participantIds) {
        try {
          const participant = await Participant.findOne({ participantId });

          if (!participant) {
            errors.push(`${participantId}: Participant not found`);
            continue;
          }

          if (!participant.isPresent) {
            errors.push(`${participantId}: Not marked present`);
            continue;
          }

          if (!participant.entitlements[entitlementType]) {
            errors.push(
              `${participantId}: Not eligible for ${entitlementType}`
            );
            continue;
          }

          if (entitlementType === "beer") {
            const beerLimit = await getBeerLimit();
            const currentCount = participant.entitlements.beer.given;

            if (currentCount >= beerLimit) {
              errors.push(`${participantId}: Beer limit reached`);
              continue;
            }

            participant.entitlements.beer.given += 1;
            participant.entitlements.beer.givenAt.push(new Date());
            participant.entitlements.beer.givenBy.push(req.user.id);
          } else {
            if (participant.entitlements[entitlementType].given) {
              errors.push(`${participantId}: Already given`);
              continue;
            }

            participant.entitlements[entitlementType] = {
              given: true,
              givenAt: new Date(),
              givenBy: req.user.id,
            };
          }

          await participant.save();
          results.push({
            participantId,
            name: participant.name,
            success: true,
          });
        } catch (error) {
          errors.push(`${participantId}: ${error.message}`);
        }
      }

      res.json({
        success: true,
        message: `Bulk entitlement update completed. ${results.length} updated.`,
        results,
        errors,
      });
    } catch (error) {
      console.error("Bulk entitlement error:", error);
      res.status(500).json({
        success: false,
        message: "Error in bulk entitlement update",
      });
    }
  }
);

// Bulk add participants
router.post(
  "/bulk",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      const { participants } = req.body;

      if (!Array.isArray(participants) || participants.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Participants array is required",
        });
      }

      const results = [];
      const errors = [];

      for (let i = 0; i < participants.length; i++) {
        const participantData = participants[i];

        try {
          const { name, email, phone, isPlayer, foodPreference } =
            participantData;

          if (!name || !email) {
            errors.push(`Row ${i + 1}: Name and email are required`);
            continue;
          }

          // Check for duplicate email
          const existingParticipant = await Participant.findOne({ email });
          if (existingParticipant) {
            errors.push(`Row ${i + 1}: Email ${email} already exists`);
            continue;
          }

          // Generate unique participant ID
          let participantId;
          let idExists = true;
          while (idExists) {
            participantId = generateParticipantId();
            const existing = await Participant.findOne({ participantId });
            idExists = !!existing;
          }

          const qrCode = await generateQRCode(participantId);

          const entitlements = {
            breakfast: { given: false },
            lunch: { given: false },
            beer: { given: 0, givenAt: [], givenBy: [] },
            eveningMeal: { given: false },
          };

          if (isPlayer) {
            entitlements.specialBeverage = { given: false };
            entitlements.specialMeal = { given: false };
          }

          const participant = new Participant({
            participantId,
            name,
            email,
            phone,
            isPlayer: !!isPlayer,
            foodPreference: foodPreference || "no-preference",
            qrCode,
            entitlements,
          });

          await participant.save();

          // Send email (optional for bulk)
          try {
            await sendQRCodeEmail(
              {
                participantId: participant.participantId,
                name: participant.name,
                email: participant.email,
                isPlayer: participant.isPlayer,
                foodPreference: participant.foodPreference,
              },
              participant.qrCode
            );
          } catch (emailError) {
            console.warn(`Email failed for ${email}:`, emailError.message);
          }

          results.push({
            participantId: participant.participantId,
            name: participant.name,
            email: participant.email,
          });
        } catch (error) {
          errors.push(`Row ${i + 1}: ${error.message}`);
        }
      }

      res.json({
        success: true,
        message: `Bulk import completed. ${results.length} participants added.`,
        results,
        errors,
      });
    } catch (error) {
      console.error("Bulk import error:", error);
      res.status(500).json({
        success: false,
        message: "Error in bulk import",
      });
    }
  }
);

// Get all participants
router.get("/", authenticateToken, async (req, res) => {
  try {
    const {
      limit = 50,
      page = 1,
      isPresent,
      isPlayer,
      foodPreference,
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

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const participants = await Participant.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select("-qrCode") // Exclude QR code data for performance
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
    console.error("Get participants error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching participants",
    });
  }
});

// Add single participant
router.post(
  "/",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      const {
        name,
        email,
        phone,
        isPlayer,
        foodPreference,
        sendEmail = true,
      } = req.body;

      // Validate required fields
      if (!name || !email) {
        return res.status(400).json({
          success: false,
          message: "Name and email are required",
        });
      }

      // Check if participant already exists
      const existingParticipant = await Participant.findOne({ email });
      if (existingParticipant) {
        return res.status(400).json({
          success: false,
          message: "Participant with this email already exists",
        });
      }

      // Generate unique participant ID
      let participantId;
      let idExists = true;
      while (idExists) {
        participantId = generateParticipantId();
        const existing = await Participant.findOne({ participantId });
        idExists = !!existing;
      }

      // Generate QR code
      const qrCode = await generateQRCode(participantId);

      // Set up entitlements based on participant type
      const entitlements = {
        breakfast: { given: false },
        lunch: { given: false },
        beer: { given: 0, givenAt: [], givenBy: [] },
        eveningMeal: { given: false },
      };

      // Add special entitlements for players
      if (isPlayer) {
        entitlements.specialBeverage = { given: false };
        entitlements.specialMeal = { given: false };
      }

      const participant = new Participant({
        participantId,
        name,
        email,
        phone,
        isPlayer: !!isPlayer,
        foodPreference: foodPreference || "no-preference",
        qrCode,
        entitlements,
      });

      await participant.save();

      // Send email with QR code if requested
      let emailResult = null;
      if (sendEmail) {
        emailResult = await sendQRCodeEmail(
          {
            participantId: participant.participantId,
            name: participant.name,
            email: participant.email,
            isPlayer: participant.isPlayer,
            foodPreference: participant.foodPreference,
          },
          participant.qrCode
        );
      }

      res.json({
        success: true,
        message: "Participant added successfully",
        participant: {
          participantId: participant.participantId,
          name: participant.name,
          email: participant.email,
          isPlayer: participant.isPlayer,
          foodPreference: participant.foodPreference,
          qrCode: participant.qrCode,
        },
        emailSent: emailResult?.success || false,
      });
    } catch (error) {
      console.error("Add participant error:", error);
      res.status(500).json({
        success: false,
        message: "Error adding participant",
      });
    }
  }
);

// Get participant by ID (for QR scan) with full details
router.get("/:participantId", authenticateToken, async (req, res) => {
  try {
    const participant = await Participant.findOne({
      participantId: req.params.participantId,
    })
      .populate("attendanceMarkedBy", "username")
      .populate("entitlements.breakfast.givenBy", "username")
      .populate("entitlements.lunch.givenBy", "username")
      .populate("entitlements.beer.givenBy", "username")
      .populate("entitlements.eveningMeal.givenBy", "username")
      .populate("entitlements.specialBeverage.givenBy", "username")
      .populate("entitlements.specialMeal.givenBy", "username")
      .populate("customEntitlements.addedBy", "username")
      .populate("customEntitlements.givenBy", "username")
      .populate("customEntitlements.undoneBy", "username")
      .populate("groups.groupId", "name color")
      .populate("typeChangeHistory.changedBy", "username");

    if (!participant) {
      return res.status(404).json({
        success: false,
        message: "Participant not found",
      });
    }

    // Get beer limit for display
    const beerLimit = await getBeerLimit();

    res.json({
      success: true,
      participant: {
        ...participant.toObject(),
        beerLimit,
      },
    });
  } catch (error) {
    console.error("Get participant error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching participant",
    });
  }
});

// Mark attendance
router.post(
  "/:participantId/attendance",
  authenticateToken,
  requirePermission("canMarkAttendance"),
  async (req, res) => {
    try {
      const participant = await Participant.findOne({
        participantId: req.params.participantId,
      });

      if (!participant) {
        return res.status(404).json({
          success: false,
          message: "Participant not found",
        });
      }

      if (participant.isPresent) {
        return res.status(400).json({
          success: false,
          message: "Attendance already marked",
          participant: {
            name: participant.name,
            participantId: participant.participantId,
            isPlayer: participant.isPlayer,
            attendanceTime: participant.attendanceTime,
          },
        });
      }

      participant.isPresent = true;
      participant.attendanceTime = new Date();
      participant.attendanceMarkedBy = req.user.id;
      await participant.save();

      res.json({
        success: true,
        message: "Attendance marked successfully",
        participant: {
          name: participant.name,
          participantId: participant.participantId,
          isPlayer: participant.isPlayer,
          foodPreference: participant.foodPreference,
          attendanceTime: participant.attendanceTime,
        },
      });
    } catch (error) {
      console.error("Mark attendance error:", error);
      res.status(500).json({
        success: false,
        message: "Error marking attendance",
      });
    }
  }
);

// Undo attendance (admin only)
router.delete(
  "/:participantId/attendance",
  authenticateToken,
  requirePermission("canUndoActions"),
  async (req, res) => {
    try {
      const participant = await Participant.findOne({
        participantId: req.params.participantId,
      });

      if (!participant) {
        return res.status(404).json({
          success: false,
          message: "Participant not found",
        });
      }

      if (!participant.isPresent) {
        return res.status(400).json({
          success: false,
          message: "Attendance not marked yet",
        });
      }

      participant.isPresent = false;
      participant.attendanceTime = null;
      participant.attendanceMarkedBy = null;
      await participant.save();

      res.json({
        success: true,
        message: "Attendance undone successfully",
        participant: {
          name: participant.name,
          participantId: participant.participantId,
          isPlayer: participant.isPlayer,
        },
      });
    } catch (error) {
      console.error("Undo attendance error:", error);
      res.status(500).json({
        success: false,
        message: "Error undoing attendance",
      });
    }
  }
);

// Mark entitlement as given (enhanced for beer counting)
router.post(
  "/:participantId/entitlement",
  authenticateToken,
  requirePermission("canDistributeFood"),
  async (req, res) => {
    try {
      const { entitlementType, count = 1 } = req.body;
      const participant = await Participant.findOne({
        participantId: req.params.participantId,
      });

      if (!participant) {
        return res.status(404).json({
          success: false,
          message: "Participant not found",
        });
      }

      if (!participant.isPresent) {
        return res.status(400).json({
          success: false,
          message: "Participant must be marked present first",
        });
      }

      if (!participant.entitlements[entitlementType]) {
        return res.status(400).json({
          success: false,
          message: "Invalid entitlement type or participant not eligible",
        });
      }

      // Special handling for beer
      if (entitlementType === "beer") {
        const beerLimit = await getBeerLimit();
        const currentCount = participant.entitlements.beer.given;
        const requestedCount = parseInt(count);

        if (currentCount + requestedCount > beerLimit) {
          return res.status(400).json({
            success: false,
            message: `Beer limit exceeded. Current: ${currentCount}, Limit: ${beerLimit}, Requested: ${requestedCount}`,
          });
        }

        // Add to beer count
        participant.entitlements.beer.given += requestedCount;

        // Track each beer distribution
        for (let i = 0; i < requestedCount; i++) {
          participant.entitlements.beer.givenAt.push(new Date());
          participant.entitlements.beer.givenBy.push(req.user.id);
        }
      } else {
        // Regular entitlements (boolean)
        if (participant.entitlements[entitlementType].given) {
          return res.status(400).json({
            success: false,
            message: "Entitlement already given",
            givenAt: participant.entitlements[entitlementType].givenAt,
          });
        }

        participant.entitlements[entitlementType] = {
          given: true,
          givenAt: new Date(),
          givenBy: req.user.id,
        };
      }

      await participant.save();

      res.json({
        success: true,
        message: `${entitlementType} marked as given${
          entitlementType === "beer" ? ` (count: ${count})` : ""
        }`,
        participant: {
          name: participant.name,
          participantId: participant.participantId,
          foodPreference: participant.foodPreference,
          entitlements: participant.entitlements,
        },
      });
    } catch (error) {
      console.error("Mark entitlement error:", error);
      res.status(500).json({
        success: false,
        message: "Error updating entitlement",
      });
    }
  }
);

// Undo entitlement (admin only)
router.delete(
  "/:participantId/entitlement",
  authenticateToken,
  requirePermission("canUndoActions"),
  async (req, res) => {
    try {
      const { entitlementType, count = 1 } = req.body;
      const participant = await Participant.findOne({
        participantId: req.params.participantId,
      });

      if (!participant) {
        return res.status(404).json({
          success: false,
          message: "Participant not found",
        });
      }

      if (!participant.entitlements[entitlementType]) {
        return res.status(400).json({
          success: false,
          message: "Invalid entitlement type",
        });
      }

      // Special handling for beer
      if (entitlementType === "beer") {
        const currentCount = participant.entitlements.beer.given;
        const undoCount = Math.min(parseInt(count), currentCount);

        if (currentCount === 0) {
          return res.status(400).json({
            success: false,
            message: "No beer entitlements to undo",
          });
        }

        // Reduce beer count
        participant.entitlements.beer.given -= undoCount;

        // Remove last entries from tracking arrays
        participant.entitlements.beer.givenAt.splice(-undoCount, undoCount);
        participant.entitlements.beer.givenBy.splice(-undoCount, undoCount);

        participant.entitlements.beer.undoneBy = req.user.id;
        participant.entitlements.beer.undoneAt = new Date();
        participant.entitlements.beer.lastUndoneCount = undoCount;
      } else {
        // Regular entitlements (boolean)
        if (!participant.entitlements[entitlementType].given) {
          return res.status(400).json({
            success: false,
            message: "Entitlement not given yet",
          });
        }

        participant.entitlements[entitlementType] = {
          given: false,
          givenAt: null,
          givenBy: null,
          undoneBy: req.user.id,
          undoneAt: new Date(),
        };
      }

      await participant.save();

      res.json({
        success: true,
        message: `${entitlementType} entitlement undone successfully${
          entitlementType === "beer"
            ? ` (count: ${
                participant.entitlements.beer.lastUndoneCount || count
              })`
            : ""
        }`,
        participant: {
          name: participant.name,
          participantId: participant.participantId,
          entitlements: participant.entitlements,
        },
      });
    } catch (error) {
      console.error("Undo entitlement error:", error);
      res.status(500).json({
        success: false,
        message: "Error undoing entitlement",
      });
    }
  }
);

// Change participant type (player <-> participant)
router.patch(
  "/:participantId/change-type",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      const { participantId } = req.params;
      const { newType, reason } = req.body; // newType: true for player, false for participant

      if (typeof newType !== "boolean") {
        return res.status(400).json({
          success: false,
          message:
            "newType must be boolean (true for player, false for participant)",
        });
      }

      const participant = await Participant.findOne({ participantId });
      if (!participant) {
        return res.status(404).json({
          success: false,
          message: "Participant not found",
        });
      }

      if (participant.isPlayer === newType) {
        return res.status(400).json({
          success: false,
          message: `Participant is already a ${
            newType ? "player" : "participant"
          }`,
        });
      }

      const previousType = participant.isPlayer;
      participant.isPlayer = newType;

      // Add to type change history
      participant.typeChangeHistory.push({
        previousType,
        newType,
        changedBy: req.user.id,
        changedAt: new Date(),
        reason: reason || "Type changed by admin",
      });

      // Update entitlements based on new type
      if (newType) {
        // Becoming a player - add special entitlements if they don't exist
        if (!participant.entitlements.specialBeverage) {
          participant.entitlements.specialBeverage = { given: false };
        }
        if (!participant.entitlements.specialMeal) {
          participant.entitlements.specialMeal = { given: false };
        }
      }
      // Note: We don't remove special entitlements when changing from player to participant
      // as they might have already been distributed

      await participant.save();

      res.json({
        success: true,
        message: `Participant type changed from ${
          previousType ? "player" : "participant"
        } to ${newType ? "player" : "participant"}`,
        participant: {
          participantId: participant.participantId,
          name: participant.name,
          previousType: previousType ? "player" : "participant",
          newType: newType ? "player" : "participant",
          changedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("Change participant type error:", error);
      res.status(500).json({
        success: false,
        message: "Error changing participant type",
      });
    }
  }
);

// Get participant's group history
router.get("/:participantId/groups", authenticateToken, async (req, res) => {
  try {
    const { participantId } = req.params;

    const participant = await Participant.findOne({ participantId })
      .populate("groups.groupId", "name description color groupType")
      .populate("groupEntitlementHistory.groupId", "name color")
      .populate("groupEntitlementHistory.distributedBy", "username")
      .populate("groupEntitlementHistory.undoneBy", "username");

    if (!participant) {
      return res.status(404).json({
        success: false,
        message: "Participant not found",
      });
    }

    res.json({
      success: true,
      participant: {
        participantId: participant.participantId,
        name: participant.name,
        groups: participant.groups,
        groupEntitlementHistory: participant.groupEntitlementHistory,
      },
    });
  } catch (error) {
    console.error("Get participant groups error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching participant groups",
    });
  }
});

// Get participant's type change history
router.get(
  "/:participantId/type-history",
  authenticateToken,
  async (req, res) => {
    try {
      const { participantId } = req.params;

      const participant = await Participant.findOne({ participantId })
        .populate("typeChangeHistory.changedBy", "username")
        .select("participantId name isPlayer typeChangeHistory");

      if (!participant) {
        return res.status(404).json({
          success: false,
          message: "Participant not found",
        });
      }

      res.json({
        success: true,
        participant: {
          participantId: participant.participantId,
          name: participant.name,
          currentType: participant.isPlayer ? "player" : "participant",
          typeChangeHistory: participant.typeChangeHistory,
        },
      });
    } catch (error) {
      console.error("Get type change history error:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching type change history",
      });
    }
  }
);

module.exports = router;
