const express = require("express");
const Participant = require("../models/Participant");
const EntitlementTemplate = require("../models/EntitlementTemplate");
const EventSettings = require("../models/EventSettings");
const { generateParticipantId, generateQRCode } = require("../utils/qrGenerator");
const { sendQRCodeEmail } = require("../utils/emailSender");
const { authenticateToken, requirePermission } = require("../middleware/auth");
const multer = require("multer");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

// In-memory store for failed imports
let failedImportsStore = [];

// Helpers
const toBool = (v) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "yes", "y", "1"].includes(s)) return true;
    if (["false", "no", "n", "0"].includes(s)) return false;
  }
  return false;
};

const normalizeFoodPref = (v) => {
  const allowed = ["vegetarian", "chicken", "fish", "mixed", "no-preference"];
  const s = (v || "").toString().trim().toLowerCase();
  return allowed.includes(s) ? s : "no-preference";
};

// Get entitlement limit from settings (with fallback to template)
async function getEntitlementLimit(entitlementName, templateMaxCount) {
  const settingKey = getSettingKeyForEntitlement(entitlementName);
  if (!settingKey) return templateMaxCount;
  const setting = await EventSettings.findOne({ settingName: settingKey });
  return setting ? setting.settingValue : templateMaxCount;
}

// Map entitlement names to setting keys
function getSettingKeyForEntitlement(name) {
  const mappings = {
    'beer': 'beerLimit',
    'soft drinks': 'softDrinkLimit',
    'soft drink': 'softDrinkLimit'
  };
  return mappings[name.toLowerCase()] || null;
}

// Auto-assign default entitlements to new participants
async function autoAssignEntitlements(participant) {
  try {
    const templates = await EntitlementTemplate.find({
      isActive: true,
      $or: [
        { defaultForParticipants: true },
        { defaultForPlayers: participant.isPlayer }
      ]
    });

    for (const template of templates) {
      // Check if participant already has this entitlement
      const existing = participant.entitlements.find(e => e.templateId.toString() === template._id.toString());
      if (existing) continue;

      const effectiveMaxCount = await getEntitlementLimit(template.name, template.maxCount);

      participant.entitlements.push({
        templateId: template._id,
        name: template.name,
        description: template.description,
        category: template.category,
        isCountable: template.isCountable,
        maxCount: effectiveMaxCount,
        given: 0,
        givenAt: [],
        givenBy: [],
        addedBy: null, // System assigned
        addedAt: new Date(),
      });
    }

    await participant.save();
  } catch (error) {
    console.error('Auto-assign entitlements error:', error);
  }
}

// Upload Excel and bulk-create participants
router.post("/upload", authenticateToken, requirePermission("canManageUsers"), upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        code: "UPLOAD_FILE_REQUIRED",
        message: "Excel file is required under field name 'file'",
      });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    if (!sheet) {
      return res.status(400).json({
        success: false,
        code: "UPLOAD_NO_SHEET",
        message: "No sheet found in the uploaded Excel file",
      });
    }

    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        success: false,
        code: "UPLOAD_EMPTY",
        message: "The uploaded Excel file contains no data rows",
      });
    }

    if (rows.length > 1000) {
      return res.status(413).json({
        success: false,
        code: "UPLOAD_TOO_LARGE",
        message: "Max 1000 rows per upload",
      });
    }

    const results = [];
    failedImportsStore = []; // Reset failed imports for each upload

    for (const raw of rows) {
      const name = (raw.name || "").toString().trim();
      const email = (raw.email || "").toString().trim();
      const phone = (raw.phone || "").toString().trim() || undefined;
      const isPlayer = toBool(raw.isPlayer);
      const foodPreference = normalizeFoodPref(raw.foodPreference);

      if (!name || !email) {
        const failedEntry = {
          row: raw,
          error: "name and email are required",
          timestamp: new Date(),
          reason: "VALIDATION_ERROR"
        };
        
        failedImportsStore.push(failedEntry);
        
        results.push({
          row: raw,
          success: false,
          code: "PARTICIPANT_INVALID_INPUT",
          message: "name and email are required",
        });
        continue;
      }

      let participantId = null;
      for (let i = 0; i < 5; i++) {
        const cand = generateParticipantId();
        const exists = await Participant.findOne({ participantId: cand }).select({ _id: 1 }).lean();
        if (!exists) {
          participantId = cand;
          break;
        }
      }

      if (!participantId) {
        const failedEntry = {
          row: raw,
          error: "Failed to generate a unique participantId",
          timestamp: new Date(),
          reason: "ID_GENERATION_ERROR"
        };
        
        failedImportsStore.push(failedEntry);
        
        results.push({
          row: raw,
          success: false,
          code: "PARTICIPANT_ID_GENERATION_FAILED",
          message: "Failed to generate a unique participantId",
        });
        continue;
      }

      try {
        const qrCode = await generateQRCode(participantId);

        const participant = new Participant({
          participantId,
          name,
          email,
          phone,
          isPlayer,
          qrCode,
          foodPreference,
          entitlements: [], // Will be populated by autoAssignEntitlements
        });

        await participant.save();
        await autoAssignEntitlements(participant);

        let emailWarning = null;
        try {
          const sent = await sendQRCodeEmail({ name, email, participantId }, qrCode);
          if (!sent.success) emailWarning = sent.error || "Email send failed";
        } catch (e) {
          emailWarning = e?.message || "Email send failed";
        }

        results.push({
          row: raw,
          success: true,
          data: {
            _id: participant._id,
            name: participant.name,
            email: participant.email,
            isPlayer: participant.isPlayer,
            foodPreference: participant.foodPreference,
            participantId: participant.participantId,
            createdAt: participant.createdAt,
          },
          emailWarning,
        });
      } catch (err) {
        const failedEntry = {
          row: raw,
          error: err.message,
          timestamp: new Date(),
          reason: "DATABASE_ERROR"
        };
        
        failedImportsStore.push(failedEntry);
        
        results.push({
          row: raw,
          success: false,
          code: "PARTICIPANT_CREATE_ERROR",
          message: "Failed to create participant",
          details: err.message,
        });
      }
    }

    const created = results.filter((r) => r.success).length;
    const failed = results.length - created;

    return res.status(created > 0 ? 201 : 400).json({
      success: created > 0,
      summary: { processed: rows.length, created, failed },
      results,
      failedImports: failedImportsStore, // Include failed imports in response
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      code: "UPLOAD_PROCESS_ERROR",
      message: "Failed to process uploaded Excel",
      details: error.message,
    });
  }
});

// Get failed imports endpoint
router.get("/failed-imports", authenticateToken, requirePermission("canManageUsers"), async (req, res) => {
  try {
    return res.json({
      success: true,
      failedImports: failedImportsStore,
      count: failedImportsStore.length
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching failed imports",
      details: error.message
    });
  }
});

// Clear failed imports endpoint
router.delete("/failed-imports", authenticateToken, requirePermission("canManageUsers"), async (req, res) => {
  try {
    failedImportsStore = [];
    return res.json({
      success: true,
      message: "Failed imports cleared successfully"
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error clearing failed imports"
    });
  }
});

// Get all participants
router.get("/", authenticateToken, async (req, res) => {
  try {
    const { limit = 50, page = 1, isPresent, isPlayer, foodPreference } = req.query;
    let filter = {};

    if (isPresent !== undefined) filter.isPresent = isPresent === "true";
    if (isPlayer !== undefined) filter.isPlayer = isPlayer === "true";
    if (foodPreference) filter.foodPreference = foodPreference;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const participants = await Participant.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select("-qrCode")
      .populate("attendanceMarkedBy", "username")
      .populate("entitlements.templateId", "name category isCountable")
      .populate("entitlements.givenBy", "username")
      .populate("entitlements.addedBy", "username");

    const total = await Participant.countDocuments(filter);

    return res.json({
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
    return res.status(500).json({
      success: false,
      code: "GET_PARTICIPANTS_SERVER_ERROR",
      message: "Error fetching participants",
      details: error.message,
    });
  }
});

// Add single participant
router.post("/", authenticateToken, requirePermission("canManageSettings"), async (req, res) => {
  try {
    const { name, email, phone, isPlayer, foodPreference, sendEmail = true } = req.body || {};

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        code: "ADD_PARTICIPANT_VALIDATION",
        message: "Name and email are required",
      });
    }

    const existingParticipant = await Participant.findOne({ email });
    if (existingParticipant) {
      return res.status(400).json({
        success: false,
        code: "PARTICIPANT_EXISTS",
        message: "Participant with this email already exists",
      });
    }

    let participantId;
    let idExists = true;
    while (idExists) {
      participantId = generateParticipantId();
      const existing = await Participant.findOne({ participantId });
      idExists = !!existing;
    }

    const qrCode = await generateQRCode(participantId);

    const participant = new Participant({
      participantId,
      name,
      email,
      phone,
      isPlayer: !!isPlayer,
      foodPreference: foodPreference || "no-preference",
      qrCode,
      entitlements: [],
    });

    await participant.save();
    await autoAssignEntitlements(participant);

    let emailResult = null;
    if (sendEmail) {
      try {
        emailResult = await sendQRCodeEmail({
          participantId: participant.participantId,
          name: participant.name,
          email: participant.email,
          isPlayer: participant.isPlayer,
          foodPreference: participant.foodPreference,
        }, participant.qrCode);
      } catch (emailErr) {
        console.warn("QR email failed:", emailErr.message);
      }
    }

    return res.json({
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
    return res.status(500).json({
      success: false,
      code: "ADD_PARTICIPANT_SERVER_ERROR",
      message: "Error adding participant",
      details: error.message,
    });
  }
});

// Get participant by ID
router.get("/:participantId", authenticateToken, async (req, res) => {
  try {
    const participant = await Participant.findOne({
      participantId: req.params.participantId,
    })
      .populate("attendanceMarkedBy", "username")
      .populate("entitlements.templateId", "name category isCountable maxCount")
      .populate("entitlements.givenBy", "username")
      .populate("entitlements.addedBy", "username")
      .populate("entitlements.undoneBy", "username")
      .populate("groups.groupId", "name color")
      .populate("typeChangeHistory.changedBy", "username");

    if (!participant) {
      return res.status(404).json({
        success: false,
        code: "PARTICIPANT_NOT_FOUND",
        message: "Participant not found",
      });
    }

    return res.json({
      success: true,
      participant: participant.toObject(),
    });
  } catch (error) {
    console.error("Get participant error:", error);
    return res.status(500).json({
      success: false,
      code: "GET_PARTICIPANT_SERVER_ERROR",
      message: "Error fetching participant",
      details: error.message,
    });
  }
});

// Mark attendance
router.post("/:participantId/attendance", authenticateToken, requirePermission("canMarkAttendance"), async (req, res) => {
  try {
    const participant = await Participant.findOne({
      participantId: req.params.participantId,
    })
      .populate("attendanceMarkedBy", "username")
      .populate("entitlements.templateId", "name category isCountable")
      .populate("entitlements.givenBy", "username");

    if (!participant) {
      return res.status(404).json({
        success: false,
        code: "PARTICIPANT_NOT_FOUND",
        message: "Participant not found with this QR code",
        participantId: req.params.participantId
      });
    }

    // Return participant data even if already marked
    if (participant.isPresent) {
      return res.status(400).json({
        success: false,
        code: "ATTENDANCE_ALREADY_MARKED",
        message: `${participant.name} is already marked present`,
        participant: {
          participantId: participant.participantId,
          name: participant.name,
          email: participant.email,
          phone: participant.phone,
          isPlayer: participant.isPlayer,
          foodPreference: participant.foodPreference,
          isPresent: participant.isPresent,
          attendanceTime: participant.attendanceTime,
          attendanceMarkedBy: participant.attendanceMarkedBy
        }
      });
    }

    // Mark attendance
    participant.isPresent = true;
    participant.attendanceTime = new Date();
    participant.attendanceMarkedBy = req.user.id;
    await participant.save();

    return res.status(200).json({
      success: true,
      message: `Attendance marked successfully for ${participant.name}`,
      participant: {
        participantId: participant.participantId,
        name: participant.name,
        email: participant.email,
        phone: participant.phone,
        isPlayer: participant.isPlayer,
        foodPreference: participant.foodPreference,
        isPresent: participant.isPresent,
        attendanceTime: participant.attendanceTime,
        attendanceMarkedBy: req.user.id
      }
    });
  } catch (error) {
    console.error("Mark attendance error:", error);
    return res.status(500).json({
      success: false,
      code: "ATTENDANCE_SERVER_ERROR",
      message: "Error marking attendance",
      details: error.message,
    });
  }
});

// Undo attendance
router.delete("/:participantId/attendance", authenticateToken, requirePermission("canUndoActions"), async (req, res) => {
  try {
    const participant = await Participant.findOne({
      participantId: req.params.participantId,
    });

    if (!participant) {
      return res.status(404).json({
        success: false,
        code: "PARTICIPANT_NOT_FOUND",
        message: "Participant not found",
      });
    }

    if (!participant.isPresent) {
      return res.status(400).json({
        success: false,
        code: "ATTENDANCE_NOT_MARKED",
        message: "Attendance not marked yet",
      });
    }

    participant.isPresent = false;
    participant.attendanceTime = null;
    participant.attendanceMarkedBy = null;
    await participant.save();

    return res.json({
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
    return res.status(500).json({
      success: false,
      code: "ATTENDANCE_UNDO_SERVER_ERROR",
      message: "Error undoing attendance",
      details: error.message,
    });
  }
});

// Distribute entitlement (dynamic)
router.post("/:participantId/entitlement", authenticateToken, requirePermission("canDistributeFood"), async (req, res) => {
  try {
    const { entitlementName, count = 1 } = req.body || {};

    if (!entitlementName) {
      return res.status(400).json({
        success: false,
        code: "ENTITLEMENT_NAME_REQUIRED",
        message: "entitlementName is required",
      });
    }

    const participant = await Participant.findOne({
      participantId: req.params.participantId,
    }).populate("entitlements.templateId");

    if (!participant) {
      return res.status(404).json({
        success: false,
        code: "PARTICIPANT_NOT_FOUND",
        message: "Participant not found",
      });
    }

    if (!participant.isPresent) {
      return res.status(400).json({
        success: false,
        code: "PARTICIPANT_NOT_PRESENT",
        message: "Participant must be marked present first",
      });
    }

    const entitlement = participant.entitlements.find(
      (e) => e.name.toLowerCase() === entitlementName.toLowerCase()
    );

    if (!entitlement) {
      return res.status(400).json({
        success: false,
        code: "ENTITLEMENT_NOT_FOUND",
        message: "Participant does not have this entitlement",
      });
    }

    const requestedCount = parseInt(count);
    const effectiveMaxCount = await getEntitlementLimit(entitlement.name, entitlement.maxCount);

    if (entitlement.isCountable) {
      if (entitlement.given + requestedCount > effectiveMaxCount) {
        return res.status(400).json({
          success: false,
          code: "ENTITLEMENT_LIMIT_EXCEEDED",
          message: `Limit exceeded. Current: ${entitlement.given}, Limit: ${effectiveMaxCount}, Requested: ${requestedCount}`,
        });
      }

      entitlement.given += requestedCount;
      for (let i = 0; i < requestedCount; i++) {
        entitlement.givenAt.push(new Date());
        entitlement.givenBy.push(req.user.id);
      }
    } else {
      if (entitlement.given >= effectiveMaxCount) {
        return res.status(400).json({
          success: false,
          code: "ENTITLEMENT_ALREADY_GIVEN",
          message: "Entitlement already given",
        });
      }

      entitlement.given = effectiveMaxCount;
      entitlement.givenAt.push(new Date());
      entitlement.givenBy.push(req.user.id);
    }

    // Add to history
    participant.entitlementHistory.push({
      entitlementName: entitlement.name,
      action: "distributed",
      count: requestedCount,
      performedAt: new Date(),
      performedBy: req.user.id,
    });

    await participant.save();

    return res.json({
      success: true,
      message: `${entitlementName} distributed successfully${entitlement.isCountable ? ` (count: ${requestedCount})` : ""}`,
      participant: {
        name: participant.name,
        participantId: participant.participantId,
        foodPreference: participant.foodPreference,
        entitlements: participant.entitlements,
      },
    });
  } catch (error) {
    console.error("Distribute entitlement error:", error);
    return res.status(500).json({
      success: false,
      code: "ENTITLEMENT_SERVER_ERROR",
      message: "Error distributing entitlement",
      details: error.message,
    });
  }
});

// Undo entitlement distribution
router.delete("/:participantId/entitlement", authenticateToken, requirePermission("canUndoActions"), async (req, res) => {
  try {
    const { entitlementName, count = 1 } = req.body || {};

    if (!entitlementName) {
      return res.status(400).json({
        success: false,
        code: "ENTITLEMENT_NAME_REQUIRED",
        message: "entitlementName is required",
      });
    }

    const participant = await Participant.findOne({
      participantId: req.params.participantId,
    });

    if (!participant) {
      return res.status(404).json({
        success: false,
        code: "PARTICIPANT_NOT_FOUND",
        message: "Participant not found",
      });
    }

    const entitlement = participant.entitlements.find(
      (e) => e.name.toLowerCase() === entitlementName.toLowerCase()
    );

    if (!entitlement) {
      return res.status(400).json({
        success: false,
        code: "ENTITLEMENT_NOT_FOUND",
        message: "Participant does not have this entitlement",
      });
    }

    if (entitlement.given === 0) {
      return res.status(400).json({
        success: false,
        code: "NOTHING_TO_UNDO",
        message: "No distributions to undo for this entitlement",
      });
    }

    const undoCount = Math.min(parseInt(count), entitlement.given);

    if (entitlement.isCountable) {
      entitlement.given -= undoCount;
      entitlement.givenAt.splice(-undoCount, undoCount);
      entitlement.givenBy.splice(-undoCount, undoCount);
    } else {
      entitlement.given = 0;
      entitlement.givenAt = [];
      entitlement.givenBy = [];
    }

    entitlement.undoneBy = req.user.id;
    entitlement.undoneAt = new Date();
    entitlement.lastUndoneCount = undoCount;

    // Add to history
    participant.entitlementHistory.push({
      entitlementName: entitlement.name,
      action: "undone",
      count: undoCount,
      performedAt: new Date(),
      performedBy: req.user.id,
    });

    await participant.save();

    return res.json({
      success: true,
      message: `${entitlementName} distribution undone successfully (count: ${undoCount})`,
      participant: {
        name: participant.name,
        participantId: participant.participantId,
        entitlements: participant.entitlements,
      },
    });
  } catch (error) {
    console.error("Undo entitlement error:", error);
    return res.status(500).json({
      success: false,
      code: "ENTITLEMENT_UNDO_SERVER_ERROR",
      message: "Error undoing entitlement distribution",
      details: error.message,
    });
  }
});

// Add entitlement to participant
router.post("/:participantId/add-entitlement", authenticateToken, requirePermission("canManageSettings"), async (req, res) => {
  try {
    const { templateId, customMaxCount } = req.body || {};

    if (!templateId) {
      return res.status(400).json({
        success: false,
        code: "TEMPLATE_ID_REQUIRED",
        message: "templateId is required",
      });
    }

    const participant = await Participant.findOne({
      participantId: req.params.participantId,
    });

    if (!participant) {
      return res.status(404).json({
        success: false,
        code: "PARTICIPANT_NOT_FOUND",
        message: "Participant not found",
      });
    }

    const template = await EntitlementTemplate.findById(templateId);
    if (!template || !template.isActive) {
      return res.status(404).json({
        success: false,
        code: "TEMPLATE_NOT_FOUND_OR_INACTIVE",
        message: "Entitlement template not found or inactive",
      });
    }

    const existing = participant.entitlements.find(
      (e) => e.name.toLowerCase() === template.name.toLowerCase()
    );

    if (existing) {
      return res.status(400).json({
        success: false,
        code: "ENTITLEMENT_ALREADY_EXISTS",
        message: "Participant already has this entitlement",
      });
    }

    const effectiveMaxCount = customMaxCount || (await getEntitlementLimit(template.name, template.maxCount));

    participant.entitlements.push({
      templateId: template._id,
      name: template.name,
      description: template.description,
      category: template.category,
      isCountable: template.isCountable,
      maxCount: effectiveMaxCount,
      given: 0,
      givenAt: [],
      givenBy: [],
      addedBy: req.user.id,
      addedAt: new Date(),
    });

    // Add to history
    participant.entitlementHistory.push({
      entitlementName: template.name,
      action: "added",
      count: 1,
      performedAt: new Date(),
      performedBy: req.user.id,
    });

    await participant.save();

    return res.json({
      success: true,
      message: `Entitlement "${template.name}" added to participant`,
      participant: {
        participantId: participant.participantId,
        name: participant.name,
        entitlements: participant.entitlements,
      },
    });
  } catch (error) {
    console.error("Add entitlement error:", error);
    return res.status(500).json({
      success: false,
      code: "ADD_ENTITLEMENT_SERVER_ERROR",
      message: "Error adding entitlement to participant",
      details: error.message,
    });
  }
});

// Remove entitlement from participant
router.delete("/:participantId/remove-entitlement/:entitlementName", authenticateToken, requirePermission("canManageSettings"), async (req, res) => {
  try {
    const { participantId, entitlementName } = req.params;

    const participant = await Participant.findOne({ participantId });
    if (!participant) {
      return res.status(404).json({
        success: false,
        code: "PARTICIPANT_NOT_FOUND",
        message: "Participant not found",
      });
    }

    const index = participant.entitlements.findIndex(
      (e) => e.name.toLowerCase() === entitlementName.toLowerCase()
    );

    if (index === -1) {
      return res.status(404).json({
        success: false,
        code: "ENTITLEMENT_NOT_FOUND",
        message: "Entitlement not found for this participant",
      });
    }

    participant.entitlements.splice(index, 1);
    await participant.save();

    return res.json({
      success: true,
      message: `Entitlement "${entitlementName}" removed from participant`,
      participant: {
        participantId: participant.participantId,
        name: participant.name,
        entitlements: participant.entitlements,
      },
    });
  } catch (error) {
    console.error("Remove entitlement error:", error);
    return res.status(500).json({
      success: false,
      code: "REMOVE_ENTITLEMENT_SERVER_ERROR",
      message: "Error removing entitlement from participant",
      details: error.message,
    });
  }
});

// Auto-assign entitlements endpoint
router.post("/auto-assign-entitlements", authenticateToken, requirePermission("canManageSettings"), async (req, res) => {
  try {
    const { participantType } = req.body; // "all", "players", "participants"

    let filter = {};
    if (participantType === "players") filter.isPlayer = true;
    if (participantType === "participants") filter.isPlayer = false;

    const participants = await Participant.find(filter);
    let updated = 0;

    for (const participant of participants) {
      await autoAssignEntitlements(participant);
      updated++;
    }

    return res.json({
      success: true,
      message: `Auto-assigned entitlements to ${updated} participants`,
      updated,
    });
  } catch (error) {
    console.error("Auto-assign entitlements error:", error);
    return res.status(500).json({
      success: false,
      code: "AUTO_ASSIGN_SERVER_ERROR",
      message: "Error auto-assigning entitlements",
      details: error.message,
    });
  }
});

// Bulk auto-assign fixed entitlements to all existing participants
router.post("/bulk-assign-fixed", authenticateToken, requirePermission("canManageSettings"), async (req, res) => {
  try {
    const participants = await Participant.find({});
    let updated = 0;

    for (const participant of participants) {
      await autoAssignEntitlements(participant);
      updated++;
    }

    return res.json({
      success: true,
      message: `Fixed entitlements auto-assigned to ${updated} participants`,
      updated,
    });
  } catch (error) {
    console.error("Bulk assign fixed entitlements error:", error);
    return res.status(500).json({
      success: false,
      code: "BULK_ASSIGN_SERVER_ERROR",
      message: "Error bulk assigning fixed entitlements",
      details: error.message,
    });
  }
});

// Export all participants to Excel file (FINALIZED)
router.post(
  "/export-excel",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      // Fetch minimal fields for export
      const participants = await Participant.find({})
        .select("participantId name email phone isPlayer")
        .lean();

      if (!participants || participants.length === 0) {
        return res.status(404).json({
          success: false,
          code: "NO_PARTICIPANTS_FOUND",
          message: "No participants found to export",
        });
      }

      // Map to export rows
      const exportData = participants.map((p) => ({
        "QR Code ID": p.participantId || "",
        Name: p.name || "",
        Email: p.email || "",
        "Phone Number": p.phone || "N/A",
        "Is Player": p.isPlayer ? "Yes" : "No",
      }));

      // Ensure exports folder
      const exportsDir = path.join(__dirname, "..", "exports");
      if (!fs.existsSync(exportsDir)) {
        fs.mkdirSync(exportsDir, { recursive: true });
      }

      // Create workbook
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(exportData);

      // Column widths
      worksheet["!cols"] = [
        { wch: 15 }, // QR Code ID
        { wch: 25 }, // Name
        { wch: 30 }, // Email
        { wch: 18 }, // Phone Number
        { wch: 10 }, // Is Player
      ];

      XLSX.utils.book_append_sheet(workbook, worksheet, "Participants");

      // Filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split(".");
      const filename = `participants_export_${timestamp}.xlsx`;
      const filePath = path.join(exportsDir, filename);

      // Write file
      XLSX.writeFile(workbook, filePath);

      return res.json({
        success: true,
        message: "Participants exported successfully",
        file: {
          filename,
          path: `exports/${filename}`,
          absolutePath: filePath,
        },
      });
    } catch (error) {
      console.error("Export participants error:", error);
      return res.status(500).json({
        success: false,
        code: "EXPORT_PARTICIPANTS_SERVER_ERROR",
        message: "Error exporting participants to Excel",
        details: error.message,
      });
    }
  }
);

// Bulk update existing entitlement maxCount based on current settings
router.post(
  "/bulk-update-entitlement-limits",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      const { entitlementName, newMaxCount, participantType } = req.body;

      // Validation
      if (!entitlementName) {
        return res.status(400).json({
          success: false,
          code: "ENTITLEMENT_NAME_REQUIRED",
          message: "entitlementName is required"
        });
      }

      if (newMaxCount === undefined || newMaxCount === null) {
        return res.status(400).json({
          success: false,
          code: "MAX_COUNT_REQUIRED", 
          message: "newMaxCount is required"
        });
      }

      const maxCount = parseInt(newMaxCount);
      if (isNaN(maxCount) || maxCount < 0) {
        return res.status(400).json({
          success: false,
          code: "INVALID_MAX_COUNT",
          message: "newMaxCount must be a valid positive number"
        });
      }

      // Build filter for participant types
      let participantFilter = {};
      if (participantType === "players") {
        participantFilter.isPlayer = true;
      } else if (participantType === "participants") {
        participantFilter.isPlayer = false;
      }
      // If participantType is "all" or undefined, no filter applied

      // First, check how many participants have this entitlement
      const participantsWithEntitlement = await Participant.countDocuments({
        ...participantFilter,
        "entitlements.name": { $regex: new RegExp(`^${entitlementName}$`, "i") }
      });

      if (participantsWithEntitlement === 0) {
        return res.json({
          success: true,
          message: `No participants found with entitlement "${entitlementName}"`,
          modifiedCount: 0,
          matchedCount: 0
        });
      }

      // Update all participants with this entitlement (case-insensitive)
      const updateResult = await Participant.updateMany(
        {
          ...participantFilter,
          "entitlements.name": { $regex: new RegExp(`^${entitlementName}$`, "i") }
        },
        {
          $set: {
            "entitlements.$[elem].maxCount": maxCount
          }
        },
        {
          arrayFilters: [
            { "elem.name": { $regex: new RegExp(`^${entitlementName}$`, "i") } }
          ]
        }
      );

      // Log the update for audit purposes
      console.log(`Bulk entitlement update completed:`, {
        entitlementName,
        newMaxCount: maxCount,
        participantType: participantType || "all",
        modifiedCount: updateResult.modifiedCount,
        matchedCount: updateResult.matchedCount,
        performedBy: req.user.username
      });

      return res.json({
        success: true,
        message: `Updated ${updateResult.modifiedCount} participants with "${entitlementName}" limit to ${maxCount}`,
        entitlementName,
        newMaxCount: maxCount,
        participantType: participantType || "all",
        modifiedCount: updateResult.modifiedCount,
        matchedCount: updateResult.matchedCount,
        performedBy: req.user.username,
        performedAt: new Date()
      });

    } catch (error) {
      console.error("Bulk update entitlement limits error:", error);
      return res.status(500).json({
        success: false,
        code: "BULK_UPDATE_SERVER_ERROR",
        message: "Error updating entitlement limits",
        details: error.message
      });
    }
  }
);

// Smart sync endpoint - automatically updates all known entitlements based on current settings
router.post(
  "/sync-entitlement-limits",
  authenticateToken,
  requirePermission("canManageSettings"),
  async (req, res) => {
    try {
      const { participantType } = req.body;

      // Build filter for participant types
      let participantFilter = {};
      if (participantType === "players") {
        participantFilter.isPlayer = true;
      } else if (participantType === "participants") {
        participantFilter.isPlayer = false;
      }

      // Get current settings that override entitlement limits
      const settings = await EventSettings.find({
        settingName: { $in: ["beerLimit", "softDrinkLimit"] }
      });

      const settingsMap = {};
      settings.forEach(setting => {
        settingsMap[setting.settingName] = setting.settingValue;
      });

      // Define entitlement mappings
      const entitlementMappings = [
        { name: "Beer", settingKey: "beerLimit" },
        { name: "Soft Drinks", settingKey: "softDrinkLimit" },
        { name: "Soft Drink", settingKey: "softDrinkLimit" }
      ];

      const updateResults = [];
      let totalModified = 0;

      for (const mapping of entitlementMappings) {
        if (settingsMap[mapping.settingKey] !== undefined) {
          const newMaxCount = settingsMap[mapping.settingKey];

          // Update this specific entitlement
          const updateResult = await Participant.updateMany(
            {
              ...participantFilter,
              "entitlements.name": { $regex: new RegExp(`^${mapping.name}$`, "i") }
            },
            {
              $set: {
                "entitlements.$[elem].maxCount": newMaxCount
              }
            },
            {
              arrayFilters: [
                { "elem.name": { $regex: new RegExp(`^${mapping.name}$`, "i") } }
              ]
            }
          );

          updateResults.push({
            entitlementName: mapping.name,
            settingKey: mapping.settingKey,
            newMaxCount,
            modifiedCount: updateResult.modifiedCount,
            matchedCount: updateResult.matchedCount
          });

          totalModified += updateResult.modifiedCount;
        }
      }

      // Log the sync operation
      console.log(`Smart entitlement sync completed:`, {
        participantType: participantType || "all",
        totalModified,
        updates: updateResults,
        performedBy: req.user.username
      });

      return res.json({
        success: true,
        message: `Smart sync completed. Updated ${totalModified} entitlement records across all participants`,
        participantType: participantType || "all",
        totalModified,
        updates: updateResults,
        performedBy: req.user.username,
        performedAt: new Date()
      });

    } catch (error) {
      console.error("Smart sync entitlement limits error:", error);
      return res.status(500).json({
        success: false,
        code: "SMART_SYNC_SERVER_ERROR",
        message: "Error in smart sync of entitlement limits",
        details: error.message
      });
    }
  }
);

module.exports = router;
