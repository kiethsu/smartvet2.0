// adminController.js

const bcrypt = require("bcryptjs");
const User = require("../models/user");
const jwt = require("jsonwebtoken");
const path = require('path');
const Pet = require("../models/pet");
const Reservation = require("../models/reservation");
const About = require("../models/about");
const PetDetailsSetting = require("../models/petDetailsSetting");
const ExcelJS = require('exceljs');
const Payment = require('../models/Payment');
const Inventory = require('../models/inventory');
const { Parser: Json2csvParser } = require('json2csv');
const PDFDocument = require('pdfkit');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

/**
 * Create a new Doctor/HR account
 */
exports.createAccount = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: "All fields are required!" });
    }
    if (!["Doctor", "HR"].includes(role)) {
      return res.status(400).json({ message: "Invalid role! Only Doctor or HR can be created." });
    }
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email is already in use!" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      username: name,
      email,
      password: hashedPassword,
      role,
      status: "Active"
    });
    await newUser.save();
    const token = jwt.sign(
      { userId: newUser._id, role: newUser.role },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    res.status(201).json({
      message: `Successfully created ${role} account!`,
      user: newUser,
      token,
      redirect: role === "Doctor" ? "/doctor-dashboard" : "/hr-dashboard"
    });
  } catch (error) {
    console.error("Error creating account:", error);
    res.status(500).json({ message: "Server error creating account." });
  }
};

/**
 * Get all accounts (excluding Customers)
 */
exports.getAccounts = async (req, res) => {
  try {
    const { search } = req.query;
    let query = { role: { $in: ["Doctor", "HR"] } };
    if (search) {
      query.$or = [
        { username: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } }
      ];
    }
    const users = await User.find(query).select("-password");
    res.status(200).json({ users });
  } catch (error) {
    console.error("Error getting accounts:", error);
    res.status(500).json({ message: "Server error retrieving accounts." });
  }
};

/**
 * Reset an account (only for Doctor/HR)
 */
exports.resetAccount = async (req, res) => {
  try {
    const { userId, newEmail, newPassword } = req.body;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "Account not found!" });
    }
    if (!["Doctor", "HR"].includes(user.role)) {
      return res.status(400).json({ message: "Only Doctor and HR accounts can be reset!" });
    }
    if (newEmail) {
      const existingEmail = await User.findOne({ email: newEmail });
      if (existingEmail && existingEmail._id.toString() !== user._id.toString()) {
        return res.status(400).json({ message: "That email is already in use!" });
      }
      user.email = newEmail;
    }
    if (newPassword) {
      user.password = await bcrypt.hash(newPassword, 10);
    }
    await user.save();
    res.status(200).json({ message: "Account updated successfully!" });
  } catch (error) {
    console.error("Error resetting account:", error);
    res.status(500).json({ message: "Server error resetting account." });
  }
};

/**
 * Delete an account (only for Doctor/HR)
 */
exports.deleteAccount = async (req, res) => {
  try {
    const user = await User.findById(req.body.userId);
    if (!user) {
      return res.status(404).json({ message: "Account not found!" });
    }
    if (!["Doctor", "HR"].includes(user.role)) {
      return res.status(400).json({ message: "Only Doctor and HR accounts can be deleted!" });
    }
    await User.findByIdAndDelete(req.body.userId);
    res.status(200).json({ message: "Account deleted successfully." });
  } catch (error) {
    console.error("Error deleting account:", error);
    res.status(500).json({ message: "Server error deleting account." });
  }
};

/**
 * Get account details
 */
exports.getAccountProfile = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    res.status(200).json({ user });
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({ message: "Server error fetching profile." });
  }
};

/**
 * Update profile (including profile pic)
 */
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.body.userId;
    if (!userId) {
      return res.status(400).json({ success: false, message: "User id is required." });
    }
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    if (req.body.username) {
      user.username = req.body.username;
    }
    if (req.body.email) {
      user.email = req.body.email;
    }
    if (req.body.password) {
      const hashedPassword = await bcrypt.hash(req.body.password, 10);
      user.password = hashedPassword;
    }
    if (req.file) {
      user.profilePic = '/uploads/' + req.file.filename;
    }
    await user.save();
    return res.status(200).json({ success: true, user });
  } catch (error) {
    console.error("Error updating profile:", error);
    return res.status(500).json({ success: false, message: "Server error updating profile." });
  }
};

// NEW: Update OTP Setting Endpoint for Admin
exports.updateOTPSetting = async (req, res) => {
  try {
    const { userId, otpEnabled } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID is required." });
    }
    const user = await User.findById(userId);
    if (!user || user.role !== "Admin") {
      return res.status(404).json({ success: false, message: "Admin user not found." });
    }
    user.otpEnabled = otpEnabled;
    await user.save();
    res.status(200).json({ success: true, message: "OTP setting updated.", user });
  } catch (error) {
    console.error("Error updating OTP setting:", error);
    res.status(500).json({ success: false, message: "Server error updating OTP setting." });
  }
};

/**
 * Get Dashboard Statistics
 */
exports.getDashboardStats = async (req, res) => {
  try {
    // 0) Parse & normalize query params
    let range = req.query.range || "7d";
    const compare = req.query.compare || "prev"; // 'prev' or 'yoy' or 'none'
    const startQ = req.query.start;  // for custom
    const endQ = req.query.end;    // for custom

    // Normalize synonyms:
    if (range === "30d" || range === "mtd") range = "month";
    if (range === "ytd") range = "year";

    // Set "now" to end‐of‐today in the server's timezone
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    

    // ── “Today” Branch ──────────────────────────────────────────────────────
    if (range === "today") {
      // Define curFrom/curTo = today’s midnight → 23:59:59.999
      const curFrom = new Date(now);
      curFrom.setHours(0, 0, 0, 0);
      const curTo = new Date(now); // already at 23:59:59.999

      // Define prevFrom/prevTo = yesterday’s midnight → 23:59:59.999
      const prevTo = new Date(curFrom.getTime() - 1);
      const prevFrom = new Date(prevTo);
      prevFrom.setHours(0, 0, 0, 0);

      // 1) Count & sum “today”
      const [todayTxns, todayRevAgg] = await Promise.all([
        Payment.countDocuments({ paidAt: { $gte: curFrom, $lte: curTo } }),
        Payment.aggregate([
          { $match: { paidAt: { $gte: curFrom, $lte: curTo } } },
          { $group: { _id: null, total: { $sum: "$amount" } } }
        ])
      ]);
      const todayRev = todayRevAgg[0]?.total || 0;

      // 2) Count & sum “yesterday”
      const [yestTxns, yestRevAgg] = await Promise.all([
        Payment.countDocuments({ paidAt: { $gte: prevFrom, $lte: prevTo } }),
        Payment.aggregate([
          { $match: { paidAt: { $gte: prevFrom, $lte: prevTo } } },
          { $group: { _id: null, total: { $sum: "$amount" } } }
        ])
      ]);
      const yestRev = yestRevAgg[0]?.total || 0;

      // 3) Compute COGS for “today”
      const curCogsAgg = await Payment.aggregate([
        { $match: { paidAt: { $gte: curFrom, $lte: curTo } } },
        { $unwind: "$products" },
        {
          $lookup: {
            from: "inventories",
            localField: "products.name",
            foreignField: "name",
            as: "inv"
          }
        },
        { $unwind: "$inv" },
        {
          $group: {
            _id: null,
            totalCOGS: { $sum: { $multiply: ["$products.quantity", "$inv.basePrice"] } }
          }
        }
      ]);
      const curCogs = curCogsAgg[0]?.totalCOGS || 0;

      // 4) Compute COGS for “yesterday”
      const prevCogsAgg = await Payment.aggregate([
        { $match: { paidAt: { $gte: prevFrom, $lte: prevTo } } },
        { $unwind: "$products" },
        {
          $lookup: {
            from: "inventories",
            localField: "products.name",
            foreignField: "name",
            as: "inv"
          }
        },
        { $unwind: "$inv" },
        {
          $group: {
            _id: null,
            totalCOGS: { $sum: { $multiply: ["$products.quantity", "$inv.basePrice"] } }
          }
        }
      ]);
      const prevCogs = prevCogsAgg[0]?.totalCOGS || 0;

      // 5) Compute expired‐loss “today”
     // (updated code)
const curExpiredAgg = await Inventory.aggregate([
  { $unwind: "$expiredDates" },
  {
    $match: {
      expiredDates: { $gte: curFrom, $lte: curTo }
    }
  },
  {
    $group: {
      _id: null,
      totalExpiredLoss: { $sum: "$basePrice" }    // ← now summing cost instead of price
    }
  }
]);
const curExpiredLoss = curExpiredAgg[0]?.totalExpiredLoss || 0;

const prevExpiredAgg = await Inventory.aggregate([
  { $unwind: "$expiredDates" },
  {
    $match: {
      expiredDates: { $gte: prevFrom, $lte: prevTo }
    }
  },
  {
    $group: {
      _id: null,
      totalExpiredLoss: { $sum: "$basePrice" }    // ← now summing cost instead of price
    }
  }
]);
const prevExpiredLoss = prevExpiredAgg[0]?.totalExpiredLoss || 0;

// … later …
// after:
const curProfit    = todayRev    - curCogs    - curExpiredLoss;
const prevProfit   = yestRev     - prevCogs   - prevExpiredLoss;



      // 8) Build a tiny “trend” array (1‐day only)
      const trendLabels = [curFrom.toISOString().slice(0, 10)];
      const trendData = [todayRev];
      const prevTrend = [yestRev];

      // 9) Fetch all “today” payments for the table
      const paymentsToday = await Payment.find({
        paidAt: { $gte: curFrom, $lte: curTo }
      })
        .populate("by", "username")
        .populate("customer", "username")
        .lean();

      const transactions = paymentsToday.map(p => ({
        date: p.paidAt.toISOString().slice(0, 10),
        id: p._id.toString().slice(-6),
        customer: p.customer?.username || "N/A",
        cashier: p.by?.username || "N/A",
        items: [
          ...(p.services || []).map(s => s.name),
          ...(p.products || []).map(x => x.name)
        ].join(", "),
        amount: p.amount
      }));

      // … build revenueByService, topSKUs, new vs returning … (omit here for brevity)
    // ─── **NEW** ─── Compute user‐counts by role
      const doctorsCount   = await User.countDocuments({ role: "Doctor" });
      const hrCount        = await User.countDocuments({ role: "HR" });
      const customersCount = await User.countDocuments({ role: "Customer" });
      // 10) Assemble entire payload
      const dashboardStats = {
        appointmentTrends: { labels: [], pending: [], approved: [], completed: [] },
        servicesData: { labels: [], data: [] },
        petsData: { labels: [], datasets: [] },
        diseaseData: { labels: [], data: [] },
        userStats: { doctors: 0, hr: 0, customers: 0 },
        activityFeed: [],

        // ─── “Today” Sales Section ───────────────────────────────────────────
        sales: {
          totalTransactions: todayTxns,
          totalRevenue: todayRev,
          profit: curProfit,
          trend: { labels: trendLabels, data: trendData },
          prevTrend: prevTrend,
          heatmap: { [trendLabels[0]]: todayRev },
          comparison: {
            currentTransactions: todayTxns,
            prevTransactions: yestTxns,
            transactionsChangePercent: yestTxns ? ((todayTxns - yestTxns) / yestTxns) * 100 : 0,
            currentRevenue: todayRev,
            prevRevenue: yestRev,
            revenueChangePercent: yestRev ? ((todayRev - yestRev) / yestRev) * 100 : 0,
            currentProfit: curProfit,
            prevProfit: prevProfit
          },
          transactions
        },
        descriptive: {
          // revenueByService, topSKUs, newCustomers, returningCustomers
          revenueByService: [], // fill in as before
          topSKUs: [], // fill in as before
          newCustomers: 0, // …
          returningCustomers: 0
        }
      };

      return res.json(dashboardStats);
    }
    // ────────────────────────────────────────────────────────────────────────────

    // ── “All Other Ranges” (7d, 30d/month, year, or custom) ─────────────────
    // We’ll build curFrom/curTo + prevFrom/prevTo exactly as before,
    // then do the same steps (sum revenue, sum COGS, sum expiredLoss).
    let curFrom, curToVal = now, prevFrom, prevTo;
    const trendLabels = [], trendData = [], prevTrend = [];

    // 1) Build current & previous windows
    if (range === "7d") {
      curFrom = new Date(now);
      curFrom.setDate(now.getDate() - 6);
      curFrom.setHours(0, 0, 0, 0);

      if (compare === "prev") {
        prevTo = new Date(curFrom);
        prevTo.setDate(curFrom.getDate() - 1);
        prevTo.setHours(23, 59, 59, 999);

        prevFrom = new Date(prevTo);
        prevFrom.setDate(prevTo.getDate() - 6);
        prevFrom.setHours(0, 0, 0, 0);
      } else {
        // YoY: same dates last year
        prevFrom = new Date(curFrom);
        prevFrom.setFullYear(curFrom.getFullYear() - 1);
        prevTo = new Date(curToVal);
        prevTo.setFullYear(curToVal.getFullYear() - 1);
      }

      // Build daily arrays
      for (let d = new Date(curFrom); d <= curToVal; d.setDate(d.getDate() + 1)) {
        const s = new Date(d);
        s.setHours(0, 0, 0, 0);
        const e = new Date(d);
        e.setHours(23, 59, 59, 999);

        trendLabels.push(d.toISOString().slice(0, 10));

        // Sum revenue for that day
        // eslint-disable-next-line no-await-in-loop
        const agg = await Payment.aggregate([
          { $match: { paidAt: { $gte: s, $lte: e } } },
          { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        trendData.push(agg[0]?.total || 0);

        if (prevFrom) {
          let ps, pe;
          if (compare === "yoy") {
            const pd = new Date(s);
            pd.setFullYear(s.getFullYear() - 1);
            ps = pd;
            pe = new Date(pd);
            pe.setHours(23, 59, 59, 999);
          } else {
            // “prev” week
            const pd = new Date(s.getTime() - 7 * 24 * 60 * 60 * 1000);
            ps = new Date(pd);
            ps.setHours(0, 0, 0, 0);
            pe = new Date(pd);
            pe.setHours(23, 59, 59, 999);
          }
          // eslint-disable-next-line no-await-in-loop
          const piff = await Payment.aggregate([
            { $match: { paidAt: { $gte: ps, $lte: pe } } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
          ]);
          prevTrend.push(piff[0]?.total || 0);
        }
      }
    } else if (range === "month") {
      curFrom = new Date(now.getFullYear(), now.getMonth(), 1);
      if (compare === "prev") {
        prevTo = new Date(curFrom);
        prevTo.setDate(0);
        prevTo.setHours(23, 59, 59, 999);
        prevFrom = new Date(prevTo.getFullYear(), prevTo.getMonth(), 1);
      } else {
        prevFrom = new Date(curFrom);
        prevFrom.setFullYear(curFrom.getFullYear() - 1);
        prevTo = new Date(curToVal);
        prevTo.setFullYear(curToVal.getFullYear() - 1);
      }
      for (let d = new Date(curFrom); d <= curToVal; d.setDate(d.getDate() + 1)) {
        const s = new Date(d);
        s.setHours(0, 0, 0, 0);
        const e = new Date(d);
        e.setHours(23, 59, 59, 999);
        trendLabels.push(d.toISOString().slice(0, 10));

        // eslint-disable-next-line no-await-in-loop
        const agg = await Payment.aggregate([
          { $match: { paidAt: { $gte: s, $lte: e } } },
          { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        trendData.push(agg[0]?.total || 0);

        if (prevFrom) {
          let ps, pe;
          if (compare === "yoy") {
            const pd = new Date(s);
            pd.setFullYear(s.getFullYear() - 1);
            ps = pd;
            pe = new Date(pd);
            pe.setHours(23, 59, 59, 999);
          } else {
            const pd = new Date(s);
            pd.setMonth(s.getMonth() - 1);
            ps = new Date(pd);
            ps.setHours(0, 0, 0, 0);
            pe = new Date(pd);
            pe.setHours(23, 59, 59, 999);
          }
          // eslint-disable-next-line no-await-in-loop
          const piff = await Payment.aggregate([
            { $match: { paidAt: { $gte: ps, $lte: pe } } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
          ]);
          prevTrend.push(piff[0]?.total || 0);
        }
      }
    } else if (range === "year") {
      curFrom = new Date(now.getFullYear(), 0, 1);
      if (compare === "prev") {
        const tmp = new Date(curFrom);
        tmp.setFullYear(curFrom.getFullYear() - 1);
        prevFrom = tmp;
        prevTo = new Date(curToVal);
        prevTo.setFullYear(curToVal.getFullYear() - 1);
      } else {
        prevFrom = new Date(curFrom);
        prevFrom.setFullYear(curFrom.getFullYear() - 1);
        prevTo = new Date(curToVal);
        prevTo.setFullYear(curToVal.getFullYear() - 1);
      }
      for (let m = 0; m <= now.getMonth(); m++) {
        const ms = new Date(now.getFullYear(), m, 1);
        const me = new Date(now.getFullYear(), m + 1, 0, 23, 59, 59, 999);
        trendLabels.push(String(m + 1));

        // eslint-disable-next-line no-await-in-loop
        const agg = await Payment.aggregate([
          { $match: { paidAt: { $gte: ms, $lte: me } } },
          { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        trendData.push(agg[0]?.total || 0);

        if (prevFrom) {
          let pms = new Date(ms);
          pms.setFullYear(ms.getFullYear() - 1);
          let pme = new Date(me);
          pme.setFullYear(me.getFullYear() - 1);
          // eslint-disable-next-line no-await-in-loop
          const piff = await Payment.aggregate([
            { $match: { paidAt: { $gte: pms, $lte: pme } } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
          ]);
          prevTrend.push(piff[0]?.total || 0);
        }
      }
    } else if (range === "custom" && startQ && endQ) {
      curFrom = new Date(startQ);
      curFrom.setHours(0, 0, 0, 0);
      curToVal = new Date(endQ);
      curToVal.setHours(23, 59, 59, 999);
      const diff = curToVal.getTime() - curFrom.getTime();

      if (compare === "prev") {
        prevTo = new Date(curFrom.getTime() - 1);
        prevTo.setHours(23, 59, 59, 999);
        prevFrom = new Date(prevTo.getTime() - diff);
        prevFrom.setHours(0, 0, 0, 0);
      } else {
        prevFrom = new Date(curFrom);
        prevFrom.setFullYear(curFrom.getFullYear() - 1);
        prevTo = new Date(curToVal);
        prevTo.setFullYear(curToVal.getFullYear() - 1);
      }

      for (let d = new Date(curFrom); d <= curToVal; d.setDate(d.getDate() + 1)) {
        const s = new Date(d);
        s.setHours(0, 0, 0, 0);
        const e = new Date(d);
        e.setHours(23, 59, 59, 999);
        trendLabels.push(d.toISOString().slice(0, 10));

        // eslint-disable-next-line no-await-in-loop
        const agg = await Payment.aggregate([
          { $match: { paidAt: { $gte: s, $lte: e } } },
          { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        trendData.push(agg[0]?.total || 0);

        if (prevFrom) {
          let pd;
          if (compare === "yoy") {
            pd = new Date(s);
            pd.setFullYear(s.getFullYear() - 1);
          } else {
            pd = new Date(s.getTime() - diff - 24 * 60 * 60 * 1000);
          }
          const ps = new Date(pd);
          ps.setHours(0, 0, 0, 0);
          const pe = new Date(pd);
          pe.setHours(23, 59, 59, 999);

          // eslint-disable-next-line no-await-in-loop
          const piff = await Payment.aggregate([
            { $match: { paidAt: { $gte: ps, $lte: pe } } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
          ]);
          prevTrend.push(piff[0]?.total || 0);
        }
      }
    }

    // ── 2) Totals & revenue for the entire [curFrom … curToVal]
    const [currTxns, currRevAgg] = await Promise.all([
      Payment.countDocuments({ paidAt: { $gte: curFrom, $lte: curToVal } }),
      Payment.aggregate([
        { $match: { paidAt: { $gte: curFrom, $lte: curToVal } } },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ])
    ]);
    const currRev = currRevAgg[0]?.total || 0;

    // 3) Compute total COGS over [curFrom … curToVal]
    const curCogsAgg2 = await Payment.aggregate([
      { $match: { paidAt: { $gte: curFrom, $lte: curToVal } } },
      { $unwind: "$products" },
      {
        $lookup: {
          from: "inventories",
          localField: "products.name",
          foreignField: "name",
          as: "inv"
        }
      },
      { $unwind: "$inv" },
      {
        $group: {
          _id: null,
          totalCOGS: { $sum: { $multiply: ["$products.quantity", "$inv.basePrice"] } }
        }
      }
    ]);
    const curCogs2 = curCogsAgg2[0]?.totalCOGS || 0;

    // 4) Compute expired loss over [curFrom … curToVal]
    // (updated code in “All Other Ranges”)
// 4) Compute expired loss over [curFrom … curToVal]
const curExpiredAgg2 = await Inventory.aggregate([
  { $unwind: "$expirationDates" },
  {
    $match: {
      expirationDates: { $gte: curFrom, $lte: curToVal }
    }
  },
  {
    $group: {
      _id: null,
      totalExpiredLoss: { $sum: "$basePrice" }
    }
  }
]);
const curExpiredLoss2 = curExpiredAgg2[0]?.totalExpiredLoss || 0;


// … after COGS, compute profit …
const curProfit2   = currRev  - curCogs2    - curExpiredLoss2;



    // 6) Build a heatmap object
    const heatmap = {};
    trendLabels.forEach((d, i) => (heatmap[d] = trendData[i]));

    // 7) Fetch all payments for [curFrom … curToVal] to build the transaction list
    const paymentsInRange = await Payment.find({
      paidAt: { $gte: curFrom, $lte: curToVal }
    })
      .populate("by", "username")
      .populate("customer", "username")
      .lean();

    const transactions2 = paymentsInRange.map(p => ({
      date: p.paidAt.toISOString().slice(0, 10),
      id: p._id.toString().slice(-6),
      customer: p.customer?.username || "N/A",
      cashier: p.by?.username || "N/A",
      items: [
        ...(p.services || []).map(s => s.name),
        ...(p.products || []).map(x => x.name)
      ].join(", "),
      amount: p.amount
    }));
   // ─── **NEW** ─── Compute user‐counts by role
    const doctorsCount2   = await User.countDocuments({ role: "Doctor" });
    const hrCount2        = await User.countDocuments({ role: "HR" });
    const customersCount2 = await User.countDocuments({ role: "Customer" });

    // 8) Attach basic sales object to the payload
  const dashboardStats = {
      appointmentTrends: { labels: trendLabels, pending: [], approved: [], completed: [] },
      servicesData:      { labels: [], data: [] },
      petsData:          { labels: [], datasets: [] },
      diseaseData:       { labels: [], data: [] },
      userStats: {
        doctors:   doctorsCount2,
        hr:        hrCount2,
        customers: customersCount2
      },
      activityFeed:       [],
      sales: {
        totalTransactions: currTxns,
        totalRevenue:      currRev,
        profit:            curProfit2,
        trend:             { labels: trendLabels, data: trendData },
        prevTrend:         prevTrend.length ? prevTrend : undefined,
        heatmap,
        transactions:      transactions2
      },
      descriptive: {
        revenueByService: [],
        topSKUs:          [],
        newCustomers:     0,
        returningCustomers: 0
      }
    };

    // 9) If there is a prevFrom, compute previous‐period totals/profit too
    if (prevFrom) {
      const [prevTxns, prevRevAgg] = await Promise.all([
        Payment.countDocuments({ paidAt: { $gte: prevFrom, $lte: prevTo } }),
        Payment.aggregate([
          { $match: { paidAt: { $gte: prevFrom, $lte: prevTo } } },
          { $group: { _id: null, total: { $sum: "$amount" } } }
        ])
      ]);
      const prevRev = prevRevAgg[0]?.total || 0;

      // Prev COGS:
      const prevCogsAgg2 = await Payment.aggregate([
        { $match: { paidAt: { $gte: prevFrom, $lte: prevTo } } },
        { $unwind: "$products" },
        {
          $lookup: {
            from: "inventories",
            localField: "products.name",
            foreignField: "name",
            as: "inv"
          }
        },
        { $unwind: "$inv" },
        {
          $group: {
            _id: null,
            totalCOGS: { $sum: { $multiply: ["$products.quantity", "$inv.basePrice"] } }
          }
        }
      ]);
      const prevCogs2 = prevCogsAgg2[0]?.totalCOGS || 0;

      // Prev expired loss:
const prevExpiredAgg2 = await Inventory.aggregate([
  { $unwind: "$expirationDates" },
  {
    $match: {
      expirationDates: { $gte: prevFrom, $lte: prevTo }
    }
  },
  {
    $group: {
      _id: null,
      totalExpiredLoss: { $sum: "$basePrice" }
    }
  }
]);
const prevExpiredLoss2 = prevExpiredAgg2[0]?.totalExpiredLoss || 0;


  const prevProfit2  = prevRev  - prevCogs2   - prevExpiredLoss2;

      dashboardStats.sales.comparison = {
        currentTransactions: currTxns,
        prevTransactions: prevTxns,
        transactionsChangePercent: prevTxns ? ((currTxns - prevTxns) / prevTxns) * 100 : 0,
        currentRevenue: currRev,
        prevRevenue: prevRev,
        revenueChangePercent: prevRev ? ((currRev - prevRev) / prevRev) * 100 : 0,
        currentProfit: curProfit2,
        prevProfit: prevProfit2
      };
    }

    console.log("[getDashboardStats] returning →", dashboardStats.sales);
    return res.json(dashboardStats);
  } catch (error) {
    console.error("Error in getDashboardStats:", error);
    return res.status(500).json({ error: "Server error" });
  }
};

// ─── 1) GET /admin/get-categories ─────────────────────────────────────────
exports.getCategories = async (req, res) => {
  try {
    // Fetch distinct categories from Inventory schema
    const categories = await Inventory.distinct('category');
    return res.json(categories);
  } catch (err) {
    console.error('Error fetching categories:', err);
    return res.status(500).json({ error: 'Server error fetching categories' });
  }
};
exports.getTopCategory = async (req, res) => {
  try {
    // Only implement “week” for now. You could expand to month/year if desired.
    const range = req.query.range || "week";
    const now = new Date();
    let startDate;

    if (range === "week") {
      const weekAgo = new Date(now);
      weekAgo.setDate(now.getDate() - 6);
      weekAgo.setHours(0, 0, 0, 0);
      startDate = weekAgo;
    } else {
      // Fallback to exactly 7 days.
      const weekAgo = new Date(now);
      weekAgo.setDate(now.getDate() - 6);
      weekAgo.setHours(0, 0, 0, 0);
      startDate = weekAgo;
    }

    // 1) Aggregate Payments → join into Inventory → group by inv.category → sum lineTotal
    const pipeline = [
      // Match only payments in the last 7 days:
      { $match: { paidAt: { $gte: startDate, $lte: now } } },
      // Unwind products[] so we can get each line:
      { $unwind: "$products" },
      {
        $lookup: {
          from: "inventories",
          localField: "products.name",
          foreignField: "name",
          as: "inv"
        }
      },
      { $unwind: "$inv" },
      // Now group by inv.category, summing up lineTotal:
      {
        $group: {
          _id: "$inv.category",
          totalRevenue: { $sum: "$products.lineTotal" }
        }
      },
      // Sort descending by totalRevenue, take the top 1:
      { $sort: { totalRevenue: -1 } },
      { $limit: 1 }
    ];

    const agg = await Payment.aggregate(pipeline);
    const topRow = agg[0] || null;

    if (!topRow) {
      return res.json({ topCategory: null });
    }
    return res.json({ topCategory: topRow._id });
  } catch (err) {
    console.error("Error in getTopCategory:", err);
    return res.status(500).json({ error: "Server error fetching top category." });
  }
};
// ─── 2) GET /admin/get-sales-by-category?category=... ─────────────────────
// adminController.js
exports.getSalesByCategory = async (req, res) => {
  try {
    const category = req.query.category;
    if (!category) {
      return res.status(400).json({ error: "Category is required" });
    }

    const range = req.query.range || "week";
    const now = new Date();
    let startDate = null;

    // 1) Determine startDate for “current” window
    switch (range) {
      case "day": {
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);
        startDate = today;
        break;
      }
      case "week": {
        const weekAgo = new Date(now);
        weekAgo.setDate(now.getDate() - 6);
        weekAgo.setHours(0, 0, 0, 0);
        startDate = weekAgo;
        break;
      }
      case "month": {
        // first day of current month
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      }
      case "year": {
        // first day of current year
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      }
      default:
        // default “week”
        const wk = new Date(now);
        wk.setDate(now.getDate() - 6);
        wk.setHours(0, 0, 0, 0);
        startDate = wk;
    }

    // ─── A) Compute “current” totals:
    // (A1) Payments pipeline to get revenue & COGS
    const paymentPipeline = [];
    if (startDate) {
      paymentPipeline.push({
        $match: { paidAt: { $gte: startDate, $lte: now } }
      });
    }
    paymentPipeline.push({ $unwind: "$products" });
    paymentPipeline.push({
      $lookup: {
        from: "inventories",
        localField: "products.name",
        foreignField: "name",
        as: "inv"
      }
    });
    paymentPipeline.push({ $unwind: "$inv" });
    paymentPipeline.push({ $match: { "inv.category": category } });
    paymentPipeline.push({
      $group: {
        _id: null,
        totalRevenue: { $sum: "$products.lineTotal" },
        totalCOGS: { $sum: { $multiply: ["$products.quantity", "$inv.basePrice"] } }
      }
    });

    const revenueAndCogsAgg = await Payment.aggregate(paymentPipeline);
    const revenueRow = revenueAndCogsAgg[0] || {};
    const totalRevenue = revenueRow.totalRevenue || 0;
    const totalCOGS = revenueRow.totalCOGS || 0;

    // (A2) Expired loss pipeline (for this same category):
   // (updated code in getSalesByCategory)
const expiredPipeline = [];
expiredPipeline.push({ $match: { category: category } });
expiredPipeline.push({ $unwind: "$expirationDates" });
if (startDate) {
  expiredPipeline.push({
    $match: { expirationDates: { $gte: startDate, $lte: now } }
  });
} else {
  expiredPipeline.push({
    $match: { expirationDates: { $lte: now } }
  });
}
expiredPipeline.push({
  $group: { _id: null, totalExpiredLoss: { $sum: "$basePrice" } }
});
const expiredAgg = await Inventory.aggregate(expiredPipeline);
const expiredRow = expiredAgg[0] || {};
const totalExpiredLoss = expiredRow.totalExpiredLoss || 0;



    // ─── B) Compute “previous” equivalent‐period revenue:
    let lastPeriodStart = null;
    let lastPeriodEnd = null;
    if (range === "day") {
      // previous day = [yesterday midnight … yesterday 23:59:59]
      const todayMid = new Date(startDate);
      const prevDayEnd = new Date(todayMid.getTime() - 1);
      const prevDayStart = new Date(prevDayEnd);
      prevDayStart.setHours(0, 0, 0, 0);
      lastPeriodStart = prevDayStart;
      lastPeriodEnd = prevDayEnd;
    } else if (range === "week") {
      // previous 7 days = [startDate - 7 days … startDate - 1 ms]
      const curStart = new Date(startDate);
      const prevEnd = new Date(curStart.getTime() - 1);
      const prevStart = new Date(prevEnd);
      prevStart.setDate(prevEnd.getDate() - 6);
      prevStart.setHours(0, 0, 0, 0);
      lastPeriodStart = prevStart;
      lastPeriodEnd = prevEnd;
    } else if (range === "month") {
      const curStart = new Date(startDate);
      // previous month end = curStart - 1 ms
      const prevEnd = new Date(curStart.getTime() - 1);
      // previous month start = first day of prevEnd.month
      const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), 1);
      lastPeriodStart = prevStart;
      lastPeriodEnd = prevEnd;
    } else if (range === "year") {
      const curStart = new Date(startDate);
      // previous year end = curStart - 1 ms
      const prevEnd = new Date(curStart.getTime() - 1);
      // previous year start = Jan 1 of prevEnd.year
      const prevStart = new Date(prevEnd.getFullYear(), 0, 1);
      lastPeriodStart = prevStart;
      lastPeriodEnd = prevEnd;
    } else {
      // fallback to “week”
      const curStart = new Date(startDate);
      const prevEnd = new Date(curStart.getTime() - 1);
      const prevStart = new Date(prevEnd);
      prevStart.setDate(prevEnd.getDate() - 6);
      prevStart.setHours(0, 0, 0, 0);
      lastPeriodStart = prevStart;
      lastPeriodEnd = prevEnd;
    }

    let lastPeriodRevenue = 0;
    if (lastPeriodStart && lastPeriodEnd) {
      const prevPipeline = [];
      prevPipeline.push({
        $match: { paidAt: { $gte: lastPeriodStart, $lte: lastPeriodEnd } }
      });
      prevPipeline.push({ $unwind: "$products" });
      prevPipeline.push({
        $lookup: {
          from: "inventories",
          localField: "products.name",
          foreignField: "name",
          as: "inv"
        }
      });
      prevPipeline.push({ $unwind: "$inv" });
      prevPipeline.push({ $match: { "inv.category": category } });
      prevPipeline.push({
        $group: {
          _id: null,
          totalRevenue: { $sum: "$products.lineTotal" }
        }
      });

      const lastAgg = await Payment.aggregate(prevPipeline);
      lastPeriodRevenue = (lastAgg[0] && lastAgg[0].totalRevenue) || 0;
    }

    return res.json({
      totalRevenue,
      totalCOGS,
      totalExpiredLoss,
      lastPeriodRevenue
    });
  } catch (err) {
    console.error("Error in getSalesByCategory:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

exports.getAbout = async (req, res) => {
  try {
    let aboutContent = await About.findOne();
    if (!aboutContent) {
      // Default object if none exists
      aboutContent = { aboutDescription: "", doctors: [] };
    }
    res.render("about", { about: aboutContent });
  } catch (error) {
    console.error("Error fetching about content:", error);
    res.status(500).send("Server error fetching about content");
  }
};
// ─── GET /admin/get-sales-by-product?category=<>&range=<>
exports.getSalesByProduct = async (req, res) => {
  try {
    const category = req.query.category || "";  // optional
    const range = req.query.range || "day";     // 'day' | 'week' | 'month' | 'year'
    const now = new Date();
    now.setHours(23, 59, 59, 999);

    // 1) Determine startDate based on range
    let startDate;
    switch (range) {
      case "day":
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "week":
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 6);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "month":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "year":
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        // fallback to last 7 days
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 6);
        startDate.setHours(0, 0, 0, 0);
    }

    // 2) Build aggregation pipeline
    const pipeline = [];

    // (A) Match by paidAt window
    if (startDate) {
      pipeline.push({
        $match: { paidAt: { $gte: startDate, $lte: now } }
      });
    }

    // (B) Unwind products array
    pipeline.push({ $unwind: "$products" });

    // (C) Lookup Inventory so we can filter by category if needed
    pipeline.push({
      $lookup: {
        from: "inventories",
        localField: "products.name",
        foreignField: "name",
        as: "inv"
      }
    });
    pipeline.push({ $unwind: "$inv" });

    // (D) If a category filter was passed, apply it
    if (category) {
      pipeline.push({ $match: { "inv.category": category } });
    }

    // (E) Group by product name, summing units sold and revenue
    pipeline.push({
      $group: {
        _id: "$products.name",
        unitsSold: { $sum: "$products.quantity" },
        revenue: { $sum: "$products.lineTotal" }
      }
    });

    // (F) Project into a nicer shape
    pipeline.push({
      $project: {
        _id: 0,
        productName: "$_id",
        unitsSold: 1,
        revenue: 1
      }
    });

    // (G) Optionally sort by revenue descending
    pipeline.push({ $sort: { revenue: -1 } });

    const results = await Payment.aggregate(pipeline);

    return res.json({ products: results });
  } catch (err) {
    console.error("Error in getSalesByProduct:", err);
    return res.status(500).json({ products: [] });
  }
};
// in adminController.js (somewhere after getSalesByProduct)

// ─── GET /admin/get-sales-by-service?category=<>&range=<>
exports.getSalesByService = async (req, res) => {
  try {
    // 1) Parse inputs
    // `category` here should be a ServiceCategory _id (as a string), or empty string for “all”.
    const serviceCategoryId = req.query.category || "";
    let range = req.query.range || "day";  // 'day' | 'week' | 'month' | 'year'
    const now = new Date();
    now.setHours(23, 59, 59, 999);

    // 2) Determine the startDate for the “current” window
    let startDate;
    switch (range) {
      case "day":
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "week":
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 6);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "month":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "year":
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        // fallback to last 7 days
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 6);
        startDate.setHours(0, 0, 0, 0);
    }

    // 3) Build aggregation pipeline on Payment:
    const pipeline = [];

    // (A) Match by paidAt window:
    if (startDate) {
      pipeline.push({
        $match: { paidAt: { $gte: startDate, $lte: now } }
      });
    }

    // (B) Unwind the services[] array
    pipeline.push({ $unwind: "$services" });

    // (C) Lookup “Service” so we can know its category
    pipeline.push({
      $lookup: {
        from: "services",              // the collection for your Service model
        localField: "services.name",   // Payment.services.name
        foreignField: "serviceName",   // the Service document’s `serviceName` field
        as: "svcDoc"
      }
    });
    pipeline.push({ $unwind: "$svcDoc" });

    // (D) If the user passed a serviceCategoryId, match only those services
    if (serviceCategoryId) {
      // We assume ServiceCategory._id is what’s in svcDoc.category
      pipeline.push({ $match: { "svcDoc.category": mongoose.Types.ObjectId(serviceCategoryId) } });
    }

    // (E) Group by services.name, summing quantity & revenue
    pipeline.push({
      $group: {
        _id: "$services.name",
        unitsSold: { $sum: "$services.quantity" },
        revenue: { $sum: "$services.lineTotal" }
      }
    });

    // (F) Project a nicer shape
    pipeline.push({
      $project: {
        _id: 0,
        serviceName: "$_id",
        unitsSold: 1,
        revenue: 1
      }
    });

    // (G) Sort by revenue descendant
    pipeline.push({ $sort: { revenue: -1 } });

    // 4) Run the aggregation
    const results = await Payment.aggregate(pipeline);

    return res.json({ services: results });
  } catch (err) {
    console.error("Error in getSalesByService:", err);
    return res.status(500).json({ services: [] });
  }
};

exports.updateAbout = async (req, res) => {
  try {
    // Retrieve fields from the request
    const { aboutDescription, doctorName, doctorDescription, services } = req.body;
    let doctorPic = "";
    if (req.file) {
      doctorPic = "/uploads/" + req.file.filename;
    }
    let aboutContent = await About.findOne();
    if (!aboutContent) {
      aboutContent = new About();
    }
    // Update the general about description
    aboutContent.aboutDescription = aboutDescription;

    // Update services field:
    // Expecting services to be entered one per line in the textarea
    if (services !== undefined) {
      aboutContent.services = services
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(s => s !== "");
    }
    
    // If a new doctor is added, push a new doctor object (only if a name is provided)
    if (doctorName && doctorName.trim() !== "") {
      aboutContent.doctors.push({
        name: doctorName,
        description: doctorDescription,
        pic: doctorPic
      });
    }
    
    await aboutContent.save();
    res.json({ success: true, message: "About content updated successfully", about: aboutContent });
  } catch (error) {
    console.error("Error updating about content:", error);
    res.status(500).json({ success: false, message: "Server error updating about content" });
  }
};

exports.deleteDoctor = async (req, res) => {
  try {
    const { doctorId } = req.body;
    if (!doctorId) {
      return res.status(400).json({ success: false, message: "Doctor ID is required" });
    }
    let aboutContent = await About.findOne();
    if (!aboutContent) {
      return res.status(404).json({ success: false, message: "About content not found" });
    }
    // Try to get the doctor subdocument
    const doctor = aboutContent.doctors.id(doctorId);
    if (doctor && typeof doctor.remove === "function") {
      doctor.remove();
    } else {
      // If doctor.remove() is not available, remove manually:
      aboutContent.doctors = aboutContent.doctors.filter(doc => doc._id.toString() !== doctorId);
    }
    await aboutContent.save();
    res.json({ success: true, message: "Doctor removed successfully", about: aboutContent });
  } catch (error) {
    console.error("Error deleting doctor:", error);
    res.status(500).json({ success: false, message: "Server error deleting doctor" });
  }
};

exports.predictAppointments = async (req, res) => {
  try {
    console.log("Start predictAppointments...");

    // 1) Build dayCounts for last 7 days
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    let dayCounts = [];
    for (let i = 6; i >= 0; i--) {
      const dayDate = new Date(today);
      dayDate.setDate(dayDate.getDate() - i);

      // day start & end
      const start = new Date(dayDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(dayDate);
      end.setHours(23, 59, 59, 999);

      // Count how many reservations
      // eslint-disable-next-line no-await-in-loop
      const dailyCount = await Reservation.countDocuments({
        createdAt: { $gte: start, $lte: end }
      });

      dayCounts.push({
        date: dayDate.toISOString().slice(0, 10),
        count: dailyCount
      });
    }

    console.log("   dayCounts =>", dayCounts);

    // 2) Check if all 7 days are zero
    const allZero = dayCounts.every(dc => dc.count === 0);
    if (allZero) {
      // If truly no data in system, fallback to "0" for next 3 days
      const predictions = [];
      for (let i = 1; i <= 3; i++) {
        const futureDate = new Date(today);
        futureDate.setDate(today.getDate() + i);
        predictions.push({
          date: futureDate.toISOString().slice(0, 10),
          predictedCount: 0
        });
      }
      return res.json({
        last7days: dayCounts,
        method: "fallbackAllZero",
        predictions
      });
    }

    // 3) If there's ANY data, do the naive ratio/diff approach
    console.log("   Some days have non-zero data => ratio/diff approach.");

    // Build arrays of ratio/diffs
    let ratios = [];
    let diffs = [];
    for (let i = 1; i < dayCounts.length; i++) {
      let prev = dayCounts[i - 1].count;
      let curr = dayCounts[i].count;
      if (prev > 0) {
        ratios.push(curr / prev);
      }
      diffs.push(curr - prev);
    }

    let forecastMethod = "";
    let averageGrowth = 1;
    let averageDiff = 0;

    if (ratios.length >= 3) {
      // Use ratio approach
      averageGrowth = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      forecastMethod = "averageRatio";
    } else {
      // Use difference approach
      if (diffs.length > 0) {
        averageDiff = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
      }
      forecastMethod = "averageDiff";
    }

    console.log("   forecastMethod=", forecastMethod, " growth=", averageGrowth, " diff=", averageDiff);

    // 4) Generate predictions for next 3 days
    let predictions = [];
    let lastCount = dayCounts[dayCounts.length - 1].count;
    for (let i = 1; i <= 3; i++) {
      const nextDate = new Date(today);
      nextDate.setDate(today.getDate() + i);

      let nextCount = 0;
      if (forecastMethod === "averageRatio") {
        nextCount = Math.round(lastCount * averageGrowth);
      } else {
        nextCount = lastCount + averageDiff;
      }

      if (nextCount < 0) nextCount = 0; // never go negative
      predictions.push({
        date: nextDate.toISOString().slice(0, 10),
        predictedCount: nextCount
      });

      lastCount = nextCount;
    }

    return res.json({
      last7days: dayCounts,
      method: forecastMethod,
      averageGrowth,
      averageDiff,
      predictions
    });

  } catch (err) {
    console.error("Error in predictAppointments:", err);
    return res.status(500).json({ error: "Server error predicting appointments." });
  }
};

/**
 * Predict the busiest day-of-week for the next 7 days
 */
// adminController.js
exports.getPeakDayOfWeek = async (req, res) => {
  try {
    const now = new Date();
    let fromDate;
    switch (req.query.range) {
      case '7d':
        fromDate = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'year':
        fromDate = new Date(now.getFullYear(), 0, 1);
        break;
      case '30d':
      default:
        fromDate = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
    }

    // Fetch reservations in [fromDate … now]
    const reservations = await Reservation.find({
      createdAt: { $gte: fromDate, $lte: now }
    }).lean();

    // Count per weekday
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const counts = [0, 0, 0, 0, 0, 0, 0];
    reservations.forEach(r => {
      const d = new Date(r.createdAt).getDay();
      counts[d]++;
    });

    const days = dayNames.map((label, i) => ({ dayLabel: label, count: counts[i] }));
    res.json({ days });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error analyzing day-of-week." });
  }
};

exports.generateReport = async (req, res) => {
  try {
    // --------- 1) Appointment Trends Data (Dummy example data, replace with actual query as needed) ---------
    const appointmentTrends = {
      labels: ["2025-03-20", "2025-03-21", "2025-03-22", "2025-03-23", "2025-03-24", "2025-03-25", "2025-03-26"],
      pending: [2, 3, 1, 4, 2, 0, 3],
      approved: [1, 2, 3, 1, 0, 2, 1],
      completed: [5, 4, 6, 7, 3, 2, 4]
    };

    // --------- 2) User Account Statistics (Dummy example, replace with your actual data) ---------
    const userStats = {
      doctors: 5,
      hr: 2,
      customers: 50
    };

    // --------- 3) Customer & Pet Details -----------
    // Find all customers (users with role "Customer")
    const customers = await User.find({ role: "Customer" }).lean();

    // Create an array to hold customer-pet info
    const customerPetData = [];
    for (const customer of customers) {
      // Get pets for each customer
      const pets = await Pet.find({ owner: customer._id }).lean();
      // If customer has no pet, push customer info with blank pet fields
      if (pets.length === 0) {
        customerPetData.push({
          customerName: customer.username,
          email: customer.email,
          cellphone: customer.cellphone || "N/A",
          petName: "N/A",
          species: "N/A",
          breed: "N/A",
          birthday: "N/A",
          existingDisease: "N/A"
        });
      } else {
        // For each pet, add a row with customer details and pet info
        for (const pet of pets) {
          customerPetData.push({
            customerName: customer.username,
            email: customer.email,
            cellphone: customer.cellphone || "N/A",
            petName: pet.petName,
            species: pet.species,
            breed: pet.breed || "N/A",
            birthday: pet.birthday ? new Date(pet.birthday).toISOString().slice(0, 10) : "N/A",
            existingDisease: pet.existingDisease || "N/A"
          });
        }
      }
    }

    // Create a new Excel workbook
    const workbook = new ExcelJS.Workbook();

    // ---------------- Worksheet 1: Appointment Trends ----------------
    const wsTrends = workbook.addWorksheet('Appointment Trends');
    // Set header row
    wsTrends.addRow(['Appointment Trends (Past 7 Days)']);
    wsTrends.addRow(['Date', 'Pending', 'Approved', 'Completed']);
    // Add each day's data
    appointmentTrends.labels.forEach((date, idx) => {
      wsTrends.addRow([
        date,
        appointmentTrends.pending[idx],
        appointmentTrends.approved[idx],
        appointmentTrends.completed[idx]
      ]);
    });
    wsTrends.getRow(2).font = { bold: true };

    // ---------------- Worksheet 2: User Account Statistics ----------------
    const wsUserStats = workbook.addWorksheet('User Statistics');
    wsUserStats.addRow(['User Account Statistics']);
    wsUserStats.addRow(['Doctors', 'HR', 'Customers']);
    wsUserStats.addRow([userStats.doctors, userStats.hr, userStats.customers]);
    wsUserStats.getRow(2).font = { bold: true };

    // ---------------- Worksheet 3: Customer & Pet Details ----------------
    const wsCustPets = workbook.addWorksheet('Customer & Pet Details');
    wsCustPets.addRow(['Customer & Pet Details']);
    wsCustPets.addRow(['Customer Name', 'Email', 'Cellphone', 'Pet Name', 'Species', 'Breed', 'Birthday', 'Existing Disease']);
    customerPetData.forEach(rowData => {
      wsCustPets.addRow([
        rowData.customerName,
        rowData.email,
        rowData.cellphone,
        rowData.petName,
        rowData.species,
        rowData.breed,
        rowData.birthday,
        rowData.existingDisease
      ]);
    });
    wsCustPets.getRow(2).font = { bold: true };

    // Adjust columns width for better readability
    [wsTrends, wsUserStats, wsCustPets].forEach(worksheet => {
      worksheet.columns.forEach(column => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, cell => {
          const cellValue = cell.value ? cell.value.toString() : "";
          maxLength = Math.max(maxLength, cellValue.length);
        });
        column.width = maxLength < 10 ? 10 : maxLength;
      });
    });

    // Set response headers to prompt file download
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=dashboard-report.xlsx'
    );

    // Write workbook to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Error generating report:", err);
    res.status(500).json({ error: "Error generating report" });
  }
};

exports.getInventoryStats = async (req, res) => {
  try {
    const now = new Date();
    // 1) basic counts & value
    const allItems = await Inventory.find().lean();
    const totalSKUs = allItems.length;
    const totalValue = allItems.reduce((sum, i) => sum + (i.quantity * i.price), 0);
    const categoriesSet = new Set(allItems.map(i => i.category));
    const totalStock = allItems.reduce((sum, i) => sum + i.quantity, 0);

    // 2) stock/value by category
    const stockByCategory = await Inventory.aggregate([
      { $group: { _id: '$category', totalStock: { $sum: '$quantity' } } },
      { $sort: { totalStock: -1 } }
    ]);
    const valueByCategory = await Inventory.aggregate([
      { $group: { _id: '$category', totalValue: { $sum: { $multiply: ['$quantity', '$price'] } } } },
      { $sort: { totalValue: -1 } }
    ]);

    // 3) top 5 sold (last 30 days)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const topSold = await Payment.aggregate([
      { $match: { paidAt: { $gte: thirtyDaysAgo } } },
      { $unwind: '$products' },
      { $group: { _id: '$products.name', soldQuantity: { $sum: '$products.quantity' } } },
      { $sort: { soldQuantity: -1 } },
      { $limit: 5 }
    ]);

    // 4) low-stock & expiring soon
    const lowStock = allItems.filter(i => i.quantity <= 10);
    let expirations = [];
    allItems.forEach(i => {
      (i.expiredDates || []).forEach(d => {
        if (d > now && ((d - now) / (1000 * 60 * 60 * 24)) <= 30) {
          expirations.push({ name: i.name, expiry: d });
        }
      });
    });
    const expiringSoon = expirations
      .sort((a, b) => a.expiry - b.expiry)
      .slice(0, 5);

    // --- New Analytics ---

    // Inventory Turnover Rate (times per month)
    const totalSold30dAgg = await Payment.aggregate([
      { $match: { paidAt: { $gte: thirtyDaysAgo } } },
      { $unwind: '$products' },
      { $group: { _id: null, sold: { $sum: '$products.quantity' } } }
    ]);
    const totalSold30d = totalSold30dAgg[0]?.sold || 0;
    const avgInventory = totalStock;
    const turnoverRate = avgInventory ? (totalSold30d / avgInventory).toFixed(2) : '0.00';

    // Days Inventory Left = totalStock / avg daily sold (last 30d)
    const avgDailySold = totalSold30d / 30;
    const daysLeft = avgDailySold > 0 ? Math.round(totalStock / avgDailySold) : '--';

    // Top value category
    let topCategory = '';
    let topCategoryValue = 0;
    if (valueByCategory && valueByCategory.length) {
      topCategory = valueByCategory[0]._id || '';
      topCategoryValue = valueByCategory[0].totalValue || 0;
    }

    // Next expiry date (soonest item)
    let nextExpiry = null;
    if (expirations.length > 0) {
      nextExpiry = expirations[0].expiry;
    }

    res.json({
      totalSKUs,
      totalValue,
      categoriesCount: categoriesSet.size,
      stockByCategory,
      valueByCategory,
      topSold,
      lowStock,
      expiringSoon,
      turnoverRate,
      daysLeft,
      topCategory,
      topCategoryValue,
      nextExpiry
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// helper to fetch every payment with both cashier and customer
async function fetchAllPayments() {
  return Payment.find()
    .populate('by', 'username')   // who marked it paid
    .populate('customer', 'username')   // who paid
    .lean();
}

// ─── Download Excel ─────────────────────────────────────────────────
exports.downloadSalesExcel = async (req, res) => {
  try {
    // 1) Parse optional start/end from query:
    const { start, end } = req.query;
    let match = {};

    if (start && end) {
      const startDate = new Date(start);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(end);
      endDate.setHours(23, 59, 59, 999);
      match.paidAt = { $gte: startDate, $lte: endDate };
    }

    // 2) Fetch filtered payments (populate cashier & customer):
    const payments = await Payment.find(match)
      .populate('by', 'username')
      .populate('customer', 'username')
      .lean();

    // 3) Build daily trend (revenue, profit) array:
    //    If no range provided, default to last 30 days
    const today = end
      ? new Date(new Date(end).setHours(0, 0, 0, 0))
      : new Date(new Date().setHours(0, 0, 0, 0));

    let rangeStart;
    if (start && end) {
      rangeStart = new Date(new Date(start).setHours(0, 0, 0, 0));
    } else {
      // default: last 29 days → total 30‐day window
      rangeStart = new Date(today);
      rangeStart.setDate(today.getDate() - 29);
    }

    // Build a map from date (YYYY-MM-DD) → { revenue, transactions }
    const dailyMap = {};
    payments.forEach(p => {
      const d = new Date(p.paidAt);
      const key = d.toISOString().slice(0, 10);
      if (!dailyMap[key]) {
        dailyMap[key] = { revenue: 0, transactions: 0 };
      }
      dailyMap[key].revenue += p.amount;
      dailyMap[key].transactions += 1;
      // (If you need exact COGS and expiredLoss by day, you can unwind here.
      //  For simplicity, we’ll approximate profit = revenue * 0.2)
    });

    // Now assemble “dayCounts” objects for each calendar day in [rangeStart..today]
    const dayCounts = [];
    for (
      let dt = new Date(rangeStart);
      dt <= today;
      dt.setDate(dt.getDate() + 1)
    ) {
      const key = dt.toISOString().slice(0, 10);
      const rec = dailyMap[key] || { revenue: 0, transactions: 0 };
      const revenue = rec.revenue;
      const profit = Math.round(revenue * 0.2); // assume 20% margin
      dayCounts.push({ date: key, revenue, profit, transactions: rec.transactions });
    }

    // 4) Compute summary metrics:
    const totalRevenue = dayCounts.reduce((sum, d) => sum + d.revenue, 0);
    const totalTransactions = dayCounts.reduce((sum, d) => sum + d.transactions, 0);
    const totalProfit = dayCounts.reduce((sum, d) => sum + d.profit, 0);

    // “Growth vs. previous period”:
    // If N days in our window, get the preceding N days
    const N = dayCounts.length;
    const prevEnd = new Date(rangeStart.getTime() - 1); // day before rangeStart
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevEnd.getDate() - (N - 1));
    // Fetch payments in [prevStart..prevEnd]
    const prevPayments = await Payment.find({
      paidAt: {
        $gte: new Date(prevStart).setHours(0, 0, 0, 0),
        $lte: new Date(prevEnd).setHours(23, 59, 59, 999)
      }
    }).lean();
    let prevRevenueSum = 0;
    prevPayments.forEach(p => {
      prevRevenueSum += p.amount;
    });
    const growthPct =
      prevRevenueSum > 0
        ? ((totalRevenue - prevRevenueSum) / prevRevenueSum) * 100
        : 0;

    // 5) Build “Sales by Category” data:
    const categoryPipeline = [];
    if (rangeStart && today) {
      categoryPipeline.push({
        $match: {
          paidAt: { $gte: rangeStart, $lte: new Date(today).setHours(23, 59, 59, 999) }
        }
      });
    }
    categoryPipeline.push({ $unwind: '$products' });
    categoryPipeline.push({
      $lookup: {
        from: 'inventories',
        localField: 'products.name',
        foreignField: 'name',
        as: 'inv'
      }
    });
    categoryPipeline.push({ $unwind: '$inv' });
    categoryPipeline.push({
      $group: {
        _id: '$inv.category',
        sales: { $sum: '$products.lineTotal' },
        cogs: { $sum: { $multiply: ['$products.quantity', '$inv.basePrice'] } }
      }
    });
    const catAgg = await Payment.aggregate(categoryPipeline);

    // Also compute expired loss per category over the same window:
    const expiredCategoryPipeline = [];
    expiredCategoryPipeline.push({ $unwind: '$expiredDates' });
    expiredCategoryPipeline.push({
      $match: {
        expiredDates: { $gte: rangeStart, $lte: new Date(today).setHours(23, 59, 59, 999) }
      }
    });
    expiredCategoryPipeline.push({
      $group: {
        _id: '$category',
        expiredLoss: { $sum: '$price' }
      }
    });
    const expiredCatAgg = await Inventory.aggregate(expiredCategoryPipeline);

    // Merge into a map { category → { sales, profit, expiredLoss } }
    const byCategoryMap = {};
    catAgg.forEach(row => {
      const category = row._id;
      const sales = row.sales || 0;
      const cogs = row.cogs || 0;
      const expiredObj = expiredCatAgg.find(e => String(e._id) === String(category));
      const expiredLoss = expiredObj ? expiredObj.expiredLoss : 0;
      const profit = Math.max(sales - cogs - expiredLoss, 0);
      byCategoryMap[category] = { sales, profit, expiredLoss };
    });
    // Ensure categories with expired‐only still appear:
    expiredCatAgg.forEach(row => {
      const category = row._id;
      if (!byCategoryMap[category]) {
        byCategoryMap[category] = { sales: 0, profit: 0, expiredLoss: row.expiredLoss || 0 };
      }
    });
    const salesByCategory = Object.entries(byCategoryMap)
      .map(([category, vals]) => ({
        category,
        sales: vals.sales,
        profit: vals.profit,
        expiredLoss: vals.expiredLoss
      }))
      .sort((a, b) => b.sales - a.sales);

    // 6) Build “Sales by Service” data:
    const servicePipeline = [];
    if (rangeStart && today) {
      servicePipeline.push({
        $match: {
          paidAt: { $gte: rangeStart, $lte: new Date(today).setHours(23, 59, 59, 999) }
        }
      });
    }
    servicePipeline.push({ $unwind: '$services' });
    servicePipeline.push({
      $group: {
        _id: '$services.name',
        count: { $sum: '$services.quantity' },
        sales: { $sum: '$services.lineTotal' }
      }
    });
    servicePipeline.push({ $sort: { sales: -1 } });
    const svcAgg = await Payment.aggregate(servicePipeline);
    const salesByService = svcAgg.map(row => ({
      serviceName: row._id,
      count: row.count || 0,
      sales: row.sales || 0
    }));

    // 7) Build “Sales by Product” data:
    const productPipeline = [];
    if (rangeStart && today) {
      productPipeline.push({
        $match: {
          paidAt: { $gte: rangeStart, $lte: new Date(today).setHours(23, 59, 59, 999) }
        }
      });
    }
    productPipeline.push({ $unwind: '$products' });
    productPipeline.push({
      $group: {
        _id: '$products.name',
        unitsSold: { $sum: '$products.quantity' },
        revenue: { $sum: '$products.lineTotal' }
      }
    });
    productPipeline.push({ $sort: { revenue: -1 } });
    const prodAgg = await Payment.aggregate(productPipeline);
    const salesByProduct = prodAgg.map(row => ({
      productName: row._id,
      unitsSold: row.unitsSold || 0,
      sales: row.revenue || 0
    }));

    // ─── NOW BUILD A SINGLE-WORKSHEET EXCEL FILE ────────────────────────────
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SmartVet';
    workbook.created = new Date();

    const ws = workbook.addWorksheet('Dashboard');

    // Keep track of the “current row” (1-based) as we write tables and images:
    let rowIdx = 1;

    // 8a) Header
    ws.getRow(rowIdx).getCell(1).value = 'Dashboard Sales Summary';
    ws.getRow(rowIdx).font = { bold: true, size: 14 };
    rowIdx++;

    // Blank row
    rowIdx++;

    // 8b) KPI Table
    ws.getRow(rowIdx).values = ['Metric', 'Value'];
    ws.getRow(rowIdx).font = { bold: true };
    rowIdx++;

    ws.getRow(rowIdx).values = ['Total Revenue', `₱${totalRevenue.toLocaleString()}`];
    rowIdx++;
    ws.getRow(rowIdx).values = ['Total Transactions', totalTransactions];
    rowIdx++;
    ws.getRow(rowIdx).values = ['Total Profit', `₱${totalProfit.toLocaleString()}`];
    rowIdx++;
    ws.getRow(rowIdx).values = ['Growth vs Previous Period', `${growthPct.toFixed(1)}%`];
    rowIdx++;

    // Blank before the first chart
    rowIdx++;

    // 8c) 1st Chart: Daily Sales Trend (Line)
    const width = 800;
    const height = 300;
    const chartJSNodeCanvas = new ChartJSNodeCanvas({
      width,
      height,
      chartCallback: (ChartJS) => {
        // register plugins if needed
      }
    });

    // Build labels & data arrays for the line chart
    const labels = dayCounts.map(d => d.date);
    const dataRevenue = dayCounts.map(d => d.revenue);
    const dataProfit = dayCounts.map(d => d.profit);

    const lineConfig = {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Revenue (₱)',
            data: dataRevenue,
            borderColor: 'rgba(0, 143, 251, 1)',
            backgroundColor: 'rgba(0, 143, 251, 0.2)',
            fill: false,
            tension: 0.1,
            pointRadius: 3
          },
          {
            label: 'Profit (₱)',
            data: dataProfit,
            borderColor: 'rgba(40, 167, 69, 1)',
            backgroundColor: 'rgba(40, 167, 69, 0.2)',
            fill: false,
            tension: 0.1,
            pointRadius: 3
          }
        ]
      },
      options: {
        responsive: false,
        scales: {
          x: {
            display: true,
            title: { display: true, text: 'Date' },
            ticks: { maxRotation: 90, minRotation: 45 }
          },
          y: {
            display: true,
            beginAtZero: true,
            title: { display: true, text: 'Amount (₱)' }
          }
        },
        plugins: {
          legend: {
            display: true,
            position: 'top'
          },
          title: {
            display: true,
            text: 'Daily Sales Trend'
          }
        }
      }
    };

    const lineImageBuffer = await chartJSNodeCanvas.renderToBuffer(lineConfig);
    const lineImageId = workbook.addImage({
      buffer: lineImageBuffer,
      extension: 'png'
    });
    // Place it at column A, rowIdx (zero-based → rowIdx-1)
    ws.addImage(lineImageId, {
      tl: { col: 0, row: rowIdx - 1 },
      ext: { width: width * 0.75, height: height * 0.75 }
    });

    // After embedding the image, skip ~20 rows to avoid overlap
    rowIdx += 20;

    // ─── Section: Sales by Category ─────────────────────────────────────────
    ws.getRow(rowIdx).getCell(1).value = 'Sales by Category';
    ws.getRow(rowIdx).font = { bold: true, size: 12 };
    rowIdx++;

    // Table header
    ws.getRow(rowIdx).values = ['Category', 'Sales (₱)', 'Profit (₱)', 'Expired Loss (₱)'];
    ws.getRow(rowIdx).font = { bold: true };
    rowIdx++;

    salesByCategory.forEach(item => {
      ws.getRow(rowIdx).values = [
        item.category,
        item.sales.toLocaleString(),
        item.profit.toLocaleString(),
        item.expiredLoss.toLocaleString()
      ];
      rowIdx++;
    });

    // Blank row before category chart
    rowIdx++;

    // 2nd Chart: Sales by Category (Bar)
    const catLabels = salesByCategory.map(i => i.category);
    const catData = salesByCategory.map(i => i.sales);

    const barCatConfig = {
      type: 'bar',
      data: {
        labels: catLabels,
        datasets: [
          {
            label: 'Sales (₱)',
            data: catData,
            backgroundColor: 'rgba(0, 143, 251, 0.7)',
            borderColor: 'rgba(0, 82, 145, 1)',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: false,
        scales: {
          x: {
            title: { display: true, text: 'Category' }
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Sales (₱)' }
          }
        },
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'Sales by Category' }
        }
      }
    };

    const barCatBuffer = await chartJSNodeCanvas.renderToBuffer(barCatConfig);
    const barCatImageId = workbook.addImage({
      buffer: barCatBuffer,
      extension: 'png'
    });
    ws.addImage(barCatImageId, {
      tl: { col: 0, row: rowIdx - 1 },
      ext: { width: width * 0.75, height: height * 0.75 }
    });

    // Skip ~20 rows again
    rowIdx += 20;

    // ─── Section: Sales by Service ──────────────────────────────────────────
    ws.getRow(rowIdx).getCell(1).value = 'Sales by Service';
    ws.getRow(rowIdx).font = { bold: true, size: 12 };
    rowIdx++;

    // Table header
    ws.getRow(rowIdx).values = ['Service', 'Count', 'Sales (₱)'];
    ws.getRow(rowIdx).font = { bold: true };
    rowIdx++;

    salesByService.forEach(item => {
      ws.getRow(rowIdx).values = [
        item.serviceName,
        item.count,
        item.sales.toLocaleString()
      ];
      rowIdx++;
    });

    // Blank row before service chart
    rowIdx++;

    // 3rd Chart: Sales by Service (Bar)
    const svcLabels = salesByService.map(i => i.serviceName);
    const svcData = salesByService.map(i => i.sales);

    const barSvcConfig = {
      type: 'bar',
      data: {
        labels: svcLabels,
        datasets: [
          {
            label: 'Sales (₱)',
            data: svcData,
            backgroundColor: 'rgba(40, 167, 69, 0.7)',
            borderColor: 'rgba(25, 100, 45, 1)',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: false,
        scales: {
          x: {
            title: { display: true, text: 'Service' }
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Sales (₱)' }
          }
        },
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'Sales by Service' }
        }
      }
    };

    const barSvcBuffer = await chartJSNodeCanvas.renderToBuffer(barSvcConfig);
    const barSvcImageId = workbook.addImage({
      buffer: barSvcBuffer,
      extension: 'png'
    });
    ws.addImage(barSvcImageId, {
      tl: { col: 0, row: rowIdx - 1 },
      ext: { width: width * 0.75, height: height * 0.75 }
    });

    // Skip ~20 rows again
    rowIdx += 20;

    // ─── Section: Sales by Product ──────────────────────────────────────────
    ws.getRow(rowIdx).getCell(1).value = 'Sales by Product';
    ws.getRow(rowIdx).font = { bold: true, size: 12 };
    rowIdx++;

    // Table header
    ws.getRow(rowIdx).values = ['Product', 'Units Sold', 'Sales (₱)'];
    ws.getRow(rowIdx).font = { bold: true };
    rowIdx++;

    salesByProduct.forEach(item => {
      ws.getRow(rowIdx).values = [
        item.productName,
        item.unitsSold,
        item.sales.toLocaleString()
      ];
      rowIdx++;
    });

    // Blank row before product chart
    rowIdx++;

    // 4th Chart: Sales by Product (Bar)
    const prodLabels = salesByProduct.map(i => i.productName);
    const prodData = salesByProduct.map(i => i.sales);

    const barProdConfig = {
      type: 'bar',
      data: {
        labels: prodLabels,
        datasets: [
          {
            label: 'Sales (₱)',
            data: prodData,
            backgroundColor: 'rgba(255, 159, 64, 0.7)',
            borderColor: 'rgba(200, 100, 30, 1)',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: false,
        scales: {
          x: {
            title: { display: true, text: 'Product' }
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Sales (₱)' }
          }
        },
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'Sales by Product' }
        }
      }
    };

    const barProdBuffer = await chartJSNodeCanvas.renderToBuffer(barProdConfig);
    const barProdImageId = workbook.addImage({
      buffer: barProdBuffer,
      extension: 'png'
    });
    ws.addImage(barProdImageId, {
      tl: { col: 0, row: rowIdx - 1 },
      ext: { width: width * 0.75, height: height * 0.75 }
    });

    // ─── Auto‐width all columns (very rough heuristic) ───────────────────────
    ws.columns.forEach(column => {
      let maxLength = 10;
      column.eachCell({ includeEmpty: true }, cell => {
        const v = cell.value ? cell.value.toString() : '';
        if (v.length > maxLength) maxLength = v.length;
      });
      column.width = maxLength + 2;
    });

    // 9) Send back the single‐sheet workbook as .xlsx:
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=Dashboard-Sales-Report.xlsx'
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[downloadSalesExcel] error →', err);
    return res.status(500).json({ error: err.message || 'Error generating Excel report' });
  }
};
// ─── Download CSV ───────────────────────────────────────────────────
exports.downloadSalesCSV = async (req, res) => {
  try {
    // 1) Read optional start/end
    const { start, end } = req.query;
    let match = {};
    if (start && end) {
      const startDate = new Date(start);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(end);
      endDate.setHours(23, 59, 59, 999);
      match.paidAt = { $gte: startDate, $lte: endDate };
    }

    // 2) Fetch filtered payments
    const payments = await Payment.find(match)
      .populate('by', 'username')
      .populate('customer', 'username')
      .lean();

    // 3) Build CSV rows
    const rows = payments.map(p => ({
      paymentId: p._id.toString(),
      reservationId: p.reservation.toString(),
      customer: p.customer.username,
      cashier: p.by.username,
      paidAt: p.paidAt.toISOString(),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      products: p.products.map(x => `${x.name}×${x.quantity}@${x.unitPrice}`).join('|'),
      services: p.services.map(x => `${x.name}×${x.quantity}@${x.unitPrice}`).join('|'),
      amount: p.amount
    }));

    if (!rows.length) {
      // If no data, still send headers
      return res
        .status(200)
        .set({
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename=Sales-Report.csv'
        })
        .send('');
    }

    const csvFields = Object.keys(rows[0]);
    const Json2csvParser = require('json2csv').Parser;
    const parser = new Json2csvParser({ fields: csvFields });
    const csv = parser.parse(rows);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=Sales-Report.csv');
    res.send(csv);
  } catch (err) {
    console.error('Error generating CSV report:', err);
    res.status(500).json({ error: 'Error generating CSV report' });
  }
};

// ─── Download PDF ───────────────────────────────────────────────────
exports.downloadSalesPDF = async (req, res) => {
  const payments = await fetchAllPayments();
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=Sales-Report.pdf');
  doc.pipe(res);

  // Title & summary
  doc.fontSize(18).text('SmartVet Sales Report', { align: 'center' }).moveDown();
  const totalTxns = payments.length;
  const totalRev = payments.reduce((s, p) => s + p.amount, 0).toFixed(2);
  const avgTxn = (totalRev / totalTxns).toFixed(2);
  doc.fontSize(12)
    .text(`Total Transactions: ${totalTxns}`)
    .text(`Total Revenue: ₱${totalRev}`)
    .text(`Average per Txn: ₱${avgTxn}`)
    .moveDown();

  // Table header
  doc.fontSize(10)
    .text('PayID', 40, doc.y, { continued: true })
    .text('Customer', 140, doc.y, { continued: true })
    .text('Cashier', 260, doc.y, { continued: true })
    .text('PaidAt', 340, doc.y, { width: 100 })
    .moveDown(0.5);

  // First 25 rows
  payments.slice(0, 25).forEach(p => {
    doc.text(p._id.toString().slice(-6), 40, doc.y, { continued: true })
      .text(p.customer.username, 140, doc.y, { continued: true })
      .text(p.by.username, 260, doc.y, { continued: true })
      .text(p.paidAt.toISOString().slice(0, 10), 340, doc.y);
    doc.moveDown(0.2);
  });

  doc.end();
};
