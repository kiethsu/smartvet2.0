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
    const user = await User.findById(req.body.userId);
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


// adminController.js
// adminController.js
exports.getDashboardStats = async (req, res) => {
  try {
    console.log("[getDashboardStats] Starting…");

    // 0) parse & normalize range values
    const rawRange = req.query.range || '7d';
    let range = rawRange;
    if (range === '30d' || range === 'mtd') range = 'month';
    if (range === 'ytd')                     range = 'year';
    const compare = req.query.compare || 'prev'; // 'prev' or 'yoy'
    const startQ  = req.query.start;            // for custom
    const endQ    = req.query.end;              // for custom

    const now = new Date();
    now.setHours(23,59,59,999);

    //
    // 1) Appointment Trends (past 7 days)
    //
    const today = new Date(now);
    const past7 = Array.from({length:7}, (_,i) => {
      const d = new Date(today);
      d.setDate(today.getDate() - (6 - i));
      return d;
    });
    const labels7 = past7.map(d => d.toISOString().slice(0,10));
    const pending   = [], approved = [], completed = [];
    for (let d of past7) {
      const s = new Date(d); s.setHours(0,0,0,0);
      const e = new Date(d); e.setHours(23,59,59,999);
      pending.push(   await Reservation.countDocuments({ status:"Pending",   createdAt:{ $gte:s, $lte:e } }));
      approved.push(  await Reservation.countDocuments({ status:"Approved",  createdAt:{ $gte:s, $lte:e } }));
      completed.push(await Reservation.countDocuments({ status:"Done",      createdAt:{ $gte:s, $lte:e } }));
    }

    //
    // 2) Most Used Services
    //
    const servicesAgg = await Reservation.aggregate([
      { $match:{ status:"Done" } },
      { $group:{ _id:"$service", count:{ $sum:1 } } },
      { $sort:{ count:-1 } }
    ]);
    const top3           = servicesAgg.slice(0,3);
    const servicesLabels = top3.map(x=>x._id);
    const servicesData   = top3.map(x=>x.count);

    //
    // 3) Pets by Species
    //
    const speciesAgg    = await Pet.aggregate([
      { $group:{ _id:"$species", count:{ $sum:1 } } },
      { $sort:{ _id:1 } }
    ]);
    const speciesLabels = speciesAgg.map(x=>x._id);
    const speciesData   = speciesAgg.map(x=>x.count);

    //
    // 4) Disease Analytics
    //
    const diseaseAgg    = await Pet.aggregate([
      { $match:{ existingDisease:{ $nin:["","None"] } } },
      { $group:{ _id:"$existingDisease", count:{ $sum:1 } } },
      { $sort:{ count:-1 } }
    ]);
    const diseaseLabels = diseaseAgg.map(x=>x._id);
    const diseaseData   = diseaseAgg.map(x=>x.count);

    //
    // 5) User Stats
    //
    const doctorsCount   = await User.countDocuments({ role:"Doctor" });
    const hrCount        = await User.countDocuments({ role:"HR" });
    const customersCount = await User.countDocuments({ role:"Customer" });

    //
    // 6) Activity Feed
    //
    const recentRes = await Reservation.find().sort({ createdAt:-1 }).limit(3).lean();
    const recentUsr = await User.find({ role:{ $in:["Doctor","HR","Customer"] } })
                         .sort({ createdAt:-1 }).limit(2).lean();
    const activityFeed = [
      ...recentUsr.map(u => `${u.role} ${u.username} account created`),
      ...recentRes.map(r => `Reservation by ${r.ownerName} (${r.service})`)
    ];

    // static sections
    const dashboardStats = {
      appointmentTrends: { labels:labels7, pending, approved, completed },
      servicesData:      { labels:servicesLabels, data:servicesData },
      petsData:          { labels:speciesLabels, datasets:[{ label:"Pets", data:speciesData }] },
      diseaseData:       { labels:diseaseLabels, data:diseaseData },
      userStats:         { doctors:doctorsCount, hr:hrCount, customers:customersCount },
      activityFeed
    };

    //
    // 7) Sales Overview (range-aware + comparison)
    //
    let curFrom, curTo = now, prevFrom, prevTo;
    const trendLabels = [], trendData = [], prevTrend = [];

    // -- build current & previous periods --
    if (range === '7d') {
      curFrom = new Date(now); curFrom.setDate(now.getDate()-6); curFrom.setHours(0,0,0,0);
      if (compare === 'prev') {
        prevTo   = new Date(curFrom); prevTo.setDate(curFrom.getDate()-1); prevTo.setHours(23,59,59,999);
        prevFrom = new Date(prevTo); prevFrom.setDate(prevTo.getDate()-6); prevFrom.setHours(0,0,0,0);
      } else {
        prevFrom = new Date(curFrom); prevFrom.setFullYear(curFrom.getFullYear()-1);
        prevTo   = new Date(curTo);   prevTo.setFullYear(curTo.getFullYear()-1);
      }
      // daily loop
      for (let d=new Date(curFrom); d<=curTo; d.setDate(d.getDate()+1)) {
        const s = new Date(d); s.setHours(0,0,0,0);
        const e = new Date(d); e.setHours(23,59,59,999);
        trendLabels.push(d.toISOString().slice(0,10));
        const agg = await Payment.aggregate([
          { $match:{ paidAt:{ $gte:s, $lte:e } } },
          { $group:{ _id:null, total:{ $sum:"$amount" } } }
        ]);
        trendData.push(agg[0]?.total||0);

        if (prevFrom) {
          const pd = compare==='yoy'
            ? new Date(s).setFullYear(s.getFullYear()-1)
            : s.getTime() - (curTo - curFrom) - 86400000;
          const ps = new Date(pd), pe = new Date(ps); pe.setHours(23,59,59,999);
          const pagg = await Payment.aggregate([
            { $match:{ paidAt:{ $gte:ps, $lte:pe } } },
            { $group:{ _id:null, total:{ $sum:"$amount" } } }
          ]);
          prevTrend.push(pagg[0]?.total||0);
        }
      }

    } else if (range === 'month') {
      curFrom = new Date(now.getFullYear(), now.getMonth(), 1);
      if (compare === 'prev') {
        prevTo   = new Date(curFrom); prevTo.setDate(0); prevTo.setHours(23,59,59,999);
        prevFrom = new Date(prevTo.getFullYear(), prevTo.getMonth(), 1);
      } else {
        prevFrom = new Date(curFrom); prevFrom.setFullYear(curFrom.getFullYear()-1);
        prevTo   = new Date(now);     prevTo.setFullYear(now.getFullYear()-1);
      }
      for (let d=new Date(curFrom); d<=now; d.setDate(d.getDate()+1)) {
        const s = new Date(d); s.setHours(0,0,0,0);
        const e = new Date(d); e.setHours(23,59,59,999);
        trendLabels.push(d.toISOString().slice(0,10));
        const agg = await Payment.aggregate([
          { $match:{ paidAt:{ $gte:s, $lte:e } } },
          { $group:{ _id:null, total:{ $sum:"$amount" } } }
        ]);
        trendData.push(agg[0]?.total||0);

        if (prevFrom) {
          const pd = compare==='yoy'
            ? new Date(s).setFullYear(s.getFullYear()-1)
            : new Date(s).setMonth(s.getMonth()-1);
          const ps = new Date(pd), pe = new Date(ps); pe.setHours(23,59,59,999);
          const pagg = await Payment.aggregate([
            { $match:{ paidAt:{ $gte:ps, $lte:pe } } },
            { $group:{ _id:null, total:{ $sum:"$amount" } } }
          ]);
          prevTrend.push(pagg[0]?.total||0);
        }
      }

    } else if (range === 'year') {
      curFrom = new Date(now.getFullYear(), 0, 1);
      if (compare === 'prev') {
        prevFrom = new Date(curFrom); prevFrom.setFullYear(curFrom.getFullYear()-1);
        prevTo   = new Date(curTo);   prevTo.setFullYear(curTo.getFullYear()-1);
      } else {
        prevFrom = new Date(curFrom); prevFrom.setFullYear(curFrom.getFullYear()-1);
        prevTo   = new Date(curTo);   prevTo.setFullYear(curTo.getFullYear()-1);
      }
      for (let m = 0; m <= now.getMonth(); m++) {
        const ms = new Date(now.getFullYear(), m, 1);
        const me = new Date(now.getFullYear(), m+1, 0,23,59,59,999);
        trendLabels.push(String(m+1));
        const agg = await Payment.aggregate([
          { $match:{ paidAt:{ $gte:ms, $lte:me } } },
          { $group:{ _id:null, total:{ $sum:"$amount" } } }
        ]);
        trendData.push(agg[0]?.total||0);

        if (prevFrom) {
          const pms = new Date(ms); pms.setFullYear(ms.getFullYear()-1);
          const pme = new Date(me); pme.setFullYear(me.getFullYear()-1);
          const pagg = await Payment.aggregate([
            { $match:{ paidAt:{ $gte:pms, $lte:pme } } },
            { $group:{ _id:null, total:{ $sum:"$amount" } } }
          ]);
          prevTrend.push(pagg[0]?.total||0);
        }
      }

    } else if (range === 'custom' && startQ && endQ) {
      curFrom = new Date(startQ); curFrom.setHours(0,0,0,0);
      curTo   = new Date(endQ);   curTo.setHours(23,59,59,999);
      const diff = curTo - curFrom;
      if (compare === 'prev') {
        prevTo   = new Date(curFrom - 1); prevTo.setHours(23,59,59,999);
        prevFrom = new Date(prevTo - diff); prevFrom.setHours(0,0,0,0);
      } else {
        prevFrom = new Date(curFrom); prevFrom.setFullYear(curFrom.getFullYear()-1);
        prevTo   = new Date(curTo);   prevTo.setFullYear(curTo.getFullYear()-1);
      }
      for (let d=new Date(curFrom); d<=curTo; d.setDate(d.getDate()+1)) {
        const s = new Date(d); s.setHours(0,0,0,0);
        const e = new Date(d); e.setHours(23,59,59,999);
        trendLabels.push(d.toISOString().slice(0,10));
        const agg = await Payment.aggregate([
          { $match:{ paidAt:{ $gte:s, $lte:e } } },
          { $group:{ _id:null, total:{ $sum:"$amount" } } }
        ]);
        trendData.push(agg[0]?.total||0);

        if (prevFrom) {
          const pd = compare==='yoy'
            ? new Date(s).setFullYear(s.getFullYear()-1)
            : s.getTime() - diff - 86400000;
          const ps = new Date(pd), pe = new Date(ps); pe.setHours(23,59,59,999);
          const pagg = await Payment.aggregate([
            { $match:{ paidAt:{ $gte:ps, $lte:pe } } },
            { $group:{ _id:null, total:{ $sum:"$amount" } } }
          ]);
          prevTrend.push(pagg[0]?.total||0);
        }
      }
    }

    // 8) Totals & comparison
    const [ currTxns, currRevAgg ] = await Promise.all([
      Payment.countDocuments({ paidAt:{ $gte:curFrom, $lte:curTo } }),
      Payment.aggregate([
        { $match:{ paidAt:{ $gte:curFrom, $lte:curTo } } },
        { $group:{ _id:null, total:{ $sum:"$amount" } } }
      ])
    ]);
    const currRev = currRevAgg[0]?.total || 0;

    // build heatmap
    const heatmap = {};
    trendLabels.forEach((d,i) => heatmap[d] = trendData[i]);

    // build transactions
 const payments = await Payment.find({ paidAt: { $gte: curFrom, $lte: curTo } })
  .populate('by', 'username')         // Cashier/front desk
  .populate('customer', 'username')   // Customer/user
  .lean();

const transactions = payments.map(p => ({
  date:      p.paidAt.toISOString().slice(0,10),
  id:        p._id.toString().slice(-6),
  customer:  p.customer?.username || 'N/A', // ✅ Correct customer name
  cashier:   p.by?.username || 'N/A',       // ✅ Correct cashier/front desk
  items:     [...(p.services||[]),...(p.products||[])].map(i=>i.name).join(', '),
  amount:    p.amount
}));

    dashboardStats.sales = {
  totalTransactions: currTxns,
  totalRevenue:      currRev,
  trend:             { labels:trendLabels, data:trendData },
  prevTrend:         prevTrend.length ? prevTrend : undefined,
  heatmap,
  transactions      // <-- Now includes customer & cashier fields!
};

const revenueByService = await Payment.aggregate([
  { $unwind: "$services" },
  { $group: {
      _id: "$services.name",
      total: { $sum: "$services.lineTotal" }
  }},
  { $sort: { total: -1 } },
  { $limit: 5 } // <-- add this!
]);


// ─── B) Top SKUs by units sold & revenue ────────────────────────────
const topSKUs = await Payment.aggregate([
  { $unwind: "$products" },
  { $group: {
      _id: "$products.name",
      unitsSold: { $sum: "$products.quantity" },
      revenue:   { $sum: { $multiply: ["$products.quantity", "$products.unitPrice"] } } // <--- FIXED!
  }},
  { $sort: { revenue: -1 } }, // sort by revenue
  { $limit: 10 }
]);


    // C) New vs Returning Customers
    const custAgg = await Payment.aggregate([
      { $group: {
          _id: "$by",
          count:     { $sum: 1 },
          firstDate: { $min: "$paidAt" }
      }}
    ]);
    const newCustomers = custAgg.filter(c =>
      new Date(c.firstDate) >= curFrom && new Date(c.firstDate) <= curTo
    ).length;
    const returningCustomers = custAgg.length - newCustomers;

    dashboardStats.descriptive = {
      revenueByService,
      topSKUs,
      newCustomers,
      returningCustomers
    };

 

    if (prevFrom) {
      const [ prevTxns, prevRevAgg ] = await Promise.all([
        Payment.countDocuments({ paidAt:{ $gte:prevFrom, $lte:prevTo } }),
        Payment.aggregate([
          { $match:{ paidAt:{ $gte:prevFrom, $lte:prevTo } } },
          { $group:{ _id:null, total:{ $sum:"$amount" } } }
        ])
      ]);
      const prevRev = prevRevAgg[0]?.total || 0;
      dashboardStats.sales.comparison = {
        currentTransactions:       currTxns,
        prevTransactions:          prevTxns,
        transactionsChangePercent: prevTxns ? (currTxns - prevTxns)/prevTxns*100 : 0,
        currentRevenue:            currRev,
        prevRevenue:               prevRev,
        revenueChangePercent:      prevRev ? (currRev - prevRev)/prevRev*100 : 0
      };
    }

    console.log("[getDashboardStats] sales →", dashboardStats.sales);
    console.log("💡 DESCRIPTIVE PAYLOAD:", dashboardStats.descriptive);

    return res.json(dashboardStats);

  } catch (error) {
    console.error("Error in getDashboardStats:", error);
    return res.status(500).json({ error:"Server error" });
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
        fromDate = new Date(now.getTime() - 6 * 24*60*60*1000);
        break;
      case 'month':
        fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'year':
        fromDate = new Date(now.getFullYear(), 0, 1);
        break;
      case '30d':
      default:
        fromDate = new Date(now.getTime() - 29 * 24*60*60*1000);
    }

    // Fetch reservations in [fromDate … now]
    const reservations = await Reservation.find({
      createdAt: { $gte: fromDate, $lte: now }
    }).lean();

    // Count per weekday
    const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const counts = [0,0,0,0,0,0,0];
    reservations.forEach(r => {
      const d = new Date(r.createdAt).getDay();
      counts[d]++;
    });

    const days = dayNames.map((label,i) => ({ dayLabel: label, count: counts[i] }));
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
    const allItems      = await Inventory.find().lean();
    const totalSKUs     = allItems.length;
    const totalValue    = allItems.reduce((sum,i) => sum + (i.quantity * i.price), 0);
    const categoriesSet = new Set(allItems.map(i=>i.category));
    const totalStock    = allItems.reduce((sum, i) => sum + i.quantity, 0);

    // 2) stock/value by category
    const stockByCategory = await Inventory.aggregate([
      { $group:{ _id:'$category', totalStock:{ $sum:'$quantity' } } },
      { $sort:{ totalStock:-1 } }
    ]);
    const valueByCategory = await Inventory.aggregate([
      { $group:{ _id:'$category', totalValue:{ $sum:{ $multiply:['$quantity','$price'] } } } },
      { $sort:{ totalValue:-1 } }
    ]);

    // 3) top 5 sold (last 30 days)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const topSold = await Payment.aggregate([
      { $match: { paidAt: { $gte: thirtyDaysAgo } } },
      { $unwind:'$products' },
      { $group:{ _id:'$products.name', soldQuantity:{ $sum:'$products.quantity' } } },
      { $sort:{ soldQuantity:-1 } }, { $limit:5 }
    ]);

    // 4) low-stock & expiring soon
    const lowStock = allItems.filter(i => i.quantity <= 10);
    // flatten expirations
    let expirations = [];
    allItems.forEach(i => {
      (i.expirationDates||[]).forEach(d => {
        if (d > now && ((d - now)/(1000*60*60*24)) <= 30) {
          expirations.push({ name:i.name, expiry:d });
        }
      });
    });
    // sort soonest first, limit 5
    const expiringSoon = expirations
      .sort((a,b)=> a.expiry - b.expiry)
      .slice(0,5);

    // --- New Analytics ---

    // Inventory Turnover Rate (times per month)
    // = (Total units sold in 30d) / (Avg inventory)
    const totalSold30dAgg = await Payment.aggregate([
      { $match: { paidAt: { $gte: thirtyDaysAgo } } },
      { $unwind: "$products" },
      { $group: { _id: null, sold: { $sum: "$products.quantity" } } }
    ]);
    const totalSold30d = totalSold30dAgg[0]?.sold || 0;
    const avgInventory = totalStock; // or divide by categories for more accuracy, but usually use on-hand
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
      // --- New analytics for your UI cards ---
      turnoverRate,
      daysLeft,
      topCategory,
      topCategoryValue,
      nextExpiry
    });
  } catch(err) {
    console.error(err);
    res.status(500).json({ message:'Server error' });
  }
};


// helper to fetch every payment with both cashier and customer
async function fetchAllPayments() {
  return Payment.find()
    .populate('by',       'username')   // who marked it paid
    .populate('customer', 'username')   // who paid
    .lean();
}

// ─── Download Excel ─────────────────────────────────────────────────
exports.downloadSalesExcel = async (req, res) => {
  const payments = await fetchAllPayments();

  // summary stats
  const totalTxns   = payments.length;
  const totalRev    = payments.reduce((sum,p)=> sum + p.amount, 0);
  const avgTxn      = totalTxns ? (totalRev/totalTxns).toFixed(2) : 0;

  // breakdown maps
  const dailyMap = {}, svcMap = {}, prodMap = {};
  payments.forEach(p => {
    // daily revenue
    const day = p.paidAt.toISOString().slice(0,10);
    dailyMap[day] = (dailyMap[day]||0) + p.amount;

    // services
    p.services.forEach(s => {
      svcMap[s.name] = (svcMap[s.name]||0) + s.lineTotal;
    });

    // products
    p.products.forEach(x => {
      prodMap[x.name] = (prodMap[x.name]||0) + x.lineTotal;
    });
  });

  // prepare rows
  const dailyRows   = Object.entries(dailyMap).sort().map(([d,t])=>({ d,t }));
  const svcRows     = Object.entries(svcMap).map(([n,t])=>({ n,t }));
  const prodRows    = Object.entries(prodMap).map(([n,t])=>({ n,t }));

  // build workbook
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SmartVet'; wb.created = new Date();

  // — Summary sheet
  const sum = wb.addWorksheet('Summary');
  sum.addRow(['SmartVet Sales Report']); sum.addRow([]);
  sum.addRow(['Total Transactions', totalTxns]);
  sum.addRow(['Total Revenue (₱)', totalRev]);
  sum.addRow(['Average per Txn (₱)', avgTxn]);

  // — Daily breakdown
  const w1 = wb.addWorksheet('Daily Rev');
  w1.addRow(['Date','Revenue (₱)']);
  dailyRows.forEach(r=> w1.addRow([r.d, r.t]));

  // — Services breakdown
  const w2 = wb.addWorksheet('By Service');
  w2.addRow(['Service','Revenue (₱)']);
  svcRows.forEach(r=> w2.addRow([r.n, r.t]));

  // — Products breakdown
  const w3 = wb.addWorksheet('By Product');
  w3.addRow(['Product','Revenue (₱)']);
  prodRows.forEach(r=> w3.addRow([r.n, r.t]));

  // — Detailed transactions
  const w4 = wb.addWorksheet('Transactions Detail');
  w4.addRow([
    'Payment ID','Reservation ID','Customer','Cashier',
    'Paid At','Created At','Updated At','Products','Services','Amount (₱)'
  ]);
  payments.forEach(p => {
    const fmtLine = arr => arr.map(x=>
      `${x.name}×${x.quantity}@${x.unitPrice}=₱${x.lineTotal}`
    ).join('; ');
    w4.addRow([
      p._id.toString(),
      p.reservation.toString(),
      p.customer.username,
      p.by.username,
      p.paidAt.toISOString(),
      p.createdAt.toISOString(),
      p.updatedAt.toISOString(),
      fmtLine(p.products),
      fmtLine(p.services),
      p.amount
    ]);
  });

  // auto‐width
  wb.eachSheet(ws => {
    ws.columns.forEach(col => {
      let max=10;
      col.eachCell(c=> max=Math.max(max,(''+c.value).length));
      col.width = max+2;
    });
  });

  // stream back
  res.setHeader('Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition',
    'attachment; filename=Sales-Report.xlsx'
  );
  await wb.xlsx.write(res);
  res.end();
};


// ─── Download CSV ───────────────────────────────────────────────────
exports.downloadSalesCSV = async (req, res) => {
  const payments = await fetchAllPayments();
  const rows = payments.map(p=>({
    paymentId:     p._id.toString(),
    reservationId: p.reservation.toString(),
    customer:      p.customer.username,
    cashier:       p.by.username,
    paidAt:        p.paidAt.toISOString(),
    createdAt:     p.createdAt.toISOString(),
    updatedAt:     p.updatedAt.toISOString(),
    products:      p.products.map(x=>`${x.name}×${x.quantity}@${x.unitPrice}`).join('|'),
    services:      p.services.map(x=>`${x.name}×${x.quantity}@${x.unitPrice}`).join('|'),
    amount:        p.amount
  }));

  const parser = new Json2csvParser({ fields: Object.keys(rows[0]) });
  const csv = parser.parse(rows);

  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition','attachment; filename=Sales-Report.csv');
  res.send(csv);
};

// ─── Download PDF ───────────────────────────────────────────────────
exports.downloadSalesPDF = async (req, res) => {
  const payments = await fetchAllPayments();
  const doc = new PDFDocument({ size:'A4', margin:40 });
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename=Sales-Report.pdf');
  doc.pipe(res);

  // Title & summary
  doc.fontSize(18).text('SmartVet Sales Report', { align:'center' }).moveDown();
  const totalTxns = payments.length;
  const totalRev  = payments.reduce((s,p)=>s+p.amount,0).toFixed(2);
  const avgTxn    = (totalRev/totalTxns).toFixed(2);
  doc.fontSize(12)
     .text(`Total Transactions: ${totalTxns}`)
     .text(`Total Revenue: ₱${totalRev}`)
     .text(`Average per Txn: ₱${avgTxn}`)
     .moveDown();

  // Table header
  doc.fontSize(10)
     .text('PayID', 40, doc.y, { continued:true })
     .text('Customer', 140, doc.y, { continued:true })
     .text('Cashier', 260, doc.y, { continued:true })
     .text('PaidAt', 340, doc.y, { width:100 })
     .moveDown(0.5);

  // First 25 rows
  payments.slice(0,25).forEach(p => {
    doc.text(p._id.toString().slice(-6), 40, doc.y, { continued:true })
       .text(p.customer.username, 140, doc.y, { continued:true })
       .text(p.by.username, 260, doc.y, { continued:true })
       .text(p.paidAt.toISOString().slice(0,10), 340, doc.y);
    doc.moveDown(0.2);
  });

  doc.end();
};
