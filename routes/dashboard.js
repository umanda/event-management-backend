const express = require("express");
const Participant = require("../models/Participant");
const EntitlementTemplate = require("../models/EntitlementTemplate");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// Dynamic stats endpoint
router.get("/stats", authenticateToken, async (req, res) => {
  try {
    const totalParticipants = await Participant.countDocuments();
    const presentParticipants = await Participant.countDocuments({ isPresent: true });
    const totalPlayers = await Participant.countDocuments({ isPlayer: true });
    const presentPlayers = await Participant.countDocuments({ isPlayer: true, isPresent: true });

    // Get all active templates for dynamic stats
    const templates = await EntitlementTemplate.find({ isActive: true });
    const allParticipants = await Participant.find()
      .select("entitlements isPlayer isPresent")
      .populate("entitlements.templateId", "name category");

    // Calculate dynamic entitlement stats
    const entitlementStats = {};
    for (const template of templates) {
      entitlementStats[template.name] = calculateEntitlementStats(allParticipants, template);
    }

    // Get recent attendance
    const recentAttendance = await Participant.find({ isPresent: true })
      .select("participantId name isPlayer attendanceTime")
      .sort({ attendanceTime: -1 })
      .limit(10);

    // Get recent distributions
    const recentDistributions = await Participant.find({
      "entitlements.givenAt.0": { $exists: true },
    })
      .select("participantId name isPlayer entitlements entitlementHistory")
      .sort({ "entitlementHistory.performedAt": -1 })
      .limit(10)
      .populate("entitlements.givenBy", "username")
      .populate("entitlementHistory.performedBy", "username");

    const processedDistributions = recentDistributions
      .map((p) => {
        const distributions = [];
        
        // Process recent distributions from history
        const recentHistory = p.entitlementHistory
          .filter(h => h.action === "distributed")
          .sort((a, b) => new Date(b.performedAt) - new Date(a.performedAt))
          .slice(0, 5);

        for (const history of recentHistory) {
          distributions.push({
            entitlementName: history.entitlementName,
            count: history.count,
            performedAt: history.performedAt,
            performedBy: history.performedBy?.username,
          });
        }

        return {
          participantId: p.participantId,
          name: p.name,
          isPlayer: p.isPlayer,
          distributions,
        };
      })
      .filter((p) => p.distributions.length > 0);

    return res.json({
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
    return res.status(500).json({
      success: false,
      code: "DASHBOARD_SERVER_ERROR",
      message: "Error fetching dashboard statistics",
      details: error.message,
    });
  }
});

// Helper function for dynamic entitlement stats
function calculateEntitlementStats(participants, template) {
  const eligible = participants.filter((p) =>
    p.entitlements.some((e) => e.name === template.name)
  );

  if (template.isCountable) {
    const givenParticipants = eligible.filter((p) => {
      const entitlement = p.entitlements.find((e) => e.name === template.name);
      return entitlement && entitlement.given > 0;
    });

    const pendingParticipants = eligible.filter((p) => {
      const entitlement = p.entitlements.find((e) => e.name === template.name);
      return entitlement && entitlement.given === 0 && p.isPresent;
    });

    const totalCountGiven = eligible.reduce((sum, p) => {
      const entitlement = p.entitlements.find((e) => e.name === template.name);
      return sum + (entitlement ? entitlement.given : 0);
    }, 0);

    return {
      given: givenParticipants.length,
      pending: pendingParticipants.length,
      totalEligible: eligible.length,
      percentage: eligible.length > 0 ? Math.round((givenParticipants.length / eligible.length) * 100) : 0,
      totalCountGiven,
      isCountable: true,
    };
  } else {
    const given = eligible.filter((p) => {
      const entitlement = p.entitlements.find((e) => e.name === template.name);
      return entitlement && entitlement.given > 0;
    });

    const pending = eligible.filter((p) => {
      const entitlement = p.entitlements.find((e) => e.name === template.name);
      return entitlement && entitlement.given === 0 && p.isPresent;
    });

    return {
      given: given.length,
      pending: pending.length,
      totalEligible: eligible.length,
      percentage: eligible.length > 0 ? Math.round((given.length / eligible.length) * 100) : 0,
      isCountable: false,
    };
  }
}

module.exports = router;
